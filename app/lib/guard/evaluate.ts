/**
 * Guard evaluation engine.
 * Evaluates agent context against org policies and returns allow/warn/block/require_approval.
 */

import { randomUUID } from 'node:crypto';
import { scanSensitiveData } from '../security';
import { scanForPromptInjection } from '../promptInjection';
import { EVENTS, publishOrgEvent } from '../events';
import { getActBindingMode } from '../act-binding';
import { computeActContentHash } from '../act-content-hash';
import { getJtiReplayMode } from '../replay-protection';
import { grantMatches, grantIsExpired, grantCoversRisk, grantMaxRisk, commandShapeKey } from '../policy-shapes';
import { INTERRUPTION_BUDGET_DEFAULTS } from '../posture/loosening';
import { DECISION_SEVERITY, sevOf } from './internal';
import type { GuardSql, GuardEvalContext, PolicyRow, PolicyRules, PolicyResult, Preliminary, GuardDecisionInsert } from './types';
import { resolveDegradedAction, evaluatePolicy, evaluateWebhookPolicy, isKnownPolicyType } from './policy';
import { getOrgHaltState, getActiveApprovalPause, getOverBudgetPolicyIds, getOverBudgetShapeKeys, loadApplicablePolicies, getPredictiveSettings, getCalibrationRuntime, getHasLivePlan, getExternalVerdictConfig } from './caches';
import type { ExternalVerdictConfig } from './caches';
import type { ExternalVerdictEvidence } from './external-verdict';
import { classifyDeviation, summarizeAct } from './deviation';
import type { DeviationFinding, LivePlanStep } from './deviation';
import { assessCalibration, CALIBRATION_POLICY_ID } from './calibration';
import type { CalibrationAssessment } from './calibration';
import { serverRiskTerms, computeEffectiveRisk, computeRiskAssessment } from './risk';
import type { RiskBreakdown, EvidenceDerivedBreakdown } from './risk';
import { classifyAct } from './evidence';
import type { ActInput } from './evidence';
import { persistGuardDecision } from './persistence';
import { finalizeContainment } from './containment';

// Evaluation deadline: the hook gives the whole guard call one attempt with a
// 5s read timeout (GUARD_TIMEOUT, GUARD_RETRIES=0) — the server must answer
// safely inside that window, so the policy-evaluation phases are bounded and a
// degraded decision is returned (and still persisted) when they overrun.
const DEFAULT_GUARD_DEADLINE_MS = 3500;

function guardDeadlineMs(): number {
  const raw = Number(process.env.DASHCLAW_GUARD_DEADLINE_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_GUARD_DEADLINE_MS;
}

const isRecord = (v: unknown): v is Record<string, unknown> => v != null && typeof v === 'object';

// Walk all but the last path segment, returning the parent record (or undefined
// if any segment is missing or non-object).
function navigateToParent(obj: unknown, keys: string[]): Record<string, unknown> | undefined {
  let cur: unknown = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    if (!isRecord(cur) || k === undefined) return undefined;
    cur = cur[k];
  }
  return isRecord(cur) ? cur : undefined;
}

// Replace the leaf at `path` with `marker` if present. Used to keep raw
// non_fabrication inputs out of the persisted guard_decisions.context row.
function redactByPath(obj: unknown, path: unknown, marker: unknown): void {
  if (obj == null || typeof path !== 'string') return;
  const keys = path.split('.');
  const parent = navigateToParent(obj, keys);
  const leaf = keys[keys.length - 1];
  if (parent && leaf !== undefined && leaf in parent) {
    parent[leaf] = marker;
  }
}

function redactAny(value: unknown, findings: unknown[]): unknown {
  if (typeof value === 'string') {
    const scan = scanSensitiveData(value);
    if (!scan.clean) findings.push(...scan.findings);
    return scan.redacted;
  }
  if (Array.isArray(value)) return value.map((v) => redactAny(v, findings));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = redactAny(v, findings);
    return out;
  }
  return value;
}

// Structural shield outcomes persisted with the decision (context._shields).
// null = the check never ran on this evaluation (halt, deadline) — persisted
// as absent, never as a fabricated "clean".
export type PromptInjectionShieldStatus = 'clean' | 'warned' | 'blocked' | 'disabled';
interface GuardShields {
  prompt_injection: PromptInjectionShieldStatus | null;
}

// Mutable accumulator threaded through the guard phases below.
export interface GuardAccumulator {
  reasons: string[];
  warnings: string[];
  matchedPolicies: string[];
  nonFabEvidence: unknown[];
  nonFabStripPaths: Set<string>;
  highestDecision: string;
  shields: GuardShields;
  /** Policies whose result raised warn/require_approval this evaluation (F1):
   *  the grant post-pass consults these so a rule marked ungrantable can
   *  never have its verdict cleared by an allow_grant. */
  gatingPolicies: Array<{ id: string; name: string; ungrantable: boolean }>;
}

function newAccumulator(): GuardAccumulator {
  return { reasons: [], warnings: [], matchedPolicies: [], nonFabEvidence: [], nonFabStripPaths: new Set(), highestDecision: 'allow', shields: { prompt_injection: null }, gatingPolicies: [] };
}

function raiseDecision(acc: GuardAccumulator, action: string): void {
  if (sevOf(action) > sevOf(acc.highestDecision)) acc.highestDecision = action;
}

function applyResult(result: PolicyResult, policy: PolicyRow, acc: GuardAccumulator): void {
  if (result.action === 'warn') {
    acc.warnings.push(`${policy.name}: ${result.reason}`);
  } else if (result.action !== 'allow') {
    acc.reasons.push(`${policy.name}: ${result.reason}`);
  }
  if (result.extraWarnings) {
    acc.warnings.push(...result.extraWarnings);
  }
  acc.matchedPolicies.push(policy.id);
}

// A block reason forces `block` (it always outranks a policy outcome) and is
// prepended to the reason list. Mirrors the original replay/act override shape.
function applyBlockOverride(acc: GuardAccumulator, reason: string | null): void {
  if (!reason) return;
  if (DECISION_SEVERITY.block >= sevOf(acc.highestDecision)) {
    acc.highestDecision = 'block';
  }
  acc.reasons.unshift(reason);
}

// Flat (no else-if chain — those desugar to nested elses) replay reason lookup.
function replayReasonFor(replayStatus: string): string | null {
  const required = getJtiReplayMode() === 'required';
  if (replayStatus === 'replayed') return `Replay detected: jti has been seen in a prior verified guard call within its exp window.`;
  if (replayStatus === 'exp_too_far') return `Token exp exceeds the configured max TTL (DASHCLAW_JTI_MAX_TTL_SECONDS).`;
  if (replayStatus === 'unavailable' && required) return `Replay store unreachable and DASHCLAW_JTI_REPLAY_PROTECTION=required.`;
  if (replayStatus === 'not_present' && required) return `Verified token has no jti claim and DASHCLAW_JTI_REPLAY_PROTECTION=required.`;
  return null;
}

// Phase 2b (issue #120): replay block decision, decided at the audit boundary.
function computeReplayBlockReason(context: GuardEvalContext, orgId: string): string | null {
  const replayStatus = context.replay_status || 'not_applicable';
  const reason = replayReasonFor(replayStatus);
  if (reason) {
    console.warn('[Guard] Replay-protection block:', {
      reason, replay_status: replayStatus, jti: context.jti || null, agent_id: context.agent_id || null, org_id: orgId,
    });
  }
  return reason;
}

const ACT_BINDING_INCOMPLETE = ['not_present', 'unsupported_typ', 'ctx_incomplete'];

// Phase 2c (issue #121): action-binding block decision. Mirrors replay_status —
// its own axis, decided here at the audit boundary, never re-checked.
function computeActBindingBlockReason(context: GuardEvalContext, orgId: string): string | null {
  const actBindingMode = getActBindingMode();
  const actStatus = context.act_status || 'not_applicable';
  let reason: string | null = null;
  if (actBindingMode !== 'off' && actStatus === 'mismatch') {
    reason = 'Action-binding mismatch: token committed to a different (action, target, goal) than this call.';
  } else if (actBindingMode === 'required' && ACT_BINDING_INCOMPLETE.includes(actStatus)) {
    reason = `Action-binding ${actStatus} and DASHCLAW_ACT_BINDING=required.`;
  }
  if (reason) {
    console.warn('[Guard] Action-binding block:', {
      reason, act_status: actStatus, agent_id: context.agent_id || null, org_id: orgId,
    });
  }
  return reason;
}

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
async function computePredictiveRisk(
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

async function runExternalVerdict(
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

interface GuardOptions {
  includeSignals?: boolean;
  computeSignals?: (orgId: string, agentId: string | null, sql: GuardSql) => Promise<Array<{ type: string; label: string }>>;
  /**
   * Side-effect-free dry-run (preflight plan preview). Skips exactly:
   *  - guard_decisions persistence and the GUARD_DECISION_CREATED event publish
   *  - BOTH grant passes (applyOperatorApprovalGrant, applyPlanStepGrant) — a
   *    dry-run must never consume a real single-use grant
   *  - webhook_check policies (runWebhookPolicies) — a dry-run must not fire
   *    real outbound HTTP to a customer endpoint or write a webhook_deliveries
   *    row for a preview the operator hasn't even reviewed yet
   * All other read/raise phases still run (local policies, prompt-injection
   * scan, calibration controller, signals), so the preview verdict reflects
   * everything EXCEPT the side effects above.
   * Do not pass signed contexts (jwt/jti) into simulate evaluations: jti
   * recording happens in resolveAgentIdentity at the route boundary, outside
   * this flag's reach — a dry-run with a live jti would consume it and poison
   * the real call.
   */
  simulate?: boolean;
}

// Shared per-evaluation dependencies threaded through the guard phases.
interface GuardPhaseDeps {
  context: GuardEvalContext;
  sql: GuardSql;
  orgId: string;
}

// A policy that is ACTIVE but cannot run is a silent-enforcement gap: the
// operator sees it listed as on while it governs nothing. Surface it on every
// decision (warnings ride the response + signals) and log once per policy per
// instance so the hot path doesn't spam. The doctor's policy-integrity check
// covers the same conditions statically.
const unenforceableWarned = new Set<string>();

function notePolicyUnenforceable(acc: GuardAccumulator, policy: PolicyRow, why: string): void {
  acc.warnings.push(`Policy "${policy.name}" (${policy.id}) is ACTIVE but cannot enforce: ${why}`);
  const key = `${policy.id}:${why}`;
  if (!unenforceableWarned.has(key)) {
    unenforceableWarned.add(key);
    console.warn('[Guard] active policy cannot enforce:', { policy_id: policy.id, name: policy.name, why });
  }
}

async function runLocalPolicies(
  policies: PolicyRow[],
  deps: GuardPhaseDeps,
  adjustedRiskScore: number,
  acc: GuardAccumulator,
): Promise<void> {
  const { context, sql, orgId } = deps;
  for (const policy of policies) {
    if (!isKnownPolicyType(policy.policy_type)) {
      notePolicyUnenforceable(acc, policy, `unknown policy_type "${policy.policy_type}"`);
      continue;
    }
    let rules: PolicyRules;
    try {
      rules = JSON.parse(policy.rules);
    } catch {
      notePolicyUnenforceable(acc, policy, 'rules is not valid JSON');
      continue;
    }

    const result = await evaluatePolicy(policy, rules, context, sql, orgId, adjustedRiskScore);
    if (!result) continue;
    applyResult(result, policy, acc);
    if (result.nonFabrication) {
      acc.nonFabEvidence.push(result.nonFabrication);
      for (const p of result.stripPaths || []) acc.nonFabStripPaths.add(p);
    }
    // Gating ledger (F1): remember which policy raised warn/require_approval
    // and whether the operator marked it ungrantable, so the grant post-pass
    // can refuse to clear it. Blocks need no entry — grants never touch them.
    if (result.action === 'warn' || result.action === 'require_approval') {
      acc.gatingPolicies.push({ id: policy.id, name: policy.name, ungrantable: rules.ungrantable === true });
    }
    raiseDecision(acc, result.action);
  }
}

/**
 * allow_grant post-pass: a matching grant downgrades warn / require_approval
 * to allow. It can NEVER override block — blocks are absolute.
 */
function applyAllowGrants(
  policies: PolicyRow[],
  context: GuardEvalContext,
  acc: GuardAccumulator,
  riskScore: number,
): void {
  // Final fix-wave IMPORTANT 2 (2026-07-27) / Locked Decision 5
  // (RFC containment-verdicts): "promote click grants exactly one" — an
  // operator-configured allow_grant policy must never be able to authorize a
  // containment merge. Without this guard, an allow_grant policy simply
  // naming action_type containment_promote would downgrade EVERY merge for
  // EVERY contained action into standing, pre-emptive authorization —
  // exactly the ungoverned-merge outcome the builtin containment_promote
  // raise exists to prevent.
  if (context.action_type === 'containment_promote') return;
  if (acc.highestDecision !== 'warn' && acc.highestDecision !== 'require_approval') return;
  // Ungrantable gate (F1): a verdict raised by a rule the operator marked
  // ungrantable is never cleared by a grant — control-plane and catastrophe
  // rules survive the org's accumulated grant pile. The warning keeps the
  // suppression attempt visible in the decision record.
  const ungrantable = acc.gatingPolicies.find((g) => g.ungrantable);
  if (ungrantable) {
    acc.warnings.push(`${ungrantable.name}: marked ungrantable — allow_grant policies cannot clear this verdict`);
    return;
  }
  for (const policy of policies) {
    if (policy.policy_type !== 'allow_grant') continue;
    let rules: PolicyRules;
    try {
      rules = JSON.parse(policy.rules);
    } catch {
      // Fail-closed direction (grant just doesn't downgrade), but still honest:
      // the operator configured a grant that silently never applies.
      notePolicyUnenforceable(acc, policy, 'rules is not valid JSON');
      continue;
    }
    // TTL (F1): an expired grant is inert. Silent skip — expiry is a normal
    // lifecycle state surfaced on /policies, not a misconfiguration.
    if (grantIsExpired(rules, policy.created_at)) continue;
    if (grantMatches(rules as { action_type?: unknown; target_prefix?: unknown }, context)) {
      // Risk ceiling. Without it a grant minted on a routine act keeps clearing
      // the approval gate for a matching act at ANY score for its whole TTL —
      // a grant on one scratchpad file would downgrade a risk-95 act against
      // that same file. The operator surface only offers "don't ask again"
      // below RISK_HIGH_MIN; this is what makes that promise true.
      //
      // `continue`, not `return`: a narrower grant later in the list must still
      // get its chance to match.
      //
      // The skip is announced. A silent one reads as "my grant stopped working"
      // with nothing in the decision record to explain why.
      const ceilingRules = rules as { max_risk?: unknown };
      if (!grantCoversRisk(ceilingRules, riskScore)) {
        acc.warnings.push(`${policy.name}: grant does not cover risk ${riskScore} (ceiling ${grantMaxRisk(ceilingRules)})`);
        continue;
      }
      acc.warnings.push(`${policy.name}: grant downgraded ${acc.highestDecision} to allow`);
      acc.matchedPolicies.push(policy.id);
      acc.highestDecision = 'allow';
      acc.reasons.length = 0; // gating reasons no longer apply
      return;
    }
  }
}

/**
 * Approval-pause post-pass: while an operator-set pause is live, a
 * require_approval verdict proceeds instead of queueing for a human.
 *
 * Why this exists at all. Approval fatigue is the documented cause of
 * governance being switched off wholesale here — MAINTAINER.md records "all
 * org policies were turned off for 18 days in June 2026 because of friction",
 * and the product metric it names is precision of interruption. A bounded,
 * self-expiring, loudly-rendered pause is the harm-reduction form of the thing
 * operators do anyway: they get relief without deleting their policy set, and
 * the posture restores itself instead of depending on anyone remembering.
 *
 * Four things it deliberately does NOT do:
 *  - It never touches `block`. Blocks are absolute (MAINTAINER.md §1), so this
 *    pass returns early on anything that is not exactly require_approval.
 *  - It never clears a verdict raised by an `ungrantable` rule (F1), so
 *    control-plane and catastrophe interruptions still reach a human. Opening
 *    those would make the pause a wider hole than the whole grant pile.
 *  - It never edits a policy row. Configuration is untouched, so expiry
 *    restores the exact prior posture with nothing to reconcile.
 *  - It never claims a human approved anything. The downgrade is stamped onto
 *    the decision (matched policy + warning) so the ledger reads "proceeded
 *    under an operator pause", not "approved" — the same honesty contract
 *    observe mode carries.
 *
 * Read-only, so it also runs under `simulate`: a preflight preview must show
 * the posture the real call would meet. It runs BEFORE the consuming grant
 * passes so a pause never burns an operator's single-use approval.
 */
async function applyApprovalPause(deps: GuardPhaseDeps, acc: GuardAccumulator): Promise<void> {
  if (acc.highestDecision !== 'require_approval') return;
  const ungrantable = acc.gatingPolicies.find((g) => g.ungrantable);
  if (ungrantable) {
    acc.warnings.push(
      `${ungrantable.name}: marked ungrantable — the approval pause cannot clear this verdict`
    );
    return;
  }
  try {
    const pause = await getActiveApprovalPause(deps.sql, deps.orgId);
    if (!pause) return;
    acc.warnings.push(
      `Approval pause active until ${pause.until}${pause.actor ? ` (set by ${pause.actor})` : ''} — ` +
      'require_approval proceeded WITHOUT human review. No human approved this action.'
    );
    acc.matchedPolicies.push('builtin:approval_pause');
    acc.highestDecision = 'allow';
    // Same forensic move as the grant passes: the gating reasons stop deciding
    // but stay visible, so the row still says WHY this would have interrupted.
    acc.warnings.push(...acc.reasons.map((r) => `paused past: ${r}`));
    acc.reasons.length = 0;
  } catch (err) {
    // Fail closed: an unreadable pause leaves require_approval standing.
    console.warn('[Guard] approval-pause lookup failed:', (err as Error).message);
  }
}

/**
 * Interruption-budget post-pass: a policy interrupting far past the rate a
 * human can answer is treated as a DEFECT, and its verdict is downgraded from
 * require_approval to `warn` until it stops being one.
 *
 * Why this exists, and why it is not just another grant. Every other
 * relaxation path in this engine — allow_grant, precedent, the approval pause,
 * relax_policy_scope, deactivate_policy, raise_risk_threshold — needs a human
 * to have ADJUDICATED something: clicked approve, clicked ratify, clicked
 * pause. On 2026-08-16 this org took 1,759 require_approval decisions in seven
 * days, resolved effectively none (the volume is precisely what stops anyone
 * working the queue), and every one of those six mechanisms therefore stayed
 * silent. The operator's only remaining move was to disable every policy in
 * the org, which is what happened. A relief valve that requires the drowning
 * person to reach up and open it is not a relief valve.
 *
 * The signal here is the one that survives an operator who has stopped
 * clicking: how often the rule fired.
 *
 * What it deliberately does NOT do:
 *  - It never reaches `allow`. `warn` still records, still renders in the
 *    ledger, still shows on /decisions — the operator loses the interrupt, not
 *    the evidence. This is the whole difference between "this rule is
 *    miscalibrated" (what volume proves) and "this act is safe" (what it does
 *    not).
 *  - It never touches `block`. Blocks are absolute (MAINTAINER.md §1).
 *  - It never demotes a rule marked `ungrantable` (F1). A rule an attacker can
 *    disarm BY FIRING IT is not a rule; catastrophe and control-plane
 *    interruptions keep reaching a human however noisy they get. Those surface
 *    as a proposal on /policies instead, where one click deactivates them.
 *  - It never demotes when ANY gating policy is under budget. One healthy rule
 *    on the same action keeps the interrupt: relief is only ever as wide as
 *    the defect.
 *  - It never edits a policy row. The demotion expires on its own from the
 *    rolling window, restoring the exact prior posture with nothing to
 *    reconcile.
 *
 * Read-only, so it runs under `simulate` too, and it runs beside the approval
 * pause — before the CONSUMING grant passes, so a demotion never burns an
 * operator's single-use approval.
 */
async function applyInterruptionBudget(deps: GuardPhaseDeps, acc: GuardAccumulator): Promise<void> {
  if (acc.highestDecision !== 'require_approval') return;
  if (acc.gatingPolicies.length === 0) return;
  // F1: an ungrantable rule is never auto-relaxed, however loud it gets. The
  // warning keeps the over-budget condition visible in the decision record so
  // the ledger explains why nothing was relaxed.
  const ungrantable = acc.gatingPolicies.find((g) => g.ungrantable);
  if (ungrantable) {
    acc.warnings.push(
      `${ungrantable.name}: marked ungrantable — the interruption budget cannot downgrade this verdict`
    );
    return;
  }
  const demote = (marker: string, why: string): void => {
    acc.warnings.push(
      `${why} — downgraded to a warning WITHOUT human review. No human approved this action. ` +
      'Review it on /policies.'
    );
    acc.matchedPolicies.push(marker);
    acc.highestDecision = 'warn';
    // Same forensic move as the pause and grant passes: the gating reasons stop
    // deciding but stay visible, so the row still says WHY it would have asked.
    acc.warnings.push(...acc.reasons.map((r) => `over-budget past: ${r}`));
    acc.reasons.length = 0;
  };

  try {
    // Grain 1 — the whole policy is unlivable. EVERY gating policy must be over
    // budget: a single well-calibrated rule raising the same verdict means the
    // interrupt is earned, and relief is only ever as wide as the defect.
    const over = await getOverBudgetPolicyIds(deps.sql, deps.orgId);
    if (over.size > 0 && acc.gatingPolicies.every((g) => over.has(g.id))) {
      const names = acc.gatingPolicies.map((g) => g.name).join(', ');
      demote(
        'builtin:interruption_budget',
        `Interruption budget exceeded by ${names}, which is interrupting faster than anyone can answer`,
      );
      return;
    }

    // Grain 2 — the policy is fine, ONE command shape is spamming. Surgical:
    // the rule keeps enforcing for everything else it covers.
    const shapeKey = commandShapeKey(deps.context.declared_goal);
    if (!shapeKey) return; // unreadable goal is never budgeted
    const shapes = await getOverBudgetShapeKeys(deps.sql, deps.orgId);
    if (!shapes.has(shapeKey)) return;
    demote(
      'builtin:shape_budget',
      `"${shapeKey}" has asked for approval more than ${INTERRUPTION_BUDGET_DEFAULTS.shapePerWindow}× ` +
      `in ${INTERRUPTION_BUDGET_DEFAULTS.windowHours}h`,
    );
  } catch (err) {
    // Fail closed: an unreadable budget leaves require_approval standing.
    console.warn('[Guard] interruption-budget lookup failed:', (err as Error).message);
  }
}

// How long a HITL approval covers a re-evaluation of the same action. Short on
// purpose: it absorbs the "operator approved after the hook's wait timed out,
// agent retries the identical call" loop, not standing permission.
const OPERATOR_APPROVAL_WINDOW_MINUTES = 15;

/**
 * Operator-approval post-pass: a recent HITL approval for the same agent,
 * the exact same declared_goal, AND the same action_type downgrades
 * require_approval to allow — ONCE.
 *
 * Why: the hook's approval wait times out (~30s) long before most operators
 * click approve. The retried tool call is a NEW evaluation with a new
 * idempotency key, so without this pass it re-queues for approval and the
 * granted approval is never honored. `approved_by` is only ever set by the
 * admin-gated approvals routes, and only on ALLOW (deny leaves it NULL), so
 * its presence IS the grant.
 *
 * Single-use (ADR Phase 2): the grant is CONSUMED atomically — the UPDATE
 * stamps approval_grant_used_at (drizzle/0045) under `IS NULL`, so one
 * approval covers exactly one retry even under concurrent identical calls
 * (Postgres row locking picks a single winner). Exact idempotent retries
 * still replay the resulting allow via the idempotency short-circuit, so the
 * approve-then-retry UX is unchanged. Binding on action_type stops a generic
 * goal string from carrying one approval across different action kinds.
 *
 * Act-content binding (drizzle/0056): when the approved row was created with
 * an act payload (evidence-first guard), its server-computed act_content_hash
 * is part of the match — the grant only covers a retry presenting the SAME
 * act, recomputed here from the retry's own payload. Rows without a stamp
 * keep the tuple match (legacy SDKs, non-act creators): the binding only
 * ever tightens a grant, it never loosens one. Approving act X can no longer
 * authorize a different act Y that shares the tuple.
 *
 * Like allow_grant, this can NEVER override block — blocks are absolute.
 * Best-effort: a lookup failure (including a pre-0045 schema missing the
 * column) leaves the decision at require_approval (fails closed).
 */
async function applyOperatorApprovalGrant(deps: GuardPhaseDeps, acc: GuardAccumulator): Promise<void> {
  if (acc.highestDecision !== 'require_approval') return;
  const { context, sql, orgId } = deps;
  if (!context.agent_id || !context.declared_goal) return;
  try {
    const actionType = context.action_type ?? null;
    // Recomputed server-side from the retry's act — a NULL here (no act on
    // the retry) can only match rows that were never act-stamped.
    const retryActHash = computeActContentHash(context.act);
    const rows = await sql`
      UPDATE action_records
      SET approval_grant_used_at = NOW()
      WHERE action_id = (
        SELECT action_id
        FROM action_records
        WHERE org_id = ${orgId}
          AND agent_id = ${context.agent_id}
          AND declared_goal = ${context.declared_goal}
          AND (${actionType}::text IS NULL OR action_type = ${actionType})
          AND (act_content_hash IS NULL OR act_content_hash = ${retryActHash})
          AND approved_by IS NOT NULL
          AND approved_by <> ''
          AND approved_at > NOW() - make_interval(mins => ${OPERATOR_APPROVAL_WINDOW_MINUTES})
          AND approval_grant_used_at IS NULL
        ORDER BY approved_at DESC
        LIMIT 1
      )
        AND org_id = ${orgId}
        AND approval_grant_used_at IS NULL
      RETURNING action_id, approved_by, act_content_hash
    `;
    const grant = rows[0];
    if (!grant) return;
    acc.warnings.push(
      `Covered by operator approval ${grant.action_id} (approved by ${grant.approved_by}${grant.act_content_hash ? ', act-bound' : ''}) — require_approval downgraded to allow`
    );
    acc.matchedPolicies.push('builtin:operator_approval');
    acc.highestDecision = 'allow';
    // T6: the gating reasons no longer block the decision, but they are
    // forensic context (WHY the action originally needed approval) — moving
    // them to warnings keeps that trail visible instead of discarding it.
    acc.warnings.push(...acc.reasons.map((r) => `superseded by grant: ${r}`));
    acc.reasons.length = 0; // gating reasons no longer apply
  } catch (err) {
    console.warn('[Guard] operator-approval lookup failed:', (err as Error).message);
  }
}

/**
 * Preflight plan-authorization post-pass (RFC 2026-07-06, feature 1 of the
 * governed-autonomy program). Two checks, in tighten-first order:
 *
 *  1. Deny-grant: a step the operator EXPLICITLY denied raises any non-block
 *     decision to block on match (applyBlockOverride) for the plan's TTL.
 *     Runs regardless of the current decision — an operator "no" outranks a
 *     policy "yes". Read-only: denied steps are never consumed. Requires
 *     only action_type plus at least one matchable binding (a declared_goal
 *     or an act hash) — NOT agent_id (findDeniedStepMatch deliberately
 *     doesn't scope on it, see its docblock) and NOT both goal AND act. A
 *     deny check must not be skippable by simply omitting one optional
 *     field — that would let an attacker evade an operator's explicit "no".
 *  2. Consumption: when the decision is require_approval, an approved,
 *     unconsumed, unexpired, act-or-goal-bound step is consumed atomically
 *     (single UPDATE ... WHERE grant_used_at IS NULL RETURNING — the same
 *     race shape as the operator grant above) and the decision downgrades to
 *     allow. Operator grants run FIRST (more specific; they win). Requires
 *     the full triple (agent_id, declared_goal, action_type) — a grant is
 *     only usable by the agent+goal it was actually issued to, so this half
 *     stays strict.
 *
 * Never touches block. Never runs in simulate mode (gated at the call site).
 * Fail-soft/fail-closed split, NOT uniform: the deny lookup fails CLOSED
 * (an unverifiable denial state raises to require_approval — see the catch
 * below) because a grant downgrade built on top of a broken deny check would
 * be unsafe; the consumption lookup fails SOFT (a failed consumption simply
 * leaves require_approval, which is already the safe state).
 */
// U3: the operator's preview verdict (preview_decision, stamped at plan
// submission) vs. what the LIVE evaluation just raised (live_reasons_count)
// is the audit trail for drift inside the grant's TTL window.
export type PlanGrantInfo = { plan_id: string; step_id: string; seq: number; preview_decision: string | null; live_reasons_count: number };

async function applyPlanStepGrant(deps: GuardPhaseDeps, acc: GuardAccumulator): Promise<PlanGrantInfo | null> {
  const { context, sql, orgId } = deps;
  // Final fix-wave IMPORTANT 2 (2026-07-27) / Locked Decision 5
  // (RFC containment-verdicts): same reasoning as applyAllowGrants above —
  // an operator-approved plan step must never stand in for the promote
  // click's single-use grant. A containment_promote action is never a
  // legitimate plan step in the first place (it's the synthetic merge row
  // minted by the containment route, not something a plan ever proposes),
  // so this excludes it from both the deny-check and consumption phases.
  if (context.action_type === 'containment_promote') return null;
  const declaredGoal = context.declared_goal || '';
  const actHash = computeActContentHash(context.act);
  // V2: the entry guard used to require context.action_type unconditionally,
  // which meant a denial could never fire on a hash-only match if the
  // (self-asserted) caller simply omitted action_type this time. The deny
  // check only needs SOME matchable binding — action_type or an act hash —
  // not action_type specifically; findDeniedStepMatch's hash branch doesn't
  // use action_type at all.
  if (!context.action_type && !actHash) return null;
  if (acc.highestDecision === 'block') return null;

  // U1: the deny check must not be gated behind the full triple — it runs
  // off action_type plus whichever binding is present (goal and/or act
  // hash). An empty declaredGoal simply won't match the SQL step_goal
  // equality, which is correct when only the act-hash binding is present.
  if (declaredGoal || actHash) {
    try {
      const { findDeniedStepMatch } = await import('../repositories/plans.repository');
      const denied = await findDeniedStepMatch(sql as never, orgId, {
        actionType: context.action_type ?? null,
        declaredGoal,
        actHash,
      });
      if (denied) {
        applyBlockOverride(acc, `Plan step ${denied.step_id} was explicitly denied by ${denied.reviewed_by || 'operator'}`);
        acc.matchedPolicies.push('builtin:plan_deny');
        return null;
      }
    } catch (err) {
      // U2: fail CLOSED — an unverifiable denial state must not silently let
      // a grant downgrade proceed. Raise (never lower) to require_approval
      // and skip consumption entirely; unlike the fail-soft consumption
      // catch below, a require_approval left in place here could otherwise
      // still be downgraded by a grant this same call never got to check.
      console.warn('[Guard] plan-deny lookup failed — failing closed:', (err as Error).message);
      acc.reasons.push('Plan-denial lookup unavailable — failing closed to human review');
      acc.matchedPolicies.push('builtin:plan_deny_failsafe');
      raiseDecision(acc, 'require_approval');
      return null;
    }
  }

  // Consumption keeps the strict full-triple requirement — action_type is
  // no longer guaranteed by the entry guard above (V2 relaxed it to allow a
  // hash-only deny check), so it must be re-asserted here explicitly.
  if (!context.agent_id || !context.action_type || !declaredGoal) return null;
  if (acc.highestDecision !== 'require_approval') return null;

  try {
    const { consumePlanStepGrant } = await import('../repositories/plans.repository');
    const grant = await consumePlanStepGrant(sql as never, orgId, {
      agentId: context.agent_id,
      actionType: context.action_type,
      declaredGoal,
      actHash,
      // W4: an honest NULL when there's no action_id, not an empty string —
      // SQL handles NULL fine, and '' previously read as "matched but blank".
      matchedActionId: context.action_id ? String(context.action_id) : null,
    });
    if (!grant) return null;
    acc.warnings.push(
      `Covered by plan ${grant.plan_id} step ${grant.seq}/${grant.total_steps} (approved by ${grant.reviewed_by || 'operator'}${grant.act_content_hash ? ', act-bound' : ''}) — require_approval downgraded to allow`,
    );
    acc.matchedPolicies.push('builtin:plan_grant');
    acc.highestDecision = 'allow';
    // U3: capture BEFORE the reasons are moved to warnings below — this is
    // the audit trail for TTL-window drift between the operator's preview
    // verdict (grant.preview_decision, stamped at submission review time)
    // and what the LIVE evaluation actually raised just now.
    const liveReasonsCount = acc.reasons.length;
    // T6: parity with applyOperatorApprovalGrant — preserve the gating
    // reasons as warnings instead of discarding them, so the forensic trail
    // (why the action originally needed approval) survives the downgrade.
    acc.warnings.push(...acc.reasons.map((r) => `superseded by grant: ${r}`));
    acc.reasons.length = 0; // gating reasons no longer apply
    return {
      plan_id: grant.plan_id, step_id: grant.step_id, seq: grant.seq,
      preview_decision: grant.preview_decision, live_reasons_count: liveReasonsCount,
    };
  } catch (err) {
    // Fail-soft: a failed consumption simply leaves require_approval intact
    // — already the safe state, unlike the deny lookup above.
    console.warn('[Guard] plan-grant consumption lookup failed:', (err as Error).message);
    return null;
  }
}

// Default-on prompt injection scanning (opt-out via DISABLE_PROMPT_INJECTION_SCAN=true).
function scanPromptInjection(context: GuardEvalContext, acc: GuardAccumulator): void {
  if (process.env.DISABLE_PROMPT_INJECTION_SCAN === 'true') {
    acc.shields.prompt_injection = 'disabled';
    return;
  }
  acc.shields.prompt_injection = 'clean';
  const textFields = [context.declared_goal, context.action_type].filter(Boolean) as string[];
  for (const text of textFields) {
    const scan = scanForPromptInjection(text);
    if (scan.clean) continue;
    const reason = `Prompt injection detected (${scan.risk_level}): ${scan.categories.join(', ')}`;
    if (scan.recommendation === 'block') {
      acc.reasons.push(reason);
      acc.matchedPolicies.push('builtin:prompt_injection_scan');
      raiseDecision(acc, 'block');
      acc.shields.prompt_injection = 'blocked';
    } else if (scan.recommendation === 'warn') {
      acc.warnings.push(reason);
      if (acc.shields.prompt_injection !== 'blocked') acc.shields.prompt_injection = 'warned';
    }
  }
}

// Process webhook_check policies after local policies, so the preliminary
// decision (a snapshot of acc at this point) is known to the customer endpoint.
async function runWebhookPolicies(
  policies: PolicyRow[],
  deps: GuardPhaseDeps,
  acc: GuardAccumulator,
): Promise<void> {
  const { context, sql, orgId } = deps;
  const webhookPolicies = policies.filter((p) => p.policy_type === 'webhook_check');
  const preliminary: Preliminary = {
    decision: acc.highestDecision,
    reasons: [...acc.reasons],
    warnings: [...acc.warnings],
    matchedPolicies: [...acc.matchedPolicies],
  };
  // Each policy's outbound HTTP call is independent and reads only the
  // frozen `preliminary` snapshot above — launch them all concurrently
  // instead of awaiting one at a time inside the shared 3500ms guard
  // deadline (N policies used to cost up to N * 10s of sequential timeout
  // headroom). Outcomes are applied to `acc`
  // sequentially in ORIGINAL policy order below so reasons/warnings/
  // matchedPolicies ordering stays deterministic regardless of which
  // provider answers first.
  type WebhookOutcome =
    | { policy: PolicyRow; kind: 'unenforceable'; why: string }
    | { policy: PolicyRow; kind: 'result'; webhookResult: PolicyResult | null };
  const outcomes = await Promise.all(webhookPolicies.map(async (policy): Promise<WebhookOutcome> => {
    let rules: PolicyRules;
    try {
      rules = JSON.parse(policy.rules);
    } catch {
      return { policy, kind: 'unenforceable', why: 'rules is not valid JSON' };
    }
    const webhookResult = await evaluateWebhookPolicy(policy, rules, context, orgId, sql, preliminary);
    return { policy, kind: 'result', webhookResult };
  }));
  for (const outcome of outcomes) {
    if (outcome.kind === 'unenforceable') {
      notePolicyUnenforceable(acc, outcome.policy, outcome.why);
      continue;
    }
    if (!outcome.webhookResult) continue;
    applyResult(outcome.webhookResult, outcome.policy, acc);
    raiseDecision(acc, outcome.webhookResult.action);
  }
}

/**
 * Calibrated interruption controller (calibration.ts; theory §1). Runs after
 * the last phase where policies can raise the decision and BEFORE the grant
 * post-passes, so an operator-approval grant still covers a controller-raised
 * interruption (the approve-then-retry loop keeps working).
 *
 * Charter-compliant by construction: shadow mode only RECORDS what the
 * calibrated threshold would do; active mode only ever RAISES to
 * require_approval via raiseDecision (tighten-only — it can never downgrade
 * anything and never touches block). Best-effort: a failure here must never
 * block guard.
 */
async function runCalibrationController(
  deps: GuardPhaseDeps,
  adjustedRiskScore: number,
  acc: GuardAccumulator,
): Promise<CalibrationAssessment | null> {
  const { context, sql, orgId } = deps;
  try {
    const runtime = await getCalibrationRuntime(sql, orgId);
    if (!runtime) return null;
    const assessment = assessCalibration(runtime.state, runtime.settings, adjustedRiskScore, context.agent_id || null);
    let applied = false;
    if (
      runtime.settings.mode === 'active' &&
      (assessment.would_interrupt || assessment.agent_alarmed) &&
      sevOf(acc.highestDecision) < DECISION_SEVERITY.require_approval
    ) {
      applied = true;
      const reason = assessment.would_interrupt
        ? `Calibration controller: risk ${adjustedRiskScore} ≥ calibrated threshold ${Math.round(assessment.theta * 10) / 10} (target false-interruption rate ${runtime.settings.targetRate})`
        : `Calibration alarm: agent denial e-process crossed its anytime-valid threshold — human review required`;
      acc.reasons.push(reason);
      acc.matchedPolicies.push(CALIBRATION_POLICY_ID);
      raiseDecision(acc, 'require_approval');
    }
    return { ...assessment, applied };
  } catch (err) {
    console.warn('[Guard] calibration controller failed (continuing without):', (err as Error).message);
    return null;
  }
}

async function runSignalChecks(
  deps: GuardPhaseDeps,
  options: GuardOptions,
  acc: GuardAccumulator,
): Promise<void> {
  if (!options.includeSignals || !options.computeSignals) return;
  const { context, sql, orgId } = deps;
  try {
    const signals = await options.computeSignals(orgId, context.agent_id || null, sql);
    for (const signal of signals) {
      acc.warnings.push(`Active signal: ${signal.type} — ${signal.label}`);
    }
  } catch {
    // Signal check is best-effort
  }
}

// The classifier's finding plus what the policy engine did with it — echoed
// into guard_decisions.context as _plan_deviation (a SIBLING breakdown key,
// never inside the hashed score vector) and persisted as a plan_deviations
// row after the decision row lands.
export type PlanDeviationOutcome = DeviationFinding & { policy_outcome: string };

/**
 * Plan deviation detection (RFC 2026-08-11-plan-deviation-events §8). Runs on
 * EVERY guarded action for all four decisions — NOT inside applyPlanStepGrant,
 * which is gated on require_approval and structurally cannot see an off-plan
 * action that evaluates to allow. Placement: after the grant passes (a step
 * consumed this evaluation is a confirmed match; only its declared scope can
 * still be violated), never under simulate (the caller gates that — a plan's
 * own dry-run preview must not deviate against the plan being previewed).
 *
 * D3: fail-soft, wrapped whole — a broken deviation computation must never
 * block, delay, or fail a guard call. Detection and consequence stay separate
 * subsystems: the finding is always returned for recording (D1); only the
 * deviation_response policy pass below decides whether anything is raised.
 */
async function runDeviationCheck(
  deps: GuardPhaseDeps,
  acc: GuardAccumulator,
  policies: PolicyRow[],
  planGrant: PlanGrantInfo | null,
  adjustedRiskScore: number,
): Promise<PlanDeviationOutcome | null> {
  const { context, sql, orgId } = deps;
  try {
    if (!context.agent_id) return null;
    // Same exclusion as the grant passes: the synthetic containment merge row
    // is never a legitimate plan step.
    if (context.action_type === 'containment_promote' || context.declared_action_type === 'containment_promote') return null;
    // Hot-path pre-gate: the overwhelmingly common planless case costs a 30s
    // cache hit and no query.
    if (!(await getHasLivePlan(sql, orgId, context.agent_id))) return null;
    const { getLivePlanForAgent } = await import('../repositories/plans.repository');
    const live = await getLivePlanForAgent(sql as never, orgId, context.agent_id);
    if (!live || live.steps.length === 0) return null;

    const observed = {
      action_type: context.action_type ?? null,
      declared_goal: context.declared_goal ?? null,
      act_hash: computeActContentHash(context.act),
      target: typeof context.target === 'string' && context.target ? context.target : null,
      write_paths: Array.isArray(context.write_paths)
        ? (context.write_paths as unknown[]).filter((p): p is string => typeof p === 'string')
        : [],
      systems_touched: Array.isArray(context.systems_touched)
        ? (context.systems_touched as unknown[]).filter((s): s is string => typeof s === 'string')
        : [],
      act_summary: summarizeAct(context.act),
    };
    const finding = classifyDeviation({
      planId: live.plan_id,
      steps: live.steps as unknown as LivePlanStep[],
      observed,
      grantedStepId: planGrant?.step_id ?? null,
    });
    if (!finding) return null;

    // The agent's channel (RFC §7): a warning line on the guard response,
    // identical to the plan-grant "Covered by plan…" convention. Existing
    // clients that ignore unknown warnings are unaffected.
    acc.warnings.push(`Plan deviation: ${finding.kind} (${finding.severity}) vs plan ${finding.plan_id}`);

    // deviation_response policy pass. These policies are a no-op inside
    // runLocalPolicies (no finding exists there yet); here they get the
    // finding via a transient context stash, deleted before
    // redactContextForLog builds the persisted context — the durable copy is
    // context._plan_deviation. Raises here land AFTER the grant passes, so a
    // deviation-raised require_approval can never be cleared by a grant this
    // same evaluation (tighten-only, D2: no default row ships).
    let policyOutcome = 'none';
    const devPolicies = policies.filter((p) => p.policy_type === 'deviation_response');
    if (devPolicies.length > 0) {
      (context as Record<string, unknown>)._plan_deviation_finding = finding;
      try {
        for (const policy of devPolicies) {
          let rules: PolicyRules;
          try {
            rules = JSON.parse(policy.rules);
          } catch {
            notePolicyUnenforceable(acc, policy, 'rules is not valid JSON');
            continue;
          }
          const result = await evaluatePolicy(policy, rules, context, sql, orgId, adjustedRiskScore);
          if (!result) continue;
          applyResult(result, policy, acc);
          if (result.action === 'warn' || result.action === 'require_approval') {
            acc.gatingPolicies.push({ id: policy.id, name: policy.name, ungrantable: rules.ungrantable === true });
          }
          raiseDecision(acc, result.action);
          if (sevOf(result.action) > sevOf(policyOutcome)) policyOutcome = result.action;
        }
      } finally {
        delete (context as Record<string, unknown>)._plan_deviation_finding;
      }
    }
    return { ...finding, policy_outcome: policyOutcome };
  } catch (err) {
    console.warn('[Guard] deviation check failed (fail-soft, continuing):', (err as Error).message);
    return null;
  }
}

// SECURITY: do not store raw secrets in guard decision context.
function redactContextForLog(context: GuardEvalContext, nonFabStripPaths: Set<string>): unknown {
  const dlpFindings: unknown[] = [];
  const safeContextForLog = redactAny(context, dlpFindings);
  if (dlpFindings.length > 0) {
    console.warn(`[Guard] Redacted ${dlpFindings.length} sensitive pattern(s) from guard_decisions.context before storing.`);
  }
  for (const p of nonFabStripPaths) redactByPath(safeContextForLog, p, '[redacted:non_fabrication_input]');
  return safeContextForLog;
}

/**
 * Evaluate guard policies for an incoming agent action.
 */
interface AuditStatuses {
  verificationStatus: string;
  replayStatus: string;
  jti: string | null;
  actStatus: string;
  actHash: string | null;
}

function resolveAuditStatuses(context: GuardEvalContext): AuditStatuses {
  return {
    verificationStatus: context.verification_status || 'unverified',
    replayStatus: context.replay_status || 'not_applicable',
    jti: context.jti || null,
    actStatus: context.act_status || 'not_applicable',
    actHash: context.act_hash || null,
  };
}

// Everything the persist / event / result builders need, computed once.
interface GuardFinalizeInput {
  decisionId: string;
  orgId: string;
  context: GuardEvalContext;
  acc: GuardAccumulator;
  safeContextForLog: unknown;
  evidenceJson: string | null;
  statuses: AuditStatuses;
  adjustedRiskScore: number;
  agentRiskScore: number | null;
  evaluatedAt: string;
  predictiveRisk: { total_adjustment?: number } | null;
  riskBreakdown: RiskBreakdown;
  intentSource: 'evidence' | 'declared';
  evidenceDerived: EvidenceDerivedBreakdown | null;
  calibration: CalibrationAssessment | null;
  planGrant: PlanGrantInfo | null;
  planDeviation: PlanDeviationOutcome | null;
  externalVerdict: ExternalVerdictEvidence | null;
  timings: Record<string, number> | null;
  degraded: { kind: string; deadline_ms: number; action: string; phase_in_flight: string | null } | null;
  containment: { status: 'contained'; basis: string; ref: string } | null;
}

function buildGuardDecisionRow(input: GuardFinalizeInput): GuardDecisionInsert {
  const { context, acc, statuses } = input;
  return {
    decisionId: input.decisionId,
    orgId: input.orgId,
    agentId: context.agent_id || null,
    agentName: context.agent_name || null,
    verificationStatus: statuses.verificationStatus,
    replayStatus: statuses.replayStatus,
    jti: statuses.jti,
    actStatus: statuses.actStatus,
    actHash: statuses.actHash,
    decision: acc.highestDecision,
    reason: acc.reasons.join('; ') || null,
    matchedPolicies: acc.matchedPolicies,
    // The breakdown + shield outcomes ride inside the persisted context JSON
    // (additive, underscore-prefixed) — no schema migration, queryable via
    // jsonb. _shields is only written when a shield actually ran: absence
    // means "not recorded", never "clean".
    context: {
      ...(input.safeContextForLog as Record<string, unknown>),
      _risk_breakdown: input.riskBreakdown,
      // Grading source (evidence|declared) — posture reads this to weight the
      // enforcement dimension; the evidence sibling rides in _risk_breakdown.
      intent_source: input.intentSource,
      ...(acc.shields.prompt_injection !== null
        ? { _shields: { prompt_injection: acc.shields.prompt_injection } }
        : {}),
      // Controller assessment (shadow AND active) — the shadow-mode evidence
      // trail lives here: what the calibrated threshold would have done.
      ...(input.calibration ? { _calibration: input.calibration } : {}),
      ...(input.planGrant ? { _plan_grant: input.planGrant } : {}),
      // Score-provenance rule: a SIBLING key beside _plan_grant/_calibration —
      // never inside the hashed score vector.
      ...(input.planDeviation ? { _plan_deviation: input.planDeviation } : {}),
      // External provider verdict + provenance (RFC 2026-08-13 §5) — a
      // SIBLING beside _calibration/_plan_grant, never inside the hashed
      // score vector.
      ...(input.externalVerdict ? { _external_verdict: input.externalVerdict } : {}),
      ...(input.timings ? { _timings: input.timings } : {}),
      ...(input.degraded ? { _degraded: input.degraded } : {}),
    },
    evidence: input.evidenceJson,
    riskScore: input.adjustedRiskScore,
    actionType: context.action_type || null,
    // Denormalized from context for the indexed replay lookup (drizzle/0058);
    // the copy inside the context JSON stays for forensics/back-compat.
    idempotencyKey:
      typeof context.idempotency_key === 'string' && context.idempotency_key
        ? context.idempotency_key
        : null,
    createdAt: input.evaluatedAt,
    degraded: input.degraded !== null,
  };
}

function publishGuardDecisionEvent(input: GuardFinalizeInput): void {
  const { context, acc, statuses } = input;
  void publishOrgEvent(EVENTS.GUARD_DECISION_CREATED, {
    orgId: input.orgId,
    decision: {
      id: input.decisionId,
      org_id: input.orgId,
      agent_id: context.agent_id || null,
      agent_name: context.agent_name || null,
      verification_status: statuses.verificationStatus,
      replay_status: statuses.replayStatus,
      jti: statuses.jti,
      act_status: statuses.actStatus,
      act_hash: statuses.actHash,
      decision: acc.highestDecision,
      reason: acc.reasons.join('; ') || null,
      matched_policies: acc.matchedPolicies,
      context: input.safeContextForLog,
      risk_score: input.adjustedRiskScore,
      agent_risk_score: input.agentRiskScore,
      action_type: context.action_type || null,
      created_at: input.evaluatedAt,
      degraded: input.degraded !== null,
    },
  });
}

function buildGuardResult(input: GuardFinalizeInput) {
  const { context, acc, statuses } = input;
  return {
    decision: acc.highestDecision,
    decision_id: input.decisionId, // Canonical: the guard-evaluation id (act_gd_*).
    action_id: input.decisionId, // DEPRECATED alias of decision_id (the evaluation id, NOT action_records id).
    reason: acc.reasons.join('; ') || null,
    signals: [...acc.warnings, ...acc.reasons],
    matched_policies: acc.matchedPolicies,
    ...(acc.nonFabEvidence.length > 0 ? { non_fabrication: acc.nonFabEvidence } : {}),
    risk_score: input.adjustedRiskScore,
    agent_risk_score: input.agentRiskScore,
    risk_breakdown: input.riskBreakdown,
    intent_source: input.intentSource,
    ...(input.evidenceDerived
      ? {
          derived_action_type: input.evidenceDerived.derived_action_type,
          ...(input.evidenceDerived.mismatch ? { evidence_mismatch: true } : {}),
        }
      : {}),
    verification_status: statuses.verificationStatus,
    agent_id: context.agent_id || null,
    agent_name: context.agent_name || null,
    evaluated_at: input.evaluatedAt,
    ...(input.predictiveRisk ? { predictive_risk: input.predictiveRisk } : {}),
    ...(input.calibration ? { calibration: input.calibration } : {}),
    ...(input.degraded ? { degraded: true } : {}),
    ...(input.containment ? { containment: input.containment } : {}),
    // Backward compatibility
    reasons: acc.reasons,
    warnings: acc.warnings,
  };
}

// Evidence-first grading. Classifies the caller-attached act, derives the
// evidence sibling term, resolves declared/derived mismatch (proceeds under the
// derived action_type for policy matching), and enriches the context so
// protected_path / act-binding policies see the real target. Mutates `context`
// (action_type on mismatch, target/write_paths when absent); returns null when
// there is no gradeable evidence — the zero-behavior-change path.
function foldEvidenceIntoContext(context: GuardEvalContext): EvidenceDerivedBreakdown | null {
  const evidence = classifyAct(context.act);
  if (!evidence) return null;

  const declaredType = typeof context.action_type === 'string' ? context.action_type : undefined;
  const declaredBase = serverRiskTerms(context).base.score;
  const modifiers = evidence.modifiers.map((m) => ({ reason: m.reason, delta: m.delta }));
  let mismatch = false;
  if (evidence.derived_action_type !== declaredType && evidence.base_risk > declaredBase) {
    mismatch = true;
    modifiers.push({ reason: `declared/derived mismatch (declared ${declaredType ?? 'none'} → derived ${evidence.derived_action_type})`, delta: 10 });
    // `containment_promote` is a governance sentinel, not a risk-scored action
    // type: the builtin raise (below, ~line 973) and the operator-approval
    // grant lookup (applyOperatorApprovalGrant) both match on the STORED
    // declared type. It isn't in ACTION_TYPE_BASE_SCORES, so it always scores
    // the 'other' floor (20) and any attached act (even the canonical merge
    // act, base_risk 35) trips this mismatch. Swapping context.action_type
    // out here would make the sentinel invisible to the raise (Task 8
    // finding: act-attached containment_promote calls resolved to `allow`
    // with an empty matched_policies — RFC invariant 3, governed-merge
    // bypass) and would also break the grant lookup's action_type predicate
    // for the legitimate happy path. Evidence still raises risk (mismatch +
    // modifier kept) — only the type swap is suppressed for this sentinel.
    if (declaredType !== 'containment_promote') {
      // Keep the declared type visible to restrictive policy matching: swapping
      // to a lower-information derived type (e.g. social_post → other) must not
      // let the action dodge a rule written against the declared type.
      if (declaredType !== undefined) context.declared_action_type = declaredType;
      context.action_type = evidence.derived_action_type;
    }
  }
  const total = Math.max(0, Math.min(evidence.base_risk + modifiers.reduce((s, m) => s + m.delta, 0), 100));

  const act = context.act as ActInput | undefined;
  if (act && act.kind === 'http' && !context.target && act.request && typeof act.request.url === 'string') {
    context.target = act.request.url;
  }
  if (act && act.kind === 'file' && act.file && typeof act.file.path === 'string') {
    const paths = Array.isArray(context.write_paths) ? (context.write_paths as unknown[]).slice() : [];
    if (!paths.includes(act.file.path)) paths.push(act.file.path);
    context.write_paths = paths;
  }

  // Keep the classifier's own tags on the context so later phases can ask WHAT
  // KIND of act this was, not just how it scored. SERVER-SET-ONLY: this field
  // is deliberately absent from GUARD_INPUT_SCHEMA (app/lib/validate.js), so
  // validate() strips any caller-supplied `evidence_flags` before evaluateGuard
  // ever runs. Assigning here, after that strip, is what makes the field
  // trustworthy enough to key a downgrade on.
  const flags = Array.isArray(evidence.flags) ? evidence.flags : [];
  context.evidence_flags = flags;

  return { derived_action_type: evidence.derived_action_type, base_risk: evidence.base_risk, modifiers, total, mismatch, flags };
}

export async function evaluateGuard(orgId: string, context: GuardEvalContext, sql: GuardSql, options: GuardOptions = {}) {
  // SECURITY: orgId is the tenant boundary. Without this guard a caller bug
  // that loses orgId (null/undefined/'') would cause Postgres to evaluate
  // `WHERE org_id = NULL AND ...` which silently returns zero rows — guard
  // would then approve every action because no policies matched.
  if (!orgId || typeof orgId !== 'string') {
    throw new Error('evaluateGuard: orgId is required and must be a string');
  }

  // Evidence-first: classify the caller-attached act and fold its derived risk
  // in (evidence only RAISES). Pure/synchronous, so it runs before the deadline
  // race. intent_source rides on the context so require_evidence policies and
  // the persisted decision can read it.
  const evidenceDerived = foldEvidenceIntoContext(context);
  // 'evidence' only when the derived type IS the type this evaluation ran
  // under (equal to declared, or swapped in on mismatch). A trivial unrelated
  // act (declared deploy + `echo hi`) must not satisfy require_evidence.
  const intentSource: 'evidence' | 'declared' =
    evidenceDerived && evidenceDerived.derived_action_type === context.action_type
      ? 'evidence'
      : 'declared';
  context.intent_source = intentSource;

  // Replay + action-binding pre-checks (decided at the audit boundary).
  const replayBlockReason = computeReplayBlockReason(context, orgId);
  const actBlockReason = computeActBindingBlockReason(context, orgId);

  // Org kill switch — checked FIRST, via its dedicated 3s cache (NOT the 30s
  // settings cache: /api/halt's eager invalidation only reaches the instance
  // that served it, so the short TTL is what bounds cross-instance lag). A
  // halted org evaluates no policies: the decision is an immediate block,
  // still persisted through the audit gate below like any other decision.
  const orgHalt = await getOrgHaltState(sql, orgId);
  const orgHalted = !!orgHalt?.halted;

  const liveAcc = newAccumulator();

  // Per-phase wall-clock ledger (ms), persisted as context._timings on every
  // decision so degraded evaluations can be diagnosed against a steady-state
  // baseline. Mutated by the (possibly abandoned) evaluation — snapshot on
  // deadline, like the accumulator.
  const liveTimings: Record<string, number> = {};
  let phaseInFlight: string | null = null;
  const timed = async <T>(phase: string, fn: () => T | Promise<T>): Promise<T> => {
    phaseInFlight = phase;
    const start = Date.now();
    try {
      return await fn();
    } finally {
      liveTimings[phase] = (liveTimings[phase] ?? 0) + (Date.now() - start);
      phaseInFlight = null;
    }
  };

  // Defaults available even when the deadline fires before the async risk
  // assessment completes: the cheap synchronous server heuristic.
  const syncTerms = serverRiskTerms(context);
  const { agentRiskScore: syncAgentRisk } = computeEffectiveRisk(context);
  let agentRiskScore: number | null = syncAgentRisk;
  let adjustedRiskScore = Math.max(syncTerms.total, evidenceDerived?.total ?? 0);
  let predictiveRisk:
    | {
        total_adjustment?: number;
        statistical?: { adjustment?: number; basis?: string; failure_rate?: number; total_actions?: number; velocity?: number } | null;
        llm?: { adjustment: number; model: string; reasoning: string } | null;
        llm_skipped?: string;
      }
    | null = null;
  let calibration: CalibrationAssessment | null = null;
  let planGrant: PlanGrantInfo | null = null;
  let planDeviation: PlanDeviationOutcome | null = null;
  let externalVerdict: ExternalVerdictEvidence | null = null;
  let riskBreakdown: RiskBreakdown = {
    base: syncTerms.base,
    modifiers: syncTerms.modifiers,
    server_total: syncTerms.total,
    template: null,
    client_reported: null,
    effective: adjustedRiskScore,
    predictive: null,
    final: adjustedRiskScore,
    evidence_derived: evidenceDerived,
  };

  // Policy evaluation is bounded by a deadline (DASHCLAW_GUARD_DEADLINE_MS,
  // default 3500ms): the hook's whole HTTP budget is 5s with zero retries, so
  // an overrunning webhook/LLM/DB phase must yield a degraded decision instead
  // of bricking the hook into its timeout. The webhook caller has no
  // AbortSignal support, so the race abandons (not cancels) the slow phase.
  const deadlineMs = guardDeadlineMs();
  const evalStart = Date.now();
  // W2: flips true the instant the deadline race resolves against this
  // evaluation (below). runEvaluation keeps running in the background after
  // that (it isn't cancelled, only abandoned) and reads this flag via
  // closure to stop itself short of the grant-consuming phases — its result
  // is never returned, so there is nothing left for a grant to protect.
  let evaluationAbandoned = false;
  const runEvaluation = async (): Promise<'completed'> => {
    // Independent lookups (served from the hot-path caches when warm — 3s for
    // policies, 30s for risk templates/settings; on a
    // cold instance this halves the lookup round trips). phase_in_flight is
    // diagnostic-only and may name either phase while they overlap.
    const [policies, riskAssessment] = await Promise.all([
      timed('policies', () => loadApplicablePolicies(sql, orgId, context.agent_id || null)),
      timed('risk', () => computeRiskAssessment(sql, orgId, context, evidenceDerived)),
    ]);
    agentRiskScore = riskAssessment.agentRiskScore;
    const serverEvidenceScore = Math.max(
      riskAssessment.breakdownBase.server_total,
      riskAssessment.breakdownBase.template?.score ?? 0,
    );
    predictiveRisk = await timed('predictive', () =>
      computePredictiveRisk(sql, orgId, context, serverEvidenceScore, deadlineMs - (Date.now() - evalStart)),
    ) as typeof predictiveRisk;
    const predictiveAdjustment = predictiveRisk?.total_adjustment ?? 0;
    adjustedRiskScore = Math.round(Math.max(0, Math.min(riskAssessment.effectiveRiskScore + predictiveAdjustment, 100)));

    // Full derivation ledger — returned with the result and persisted with the
    // decision so every score is provable after the fact.
    riskBreakdown = {
      ...riskAssessment.breakdownBase,
      predictive: predictiveRisk
        ? {
            adjustment: predictiveAdjustment,
            basis: predictiveRisk.statistical?.basis,
            failure_rate: predictiveRisk.statistical?.failure_rate,
            total_actions: predictiveRisk.statistical?.total_actions,
            velocity: predictiveRisk.statistical?.velocity,
            statistical_adjustment: predictiveRisk.statistical?.adjustment,
            llm: predictiveRisk.llm ?? null,
            ...(predictiveRisk.llm_skipped ? { llm_skipped: predictiveRisk.llm_skipped } : {}),
          }
        : null,
      final: adjustedRiskScore,
    };

    const deps: GuardPhaseDeps = { context, sql, orgId };
    await timed('local_policies', () => runLocalPolicies(policies, deps, adjustedRiskScore, liveAcc));
    scanPromptInjection(context, liveAcc);
    // Containment promotions are always governed: the merge that lands staged
    // effects interrupts unless the operator's Promote click wrote the covering
    // grant (consumed below by applyOperatorApprovalGrant). RFC containment-verdicts.
    // Also checks declared_action_type: defense in depth so any future
    // reintroduction of an evidence-swap path for this sentinel (foldEvidenceIntoContext,
    // above) cannot silently disable this rail again (Task 8 finding).
    if (context.action_type === 'containment_promote' || context.declared_action_type === 'containment_promote') {
      raiseDecision(liveAcc, 'require_approval');
      liveAcc.reasons.push('Containment promotion requires operator approval');
      liveAcc.matchedPolicies.push('builtin:containment_promote');
    }
    // T2: webhook_check policies fire real outbound HTTP to a customer
    // endpoint and write a webhook_deliveries row — a simulate:true dry-run
    // (preflight plan preview) must never do either for a preview the
    // operator hasn't reviewed yet. Same gating shape as the grant passes
    // below (options.simulate short-circuits before any side effect).
    if (!options.simulate) {
      await timed('webhooks', () => runWebhookPolicies(policies, deps, liveAcc));
      // External policy verdict (RFC 2026-08-13, #219) — same slot rationale
      // as the calibration controller below: after the last phase where
      // policies can raise, BEFORE the grant post-passes, so an operator
      // approval can still cover an external `escalate` on retry (otherwise
      // an escalating provider would loop the same act through approval
      // forever). Same simulate gate as webhook_check: a dry-run preview
      // must not fire outbound HTTP at a customer-configured endpoint.
      externalVerdict = await timed('external_verdict', () =>
        runExternalVerdict(sql, orgId, context, liveAcc, deadlineMs - (Date.now() - evalStart)));
    }
    // Calibrated interruption controller — after every phase that can raise
    // via policies, before grants (so grants can still cover its raise).
    calibration = await timed('calibration', () => runCalibrationController(deps, adjustedRiskScore, liveAcc));
    // Grants run after the LAST phase where org policies can raise warn /
    // require_approval (webhook_check, above). The later phases can only append
    // warnings (runSignalChecks) or raise to block (replay/act overrides), which
    // grants never touch — so a downgrade decided here is final. The operator-
    // approval pass runs after policy grants: it only fires when the decision
    // is still require_approval.
    applyAllowGrants(policies, context, liveAcc, adjustedRiskScore);
    // Before the CONSUMING grant passes below: when a pause is live there is
    // nothing to consume, and burning an operator's single-use approval for a
    // call that was going to proceed anyway would strand a real approval.
    // Read-only, so it runs under simulate too — a preflight preview has to
    // show the posture the real call would meet.
    await timed('approval-pause', () => applyApprovalPause(deps, liveAcc));
    // Interruption budget, beside the pause and for the same reason: it is a
    // non-consuming downgrade, so it must land before the single-use grant
    // passes below. Only acts if the pause did not already clear the verdict.
    await timed('interruption-budget', () => applyInterruptionBudget(deps, liveAcc));
    if (!options.simulate) {
      // W2: an evaluation the deadline already abandoned has its result
      // discarded (the deadline branch below returns a degraded decision
      // built from the snapshot taken when the race resolved) — consuming a
      // single-use grant here for a result nobody will see just strands the
      // operator's approval. Checked immediately before EACH grant call
      // (evaluationAbandoned can flip true while either call is in flight).
      if (evaluationAbandoned) return 'completed';
      await timed('grants', () => applyOperatorApprovalGrant(deps, liveAcc));
      // S5 (accepted, not fixed): applyPlanStepGrant consumes the single-use
      // step grant here (grant_used_at set), but replayBlockReason /
      // actBlockReason (computed earlier, applied via applyBlockOverride
      // further down near persistGuardDecision) can still override the
      // decision to block after this point. A grant can therefore be burnt
      // on an action that ends up blocked anyway by replay/act-binding —
      // the agent would need a fresh plan step to retry. This matches
      // applyOperatorApprovalGrant's existing accepted behavior (same
      // ordering, same exposure); not fixed here. The deadline variant of
      // grant-burning (an abandoned evaluation consuming a grant for a
      // result that's never returned) IS closed, by the evaluationAbandoned
      // check above and below.
      if (evaluationAbandoned) return 'completed';
      planGrant = await timed('plan_grant', () => applyPlanStepGrant(deps, liveAcc));
      // Deviation detection (RFC 2026-08-11-plan-deviation-events): after the
      // grant passes so a consumed step reads as a confirmed match, inside the
      // simulate gate so a plan's own dry-run preview never deviates against
      // the plan being previewed. Fail-soft inside (D3).
      planDeviation = await timed('deviation', () =>
        runDeviationCheck(deps, liveAcc, policies, planGrant, adjustedRiskScore));
    }
    await timed('signals', () => runSignalChecks(deps, options, liveAcc));
    return 'completed';
  };

  let deadlineExceeded = false;
  let evaluationError: Error | null = null;
  if (!orgHalted) {
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
    const deadlinePromise = new Promise<'deadline'>((resolve) => {
      deadlineTimer = setTimeout(() => resolve('deadline'), deadlineMs);
    });

    try {
      const evalPromise = runEvaluation();
      let winner: 'completed' | 'deadline' | 'error';
      try {
        winner = await Promise.race([evalPromise, deadlinePromise]);
      } catch (err) {
        // Fast evaluation failure (policy load, risk read, any phase throwing
        // before the deadline). ONE degradation knob covers slow AND fast
        // failures (D2, docs/architecture/trust-and-failure-model.md): the
        // same resolveDegradedAction() contract applies below, and the
        // degraded decision still goes through the mandatory audit gate. If
        // persistence itself is down, persistGuardDecision throws and the
        // route returns 5xx — an unaudited decision is never returned.
        evaluationError = err as Error;
        winner = 'error';
      }
      deadlineExceeded = winner === 'deadline';
      if (deadlineExceeded) {
        // W2: mark the still-running evaluation abandoned before it can reach
        // (and burn) either single-use grant.
        evaluationAbandoned = true;
        // The abandoned evaluation keeps running in the background; swallow its
        // eventual rejection so it cannot surface as an unhandled rejection.
        evalPromise.catch((err: unknown) => {
          console.warn('[Guard] abandoned evaluation failed after deadline:', (err as Error)?.message || err);
        });
      }
    } finally {
      clearTimeout(deadlineTimer);
    }
  }

  // Snapshot the timing ledger before the abandoned evaluation can keep
  // mutating it; the in-flight phase is the one the deadline caught.
  const phaseAtDeadline = deadlineExceeded ? phaseInFlight : null;
  const timings: Record<string, number> | null = orgHalted
    ? null
    : { ...liveTimings, total: Date.now() - evalStart };

  // On deadline, snapshot the accumulator: the abandoned evaluation may still
  // be mutating the live one while we finalize and persist.
  const acc: GuardAccumulator = deadlineExceeded
    ? {
        reasons: [...liveAcc.reasons],
        warnings: [...liveAcc.warnings],
        matchedPolicies: [...liveAcc.matchedPolicies],
        nonFabEvidence: [...liveAcc.nonFabEvidence],
        nonFabStripPaths: new Set(liveAcc.nonFabStripPaths),
        highestDecision: liveAcc.highestDecision,
        shields: { ...liveAcc.shields },
        gatingPolicies: [...liveAcc.gatingPolicies],
      }
    : liveAcc;

  if (orgHalted) {
    // Halt means stop: an immediate block, regardless of policy outcome.
    applyBlockOverride(acc, `Org halted by ${orgHalt?.actor || 'admin'}: ${orgHalt?.reason || 'no reason given'}`);
  }

  let degradedDetail: { kind: string; deadline_ms: number; action: string; phase_in_flight: string | null } | null = null;
  if (deadlineExceeded) {
    const degraded = resolveDegradedAction();
    const note = `Guard evaluation exceeded deadline (${deadlineMs}ms) — degraded decision (${degraded})`;
    // Structured marker persisted with the decision (column + context._degraded)
    // so aggregation never falls back to string-matching the reason — and the
    // fail-open path leaves a trace too, which the reason string never did.
    degradedDetail = { kind: 'deadline', deadline_ms: deadlineMs, action: degraded, phase_in_flight: phaseAtDeadline };
    if (degraded === 'allow') {
      // Explicit fail-open escape hatch: surface the degradation as a warning.
      acc.warnings.push(note);
    } else {
      // Never downgrade a decision already reached from accumulated state.
      raiseDecision(acc, degraded);
      acc.reasons.unshift(note);
    }
    console.warn('[Guard] evaluation deadline exceeded:', { org_id: orgId, agent_id: context.agent_id || null, deadline_ms: deadlineMs, degraded, phase_in_flight: phaseAtDeadline });
  } else if (evaluationError) {
    // Fast-failure branch of the same contract (D2): identical knob, identical
    // audit path, distinguishable in the ledger via kind:'error'.
    const degraded = resolveDegradedAction();
    const errMessage = (evaluationError.message || 'unknown error').slice(0, 200);
    const note = `Guard evaluation failed (${errMessage}) — degraded decision (${degraded})`;
    degradedDetail = { kind: 'error', deadline_ms: deadlineMs, action: degraded, phase_in_flight: phaseInFlight };
    if (degraded === 'allow') {
      acc.warnings.push(note);
    } else {
      raiseDecision(acc, degraded);
      acc.reasons.unshift(note);
    }
    console.warn('[Guard] evaluation failed — degraded decision:', { org_id: orgId, agent_id: context.agent_id || null, error: errMessage, degraded, phase_in_flight: phaseInFlight });
  }

  const evaluatedAt = new Date().toISOString();
  const decisionId = `act_gd_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const safeContextForLog = redactContextForLog(context, acc.nonFabStripPaths);
  const evidenceJson = acc.nonFabEvidence.length > 0 ? JSON.stringify(acc.nonFabEvidence) : null;
  const statuses = resolveAuditStatuses(context);

  // Replay/act pre-checks override the policy outcome and prepend their reason.
  applyBlockOverride(acc, replayBlockReason);
  applyBlockOverride(acc, actBlockReason);

  // Containment finalize: eligibility + capability negotiation. Runs after every
  // raise/override so persistence, simulate previews, and the result all see the
  // negotiated decision. Skew only tightens: allow_contained → require_approval.
  const containmentOut = finalizeContainment(context, acc, riskBreakdown as unknown as Record<string, unknown>);

  const input: GuardFinalizeInput = {
    decisionId, orgId, context, acc, safeContextForLog, evidenceJson, statuses,
    adjustedRiskScore, agentRiskScore, evaluatedAt, predictiveRisk,
    riskBreakdown, intentSource, evidenceDerived, calibration, planGrant, planDeviation, externalVerdict, timings, degraded: degradedDetail,
    containment: containmentOut.containment ?? null,
  };

  if (options.simulate) {
    // Preview only: the audit trail for a dry-run is the plan row that stores
    // this verdict, not guard_decisions. Never persisted, never published.
    return { ...buildGuardResult(input), simulated: true };
  }

  // The audit persist is the mandatory blocking gate: a failure throws
  // GUARD_AUDIT_PERSIST_FAILED and no decision is ever returned.
  await persistGuardDecision(sql, buildGuardDecisionRow(input));
  publishGuardDecisionEvent(input);
  await persistPlanDeviationRow(sql, input);
  return buildGuardResult(input);
}

// D1: recording is unconditional — every decision with a finding writes the
// plan_deviations row, whatever the policy outcome, for all four decisions
// (only simulate skips, upstream). Runs AFTER persistGuardDecision so
// guard_decision_id is real. Fail-soft (D3): a failed insert costs the
// durable row — the _plan_deviation echo in guard_decisions.context survives
// — never the guard call.
async function persistPlanDeviationRow(sql: GuardSql, input: GuardFinalizeInput): Promise<void> {
  const finding = input.planDeviation;
  if (!finding) return;
  try {
    const { insertPlanDeviation } = await import('../repositories/plan-deviations.repository');
    const row = await insertPlanDeviation(sql as never, input.orgId, {
      orgId: input.orgId,
      agentId: input.context.agent_id || 'unknown',
      sessionId: typeof input.context.session_id === 'string' ? input.context.session_id : null,
      actionId: input.context.action_id ? String(input.context.action_id) : null,
      guardDecisionId: input.decisionId,
      planId: finding.plan_id,
      stepId: finding.step_id,
      kind: finding.kind,
      dimension: finding.dimension,
      severity: finding.severity,
      declared: finding.declared,
      observed: finding.observed,
      matchConfidence: finding.match_confidence,
      policyOutcome: finding.policy_outcome,
    });
    if (row) {
      void publishOrgEvent(EVENTS.PLAN_DEVIATION_DETECTED, {
        orgId: input.orgId,
        deviation: row,
      });
    }
  } catch (err) {
    console.warn('[Guard] plan-deviation persist failed (fail-soft):', (err as Error).message);
  }
}
