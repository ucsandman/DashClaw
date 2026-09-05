/**
 * Guard evaluation engine — the structural shields, webhook policies, the
 * calibration controller, signals, and plan-deviation detection/recording.
 * Extracted verbatim from evaluate.ts; behavior unchanged.
 */

import { scanForPromptInjection } from '../promptInjection';
import { EVENTS, publishOrgEvent } from '../events';
import { computeActContentHash } from '../act-content-hash';
import { commandShapeKey } from '../policy-shapes';
import { DECISION_SEVERITY, sevOf } from './internal';
import type { GuardSql, GuardEvalContext, PolicyRow, PolicyRules, PolicyResult, Preliminary } from './types';
import { evaluatePolicy, evaluateWebhookPolicy } from './policy';
import { getCalibrationRuntime, getHasLivePlan } from './caches';
import { classifyDeviation, summarizeAct } from './deviation';
import type { DeviationFinding, LivePlanStep } from './deviation';
import { assessCalibration, CALIBRATION_POLICY_ID, CALIBRATION_RELIEF_POLICY_ID } from './calibration';
import type { CalibrationAssessment } from './calibration';
import { raiseDecision, applyResult } from './evaluate.accumulator';
import type { GuardAccumulator } from './evaluate.accumulator';
import type { GuardOptions, GuardPhaseDeps } from './evaluate.types';
import { notePolicyUnenforceable, demoteToWarn } from './evaluate.grants';
import type { PlanGrantInfo } from './evaluate.grants';
import type { GuardFinalizeInput } from './evaluate.finalize';

// Default-on prompt injection scanning (opt-out via DISABLE_PROMPT_INJECTION_SCAN=true).
export function scanPromptInjection(context: GuardEvalContext, acc: GuardAccumulator): void {
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
export async function runWebhookPolicies(
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
 * calibrated threshold would do. `active` raises allow/warn to
 * require_approval above θ AND demotes a policy's require_approval to `warn`
 * below it; `relief` runs the demote arm only, for an operator who wants the
 * controller to remove interruptions without adding any. Neither arm ever
 * reaches `allow` or touches `block`. Best-effort: a failure here must never
 * block guard.
 */
export async function runCalibrationController(
  deps: GuardPhaseDeps,
  adjustedRiskScore: number,
  acc: GuardAccumulator,
): Promise<CalibrationAssessment | null> {
  const { context, sql, orgId } = deps;
  try {
    const runtime = await getCalibrationRuntime(sql, orgId);
    if (!runtime) return null;
    const assessment = assessCalibration(runtime.state, runtime.settings, adjustedRiskScore, context.agent_id || null);
    const mode = runtime.settings.mode;
    let applied = false;
    if (
      mode === 'active' &&
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

    // Demote arm. Only ever touches an interruption an org POLICY raised —
    // an external provider's escalate and the later block-only phases are
    // out of its reach, same boundary the interruption budget draws. `applied`
    // can never be true here (the two arms are disjoint on score vs θ), but
    // the guard is cheap and makes that impossible rather than merely untrue.
    let relieved = false;
    if (
      !applied &&
      (mode === 'active' || mode === 'relief') &&
      assessment.would_relieve &&
      acc.highestDecision === 'require_approval' &&
      acc.gatingPolicies.length > 0
    ) {
      const ungrantable = acc.gatingPolicies.find((g) => g.ungrantable);
      if (ungrantable) {
        // Same F1 carve-out as the budget: a rule an attacker could disarm BY
        // FIRING IT is not a rule. The warning keeps the condition on the row.
        acc.warnings.push(
          `${ungrantable.name}: marked ungrantable — the calibration controller cannot downgrade this verdict`
        );
      } else {
        relieved = true;
        demoteToWarn(acc, {
          marker: CALIBRATION_RELIEF_POLICY_ID,
          why:
            `Calibration controller: risk ${adjustedRiskScore} is below the calibrated threshold ` +
            `${Math.round(assessment.theta * 10) / 10} and at or under the riskiest action you have ` +
            `approved (${assessment.relief_ceiling}), so this interruption is not earned`,
          surface: '/calibration',
          pastPrefix: 'uncalibrated past',
        });
      }
    }
    return { ...assessment, applied, relieved };
  } catch (err) {
    console.warn('[Guard] calibration controller failed (continuing without):', (err as Error).message);
    return null;
  }
}

export async function runSignalChecks(
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
export async function runDeviationCheck(
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
          if (Array.isArray(rules.shape_exceptions) && rules.shape_exceptions.length > 0) {
            const shape = commandShapeKey(context.declared_goal);
            if (shape && rules.shape_exceptions.includes(shape)) {
              acc.warnings.push(`Policy "${policy.name}" skipped: shape "${shape}" is an exception you added`);
              continue;
            }
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

// D1: recording is unconditional — every decision with a finding writes the
// plan_deviations row, whatever the policy outcome, for all four decisions
// (only simulate skips, upstream). Runs AFTER persistGuardDecision so
// guard_decision_id is real. Fail-soft (D3): a failed insert costs the
// durable row — the _plan_deviation echo in guard_decisions.context survives
// — never the guard call.
export async function persistPlanDeviationRow(sql: GuardSql, input: GuardFinalizeInput): Promise<void> {
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
