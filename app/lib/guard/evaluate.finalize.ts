/**
 * Guard evaluation engine — evidence folding, audit statuses, and the
 * persist / event / result builders. Extracted verbatim from evaluate.ts;
 * behavior unchanged.
 */

import { EVENTS, publishOrgEvent } from '../events';
import { computeActContentHash } from '../act-content-hash';
import type { GuardEvalContext, GuardDecisionInsert } from './types';
import type { ExternalVerdictEvidence } from './external-verdict';
import type { CalibrationAssessment } from './calibration';
import { serverRiskTerms } from './risk';
import type { RiskBreakdown, EvidenceDerivedBreakdown } from './risk';
import { classifyAct } from './evidence';
import type { ActInput } from './evidence';
import type { GuardAccumulator } from './evaluate.accumulator';
import type { PlanGrantInfo } from './evaluate.grants';
import type { PlanDeviationOutcome } from './evaluate.checks';

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

export function resolveAuditStatuses(context: GuardEvalContext): AuditStatuses {
  return {
    verificationStatus: context.verification_status || 'unverified',
    replayStatus: context.replay_status || 'not_applicable',
    jti: context.jti || null,
    actStatus: context.act_status || 'not_applicable',
    actHash: context.act_hash || null,
  };
}

// Everything the persist / event / result builders need, computed once.
export interface GuardFinalizeInput {
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

export function buildGuardDecisionRow(input: GuardFinalizeInput): GuardDecisionInsert {
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
      // Always overwrite caller-supplied metadata. This is server-selected
      // candidate authority, never permission to execute without a claim.
      _execution_authorization: ['allow', 'warn'].includes(acc.highestDecision)
        ? acc.executionAuthorization ?? null : null,
      _execution_act_content_hash: computeActContentHash(context.act),
      _execution_containment: input.containment,
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

export function publishGuardDecisionEvent(input: GuardFinalizeInput): void {
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

export function buildGuardResult(input: GuardFinalizeInput) {
  const { context, acc, statuses } = input;
  return {
    decision: acc.highestDecision,
    decision_id: input.decisionId, // Canonical: the guard-evaluation id (act_gd_*).
    execution_claim_required: true,
    claim_protocol: 1,
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
export function foldEvidenceIntoContext(context: GuardEvalContext): EvidenceDerivedBreakdown | null {
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
