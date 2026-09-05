/**
 * Guard evaluation engine — accumulator, redaction helpers, and the
 * audit-boundary block-reason computations. Extracted verbatim from
 * evaluate.ts; behavior unchanged.
 */

import { scanSensitiveData } from '../security';
import { getActBindingMode } from '../act-binding';
import { getJtiReplayMode } from '../replay-protection';
import { DECISION_SEVERITY, sevOf } from './internal';
import type { GuardEvalContext, PolicyRow, PolicyResult } from './types';

// Evaluation deadline: the hook gives the whole guard call one attempt with a
// 5s read timeout (GUARD_TIMEOUT, GUARD_RETRIES=0) — the server must answer
// safely inside that window, so the policy-evaluation phases are bounded and a
// degraded decision is returned (and still persisted) when they overrun.
const DEFAULT_GUARD_DEADLINE_MS = 3500;

export function guardDeadlineMs(): number {
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
  /** Candidate authority; consumed only with an atomic execution claim. */
  executionAuthorization?: { kind: 'operator' | 'plan'; id: string };
}

export function newAccumulator(): GuardAccumulator {
  return { reasons: [], warnings: [], matchedPolicies: [], nonFabEvidence: [], nonFabStripPaths: new Set(), highestDecision: 'allow', shields: { prompt_injection: null }, gatingPolicies: [] };
}

export function raiseDecision(acc: GuardAccumulator, action: string): void {
  if (sevOf(action) > sevOf(acc.highestDecision)) acc.highestDecision = action;
}

export function applyResult(result: PolicyResult, policy: PolicyRow, acc: GuardAccumulator): void {
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
export function applyBlockOverride(acc: GuardAccumulator, reason: string | null): void {
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
export function computeReplayBlockReason(context: GuardEvalContext, orgId: string): string | null {
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
export function computeActBindingBlockReason(context: GuardEvalContext, orgId: string): string | null {
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

// SECURITY: do not store raw secrets in guard decision context.
export function redactContextForLog(context: GuardEvalContext, nonFabStripPaths: Set<string>): unknown {
  const dlpFindings: unknown[] = [];
  const safeContextForLog = redactAny(context, dlpFindings);
  if (dlpFindings.length > 0) {
    console.warn(`[Guard] Redacted ${dlpFindings.length} sensitive pattern(s) from guard_decisions.context before storing.`);
  }
  for (const p of nonFabStripPaths) redactByPath(safeContextForLog, p, '[redacted:non_fabrication_input]');
  return safeContextForLog;
}
