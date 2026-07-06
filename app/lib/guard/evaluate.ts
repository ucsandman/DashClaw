/**
 * Guard evaluation engine.
 * Evaluates agent context against org policies and returns allow/warn/block/require_approval.
 */

import { randomUUID } from 'node:crypto';
import { baseAgentId } from '../agent-identity-resolve';
import { scanSensitiveData } from '../security';
import { scanForPromptInjection } from '../promptInjection';
import { EVENTS, publishOrgEvent } from '../events';
import { getActBindingMode } from '../act-binding';
import { computeActContentHash } from '../act-content-hash';
import { getJtiReplayMode } from '../replay-protection';
import { grantMatches } from '../policy-shapes';
import { DECISION_SEVERITY, sevOf } from './internal';
import type { GuardSql, GuardEvalContext, PolicyRow, PolicyRules, PolicyResult, Preliminary, GuardDecisionInsert } from './types';
import { resolveDegradedAction, evaluatePolicy, evaluateWebhookPolicy, x402BudgetWindow, isKnownPolicyType } from './policy';
import { getOrgHaltState, loadApplicablePolicies, getPredictiveSettings, getCalibrationRuntime } from './caches';
import { assessCalibration, CALIBRATION_POLICY_ID } from './calibration';
import type { CalibrationAssessment } from './calibration';
import { serverRiskTerms, computeEffectiveRisk, computeRiskAssessment } from './risk';
import type { RiskBreakdown, EvidenceDerivedBreakdown } from './risk';
import { classifyAct } from './evidence';
import type { ActInput } from './evidence';
import { persistGuardDecision } from './persistence';

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
interface GuardAccumulator {
  reasons: string[];
  warnings: string[];
  matchedPolicies: string[];
  nonFabEvidence: unknown[];
  nonFabStripPaths: Set<string>;
  highestDecision: string;
  shields: GuardShields;
}

function newAccumulator(): GuardAccumulator {
  return { reasons: [], warnings: [], matchedPolicies: [], nonFabEvidence: [], nonFabStripPaths: new Set(), highestDecision: 'allow', shields: { prompt_injection: null } };
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

interface GuardOptions {
  includeSignals?: boolean;
  computeSignals?: (orgId: string, agentId: string | null, sql: GuardSql) => Promise<Array<{ type: string; label: string }>>;
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
    raiseDecision(acc, result.action);
  }
}

/**
 * allow_grant post-pass: a matching grant downgrades warn / require_approval
 * to allow. It can NEVER override block — blocks are absolute.
 */
function applyAllowGrants(policies: PolicyRow[], context: GuardEvalContext, acc: GuardAccumulator): void {
  if (acc.highestDecision !== 'warn' && acc.highestDecision !== 'require_approval') return;
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
    if (grantMatches(rules as { action_type?: unknown; target_prefix?: unknown }, context)) {
      acc.warnings.push(`${policy.name}: grant downgraded ${acc.highestDecision} to allow`);
      acc.matchedPolicies.push(policy.id);
      acc.highestDecision = 'allow';
      acc.reasons.length = 0; // gating reasons no longer apply
      return;
    }
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
    acc.reasons.length = 0; // gating reasons no longer apply
  } catch (err) {
    console.warn('[Guard] operator-approval lookup failed:', (err as Error).message);
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
  for (const policy of webhookPolicies) {
    let rules: PolicyRules;
    try { rules = JSON.parse(policy.rules); } catch {
      notePolicyUnenforceable(acc, policy, 'rules is not valid JSON');
      continue;
    }

    const webhookResult = await evaluateWebhookPolicy(policy, rules, context, orgId, sql, preliminary);
    if (!webhookResult) continue;
    applyResult(webhookResult, policy, acc);
    raiseDecision(acc, webhookResult.action);
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
  timings: Record<string, number> | null;
  degraded: { kind: string; deadline_ms: number; action: string; phase_in_flight: string | null } | null;
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
    context.action_type = evidence.derived_action_type;
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

  return { derived_action_type: evidence.derived_action_type, base_risk: evidence.base_risk, modifiers, total, mismatch };
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
  const runEvaluation = async (): Promise<'completed'> => {
    // Independent lookups (both served from the 30s caches when warm; on a
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
    await timed('webhooks', () => runWebhookPolicies(policies, deps, liveAcc));
    // Calibrated interruption controller — after every phase that can raise
    // via policies, before grants (so grants can still cover its raise).
    calibration = await timed('calibration', () => runCalibrationController(deps, adjustedRiskScore, liveAcc));
    // Grants run after the LAST phase where org policies can raise warn /
    // require_approval (webhook_check, above). The later phases can only append
    // warnings (runSignalChecks) or raise to block (replay/act overrides), which
    // grants never touch — so a downgrade decided here is final. The operator-
    // approval pass runs after policy grants: it only fires when the decision
    // is still require_approval.
    applyAllowGrants(policies, context, liveAcc);
    await timed('grants', () => applyOperatorApprovalGrant(deps, liveAcc));
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

  const input: GuardFinalizeInput = {
    decisionId, orgId, context, acc, safeContextForLog, evidenceJson, statuses,
    adjustedRiskScore, agentRiskScore, evaluatedAt, predictiveRisk,
    riskBreakdown, intentSource, evidenceDerived, calibration, timings, degraded: degradedDetail,
  };

  // The audit persist is the mandatory blocking gate: a failure throws
  // GUARD_AUDIT_PERSIST_FAILED and no decision is ever returned.
  await persistGuardDecision(sql, buildGuardDecisionRow(input));
  publishGuardDecisionEvent(input);
  return buildGuardResult(input);
}

/**
 * Post-insert budget re-verification (TOCTOU close-out; security review
 * 2026-07-02, MEDIUM). The pre-insert budget check reads the window sum
 * before the purchase row exists, so N concurrent purchases can each pass
 * against the same pre-insert sum. The x402 purchases route calls this AFTER
 * the row commits: the sum now includes the caller's own row and any
 * concurrent winners, so a breached hard budget (budget_usd) surfaces while
 * the response — and the agent's payment execution — can still be stopped.
 * Only the block tier is re-verified: the approval tier already produced its
 * interruption and pending rows count toward future sums. Best-effort by
 * design: a failure here returns null (the pre-insert gate already ran
 * fail-closed); failing every allowed purchase on a transient re-check error
 * would be a new outage mode.
 */
export async function verifyX402BudgetAfterInsert(orgId: string, context: GuardEvalContext, sql: GuardSql): Promise<{ policyId: string; reason: string } | null> {
  try {
    const agentId = typeof context.agent_id === 'string' && context.agent_id ? context.agent_id : null;
    const policies = await loadApplicablePolicies(sql, orgId, agentId);
    for (const policy of policies) {
      if (policy.policy_type !== 'x402_spend_limit') continue;
      let rules: PolicyRules;
      try { rules = JSON.parse(policy.rules); } catch { continue; }
      const budgetMax = rules.budget_usd ?? Infinity;
      if (budgetMax === Infinity) continue;
      const { windowDays, scope } = x402BudgetWindow(rules);
      if (scope === 'agent' && !agentId) continue; // the pre-insert gate already interrupted this shape
      // Same identity-family normalization as the pre-insert gate.
      const budgetAgentId = agentId ? (baseAgentId(agentId) ?? agentId) : null;
      const { sumWindowSpend } = await import('../repositories/x402.repository');
      const sinceIso = new Date(Date.now() - windowDays * 86400000).toISOString();
      const committed = await sumWindowSpend(sql, orgId, { sinceIso, agentId: scope === 'agent' ? budgetAgentId : null });
      if (committed > budgetMax) {
        const scopeLabel = scope === 'agent' ? `agent ${budgetAgentId}` : 'org';
        return {
          policyId: policy.id,
          reason: `Cumulative x402 spend $${committed.toFixed(2)} over ${windowDays}d (${scopeLabel}) exceeds budget $${budgetMax} — post-insert re-verification`,
        };
      }
    }
    return null;
  } catch (err) {
    console.warn('[Guard] x402 post-insert budget re-verification failed:', { org_id: orgId, error: (err as Error)?.message || err });
    return null;
  }
}
