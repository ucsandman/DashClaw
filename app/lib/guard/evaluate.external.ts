/**
 * Guard evaluation engine — predictive-risk amplifier and the external policy
 * verdict phase. Extracted verbatim from evaluate.ts; behavior unchanged.
 */

import { randomUUID } from 'node:crypto';
import { sevOf } from './internal';
import type { GuardSql, GuardEvalContext } from './types';
import { getPredictiveSettings, getExternalVerdictConfig } from './caches';
import type { ExternalVerdictConfig } from './caches';
import type { ExternalVerdictEvidence } from './external-verdict';
import { raiseDecision } from './evaluate.accumulator';
import type { GuardAccumulator } from './evaluate.accumulator';

// Post-LLM phases (local_policies, grants, persist) need headroom inside the
// evaluation deadline; the LLM amplifier only gets what's left minus this.
const LLM_SAFETY_MARGIN_MS = 600;

// Predictive risk scoring — statistical analysis of historical behavior.
// Best-effort: never block guard on failure. Skipped entirely (no settings
// re-read, no historical-stats query) when PREDICTIVE_RISK_ENABLED is off.
// serverEvidenceScore is max(server_total, template) — the client-reported
// term is deliberately excluded from the LLM trigger (see getPredictiveRisk).
// remainingBudgetMs bounds the LLM amplifier: the measured 1.2–3s call was
// the dominant cause of deadline degradations (v2.1 diagnosis).
export async function computePredictiveRisk(
  sql: GuardSql,
  orgId: string,
  context: GuardEvalContext,
  serverEvidenceScore: number,
  remainingBudgetMs: number,
): Promise<{ total_adjustment?: number } | null> {
  try {
    const { enabled, threshold } = await getPredictiveSettings(sql, orgId);
    if (!enabled) return null;

    if (context.agent_id && context.action_type) {
      const { getPredictiveRisk } = await import('../predictive-risk');
      return await getPredictiveRisk(
        sql, orgId, context.agent_id, context.action_type, serverEvidenceScore,
        { enabled, threshold, llmBudgetMs: Math.max(0, remainingBudgetMs - LLM_SAFETY_MARGIN_MS) },
      );
    }
    return null;
  } catch (e) {
    console.warn('[Guard] Predictive risk failed:', (e as Error).message);
    return null;
  }
}

// The external provider call shares the deadline economics of the LLM
// amplifier: it only gets what's left of the evaluation budget minus this
// headroom for the phases that still have to run after it.
const EXTERNAL_SAFETY_MARGIN_MS = 600;

/**
 * External policy verdict (RFC 2026-08-13-external-policy-verdict-input,
 * frozen v1 contract, #219). Calls the org's configured provider and JOINS
 * the mapped verdict with the local outcome via raiseDecision — the join is
 * tighten-only by construction (E1), and a mapped `deny` raises to block,
 * which no later pass downgrades (E2: the grant passes only ever cover
 * require_approval). Unavailability takes the org's configured posture and is
 * recorded as exactly that — never as successful external governance.
 * Fail-soft like every optional phase: an unexpected throw costs the external
 * input, never the decision.
 */
// Applies cfg.posture to a non-'ok' outcome the same way for every failure
// shape (decrypt-broken config, provider unavailable, an unexpected throw):
// fail_closed escalates and records why; fail_open records and continues.
function applyExternalUnavailablePosture(
  acc: GuardAccumulator,
  posture: ExternalVerdictConfig['posture'],
  failure: NonNullable<ExternalVerdictEvidence['failure']>,
): void {
  if (posture === 'fail_closed') {
    raiseDecision(acc, 'require_approval');
    acc.reasons.push(`external_unavailable (${failure}; fail_closed)`);
  } else {
    acc.warnings.push(`external_unavailable (${failure}; fail_open)`);
  }
}

export async function runExternalVerdict(
  sql: GuardSql,
  orgId: string,
  context: GuardEvalContext,
  acc: GuardAccumulator,
  remainingBudgetMs: number,
): Promise<ExternalVerdictEvidence | null> {
  let cfg: ExternalVerdictConfig | null = null;
  try {
    cfg = await getExternalVerdictConfig(sql, orgId);
    if (cfg.configState === 'unset') return null;
    // Applicability scope (#219 follow-up): a domain-specific provider is
    // only consulted for the action_types it declared authority over. An
    // out-of-scope act is LOCAL-ONLY governance by configuration — no wire
    // call, no latency, and no unavailability posture (there is nothing to
    // be unavailable for) — but the skip is recorded, never silent, so an
    // operator can see the provider was not asked. Checked before the
    // 'unreadable' posture on purpose: the scope key is plain-text and stays
    // readable when the encrypted URL does not.
    if (cfg.actionTypes && !cfg.actionTypes.includes(context.action_type || '')) {
      return {
        provider_id: cfg.providerId,
        posture: cfg.posture,
        status: 'skipped',
        regime: 'not_applicable',
        latency_ms: 0,
        reason_code: 'action_type_not_in_scope',
      };
    }
    if (cfg.configState === 'unreadable') {
      // Enabled and a URL was saved, but it could not be decrypted (e.g.
      // after an ENCRYPTION_KEY rotation) — a failed provider call in every
      // way that matters to posture, not a "nothing configured" no-op:
      // fail_closed must still escalate.
      const ev: ExternalVerdictEvidence = {
        provider_id: cfg.providerId,
        posture: cfg.posture,
        status: 'unavailable',
        regime: 'external_unavailable',
        latency_ms: 0,
        failure: 'config_unreadable',
      };
      applyExternalUnavailablePosture(acc, cfg.posture, 'config_unreadable');
      return ev;
    }
    const { computeInputIdentity, fetchExternalVerdict } = await import('./external-verdict');
    // The wire request is the act tuple the guard already evaluates — not the
    // whole context. input_identity digests exactly this tuple (E3).
    const identityPayload = {
      org_id: orgId,
      agent_id: context.agent_id || null,
      action_type: context.action_type || null,
      declared_goal: context.declared_goal || null,
      act: context.act ?? null,
    };
    const request = {
      request_id: `evr_${randomUUID()}`,
      ...identityPayload,
      input_identity: computeInputIdentity(identityPayload),
    };
    const ev = await fetchExternalVerdict(
      cfg,
      request,
      Math.min(cfg.timeoutMs, remainingBudgetMs - EXTERNAL_SAFETY_MARGIN_MS),
    );
    if (ev.status === 'ok' && ev.mapped_verdict) {
      raiseDecision(acc, ev.mapped_verdict);
      if (sevOf(ev.mapped_verdict) > sevOf('allow')) {
        acc.reasons.push(
          `external verdict ${ev.raw_verdict} from ${ev.provider_id}${ev.reason_code ? ` (${ev.reason_code})` : ''}`,
        );
      }
    } else {
      applyExternalUnavailablePosture(acc, ev.posture, ev.failure ?? 'error');
    }
    return ev;
  } catch (e) {
    if (cfg && cfg.configState === 'ready') {
      // The config loaded fine; something after it threw (wire client,
      // identity digest, ...). We KNOW the org configured a provider, so
      // silently dropping to local-only would repeat the A1 bug one layer
      // up — apply the posture instead.
      console.warn('[Guard] external verdict failed (applying posture):', (e as Error).message);
      const ev: ExternalVerdictEvidence = {
        provider_id: cfg.providerId,
        posture: cfg.posture,
        status: 'unavailable',
        regime: 'external_unavailable',
        latency_ms: 0,
        failure: 'internal_error',
      };
      applyExternalUnavailablePosture(acc, cfg.posture, 'internal_error');
      return ev;
    }
    // The config load itself threw (e.g. the settings query failed) — we
    // cannot know whether the org configured a provider, so this stays a
    // genuine best-effort skip (never a decision-affecting failure), just
    // logged loudly instead of swallowed.
    console.error('[Guard] external verdict config load failed (continuing local-only):', (e as Error).message);
    return null;
  }
}
