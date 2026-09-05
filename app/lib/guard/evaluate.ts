/**
 * Guard evaluation engine.
 * Evaluates agent context against org policies and returns allow/warn/block/require_approval.
 */

import { randomUUID } from 'node:crypto';
import type { GuardSql, GuardEvalContext } from './types';
import { resolveDegradedAction } from './policy';
import { getOrgHaltState, loadApplicablePolicies } from './caches';
import type { ExternalVerdictEvidence } from './external-verdict';
import type { CalibrationAssessment } from './calibration';
import { serverRiskTerms, computeEffectiveRisk, computeRiskAssessment } from './risk';
import type { RiskBreakdown } from './risk';
import { persistGuardDecision } from './persistence';
import { finalizeContainment } from './containment';
import {
  guardDeadlineMs,
  newAccumulator,
  raiseDecision,
  applyBlockOverride,
  computeReplayBlockReason,
  computeActBindingBlockReason,
  redactContextForLog,
} from './evaluate.accumulator';
import type { GuardAccumulator } from './evaluate.accumulator';
import { computePredictiveRisk, runExternalVerdict } from './evaluate.external';
import type { GuardOptions, GuardPhaseDeps } from './evaluate.types';
import {
  runLocalPolicies,
  applyAllowGrants,
  applyApprovalPause,
  applyInterruptionBudget,
  applyOperatorApprovalGrant,
  applyPlanStepGrant,
} from './evaluate.grants';
import type { PlanGrantInfo } from './evaluate.grants';
import {
  scanPromptInjection,
  runWebhookPolicies,
  runCalibrationController,
  runSignalChecks,
  runDeviationCheck,
  persistPlanDeviationRow,
} from './evaluate.checks';
import type { PlanDeviationOutcome } from './evaluate.checks';
import {
  foldEvidenceIntoContext,
  resolveAuditStatuses,
  buildGuardDecisionRow,
  publishGuardDecisionEvent,
  buildGuardResult,
} from './evaluate.finalize';
import type { GuardFinalizeInput } from './evaluate.finalize';

// Public surface of this module, unchanged by the split above: every name
// evaluate.ts exported before is re-exported from the sibling that now owns it.
export type { PromptInjectionShieldStatus, GuardAccumulator } from './evaluate.accumulator';
export type { PlanGrantInfo } from './evaluate.grants';
export type { PlanDeviationOutcome } from './evaluate.checks';

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
      // Both grant passes select candidate authority only. Consumption is
      // deferred to the atomic execution claim after every blocking check
      // and durable action creation succeeds.
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
