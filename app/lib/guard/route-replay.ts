import { NextResponse } from 'next/server';
import { getOrgHaltState } from '../guard';
import { redactAny } from '../security';
import { getGuardDecisionByIdempotencyKey } from '../repositories/guard.repository';
import { digestJson } from '../integrity/canonicalize';
import { computeReplayBlockReason, computeActBindingBlockReason } from './evaluate.accumulator';
import { recordRunningAction, attachAssumptionAlerts } from './route-record';
import type { GuardSql, GuardData, PreparedRecordReads } from './route-record';

/**
 * The decision-relevant surface of a guard request — everything a policy, a
 * rail or the evidence classifier can read. An idempotency replay is bound to
 * a digest of this, on both sides: the live request, and the `context` JSON of
 * the decision the key found.
 *
 * Why: `idempotency_key` is ordinary client input (validate.js — any string
 * ≤ 256 chars), so a replay keyed on it ALONE served a prior verdict for a
 * different act. `{act:{kind:'shell',command:'ls'}}` earned an allow, then the
 * same key with `rm -rf /` was answered from cache — evaluateGuard, the
 * evidence classifier and every org policy skipped, and no decision row
 * written for the second act (2026-08-11 adversarial review).
 *
 * Attribution-only fields (harness/subagent/session ids, trigger, swarm,
 * enforcement_mode, the key itself) and per-token values (jti, act_hash) stay
 * OUT of the digest so a fresh valid token can retry the same act. Identity
 * statuses are IN: a fresh token must not inherit a prior replay rejection,
 * and a retry that drops its JWT must not inherit a verified agent's allow.
 * Current replay/action-binding blocks are also enforced BEFORE cache lookup:
 * tightening a mode can make an unchanged status require a block.
 */
function buildReplayBinding(source: Record<string, unknown>): Record<string, unknown> {
  const act = source.act as { kind?: string; request?: { url?: unknown }; file?: { path?: unknown } } | undefined;

  // Mirror of foldEvidenceIntoContext (app/lib/guard/evaluate.ts): it enriches
  // target/write_paths FROM the act before the context is persisted, so the
  // live request has to be enriched the same way or an honest http/file retry
  // would never match. Drift here costs a re-evaluation, never a bad replay.
  let target = source.target;
  if (act && act.kind === 'http' && !target && typeof act.request?.url === 'string') {
    target = act.request.url;
  }
  let writePaths = source.write_paths;
  if (act && act.kind === 'file' && typeof act.file?.path === 'string') {
    const paths = Array.isArray(writePaths) ? [...writePaths] : [];
    if (!paths.includes(act.file.path)) paths.push(act.file.path);
    writePaths = paths;
  }

  return {
    act: source.act,
    act_status: source.act_status,
    // The DECLARED type: on a declared/derived mismatch evaluate swaps
    // action_type for the evidence-derived one and parks the declared value
    // in declared_action_type, so the stored row needs unwinding.
    action_type: source.declared_action_type ?? source.action_type,
    agent_id: source.agent_id,
    client_capabilities: source.client_capabilities,
    content: source.content,
    declared_goal: source.declared_goal,
    intel: source.intel,
    reversible: source.reversible,
    // Match resolveAuditStatuses' default for legacy contexts without a status.
    replay_status: source.replay_status || 'not_applicable',
    risk_score: source.risk_score,
    source_of_truth: source.source_of_truth,
    systems_touched: source.systems_touched,
    target,
    tool: source.tool,
    verification_status: source.verification_status,
    write_paths: writePaths,
  };
}

function requestBindingDigest(data: GuardData): string {
  // The stored context was redacted (redactAny) before it was persisted, so
  // the live request is redacted the same way before digesting — otherwise a
  // payload carrying a secret pattern could never replay. A non_fabrication
  // policy's extra strip paths are deliberately not mirrored: an unmatched
  // digest only re-evaluates, which is the safe direction.
  return digestJson(redactAny(buildReplayBinding(data as Record<string, unknown>), []));
}

/**
 * Digest of the act the prior decision was made about. null when the row
 * carries no readable context — nothing to bind against, so no replay.
 */
function priorBindingDigest(prior: Record<string, unknown>): string | null {
  const raw = prior.context;
  let context: unknown = raw;
  if (typeof raw === 'string') {
    try { context = JSON.parse(raw); } catch { return null; }
  }
  if (!context || typeof context !== 'object' || Array.isArray(context)) return null;
  return digestJson(buildReplayBinding(context as Record<string, unknown>));
}

/**
 * End-to-end idempotency (Organ 3 Phase 3): a duplicate-key call inside the
 * replay window returns the PRIOR decision instead of re-evaluating. No new
 * guard_decisions row is written for a replay, so blind client retries cannot
 * double-count in approval-flood / signal / digest windows — and the original
 * audit row stays untouched. The lookup window is short (10 min, see
 * repository): dedupe absorbs retries, not policy changes. Returns the replay
 * response, or null to fall through to a normal evaluation (including on
 * lookup failure).
 */
export async function tryIdempotentReplay(
  sql: GuardSql,
  orgId: string,
  data: GuardData,
  opts: { secretScan: Record<string, unknown> | null; recordParam: boolean; createdBy: string | null; prepared?: Promise<PreparedRecordReads | null> | null },
): Promise<NextResponse | null> {
  if (typeof data.idempotency_key !== 'string' || !data.idempotency_key) return null;

  // Identity resolution already checked this request's token. A cached allow
  // cannot override a reused/missing jti, an unavailable required replay store,
  // or a currently enforced action-binding failure. Use the evaluator's exact
  // checks rather than just adding statuses to the digest: tightening a mode
  // can turn an UNCHANGED status into a block. Fall through to evaluateGuard
  // so the rejection gets its own mandatory audit row (and fails closed if
  // that row cannot be written), rather than returning an unaudited block here.
  if (computeReplayBlockReason(data, orgId) || computeActBindingBlockReason(data, orgId)) return null;

  // Org halt is an emergency override with an immediate-block guarantee, NOT
  // an ordinary policy change the dedupe window may absorb. A halted org
  // must skip the replay short-circuit so the request flows into
  // evaluateGuard (which returns the halt block) — otherwise a retried
  // action carrying a matching idempotency_key would be served its cached
  // pre-halt decision for up to the replay window. (Same cached settings
  // read evaluateGuard uses, so /api/halt's eager invalidation still wins.)
  // The two lookups are independent reads; the halt verdict is applied to the
  // lookup result exactly as before, so a halted org still never replays.
  const [haltState, priorRow] = await Promise.all([
    getOrgHaltState(sql, orgId),
    getGuardDecisionByIdempotencyKey(sql, orgId, data.idempotency_key),
  ]);
  const prior = haltState?.halted ? null : priorRow;
  if (!prior) return null;

  // The key alone is not enough: the cached verdict may only be served to the
  // same act it was made about (see buildReplayBinding). A mismatch is not an
  // error — fall through and evaluate the act that actually arrived.
  if (priorBindingDigest(prior) !== requestBindingDigest(data)) return null;

  let priorPolicies: unknown[] = [];
  try { priorPolicies = JSON.parse(String(prior.matched_policies ?? '[]')); } catch { priorPolicies = []; }
  const replay: Record<string, unknown> = {
    decision: prior.decision,
    decision_id: prior.id,
    action_id: prior.id, // deprecated alias of decision_id (overwritten by the record id below)
    reason: prior.reason,
    risk_score: prior.risk_score != null ? Number(prior.risk_score) : null,
    matched_policies: priorPolicies,
    verification_status: prior.verification_status,
    agent_id: prior.agent_id,
    agent_name: prior.agent_name,
    evaluated_at: prior.created_at,
    idempotent_replay: true,
  };
  if (opts.secretScan) replay.secret_scan = opts.secretScan;
  await attachAssumptionAlerts(sql, orgId, data, replay);
  if (opts.recordParam) {
    try {
      // recordRunningAction short-circuits on the existing action row;
      // when the prior record attempt failed it heals by creating one.
      const rec = await recordRunningAction(sql, orgId, data, { decision: String(prior.decision), risk_score: prior.risk_score != null ? Number(prior.risk_score) : undefined, decision_id: String(prior.id), reason: prior.reason != null ? String(prior.reason) : null, matched_policies: priorPolicies as string[] }, opts.createdBy, opts.prepared);
      replay.recorded = rec.recorded;
      if (rec.recorded && rec.action_id) replay.action_id = rec.action_id;
      else if (rec.reason) replay.recorded_error = rec.reason;
      if (rec.security) replay.security = rec.security;
    } catch (err) {
      console.error('[Guard] record=true replay record failed:', (err as Error).message);
      replay.recorded = false;
      replay.recorded_error = 'Failed to create action record';
    }
  }
  return NextResponse.json(replay, { status: 200 });
}
