/**
 * Guard evaluation engine — local policy evaluation and every grant / relief
 * post-pass. Extracted verbatim from evaluate.ts; behavior unchanged.
 */

import { computeActContentHash } from '../act-content-hash';
import { grantMatches, grantIsExpired, grantCoversRisk, grantMaxRisk, commandShapeKey } from '../policy-shapes';
import { INTERRUPTION_BUDGET_DEFAULTS } from '../posture/loosening';
import type { GuardEvalContext, PolicyRow, PolicyRules } from './types';
import { evaluatePolicy, isKnownPolicyType } from './policy';
import { getActiveApprovalPause, getOverBudgetPolicyIds, getOverBudgetShapeKeys } from './caches';
import { raiseDecision, applyResult, applyBlockOverride } from './evaluate.accumulator';
import type { GuardAccumulator } from './evaluate.accumulator';
import type { GuardPhaseDeps } from './evaluate.types';

// A policy that is ACTIVE but cannot run is a silent-enforcement gap: the
// operator sees it listed as on while it governs nothing. Surface it on every
// decision (warnings ride the response + signals) and log once per policy per
// instance so the hot path doesn't spam. The doctor's policy-integrity check
// covers the same conditions statically.
const unenforceableWarned = new Set<string>();

export function notePolicyUnenforceable(acc: GuardAccumulator, policy: PolicyRow, why: string): void {
  acc.warnings.push(`Policy "${policy.name}" (${policy.id}) is ACTIVE but cannot enforce: ${why}`);
  const key = `${policy.id}:${why}`;
  if (!unenforceableWarned.has(key)) {
    unenforceableWarned.add(key);
    console.warn('[Guard] active policy cannot enforce:', { policy_id: policy.id, name: policy.name, why });
  }
}

export async function runLocalPolicies(
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
export function applyAllowGrants(
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
 * the posture the real call would meet. It runs before authority selection;
 * the later execution claim is the only operation that consumes approval.
 */
export async function applyApprovalPause(deps: GuardPhaseDeps, acc: GuardAccumulator): Promise<void> {
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
 * pause — before authority selection. The later execution claim is the only
 * operation that consumes an operator's single-use approval.
 */
/**
 * The one way an automated pass is allowed to remove an interruption:
 * require_approval → `warn`, never to `allow`. Shared by the interruption
 * budget and the calibration controller's demote arm so the two relief paths
 * cannot drift into writing different forensic shapes for the same event.
 *
 * The gating reasons stop deciding but stay visible under `pastPrefix` — the
 * same forensic move the pause and grant passes make — so the persisted row
 * still says exactly WHY it would have asked and what overrode that.
 */
export function demoteToWarn(
  acc: GuardAccumulator,
  opts: { marker: string; why: string; surface: string; pastPrefix: string },
): void {
  acc.warnings.push(
    `${opts.why} — downgraded to a warning WITHOUT human review. No human approved this action. ` +
    `Review it on ${opts.surface}.`
  );
  acc.matchedPolicies.push(opts.marker);
  acc.highestDecision = 'warn';
  acc.warnings.push(...acc.reasons.map((r) => `${opts.pastPrefix}: ${r}`));
  acc.reasons.length = 0;
}

export async function applyInterruptionBudget(deps: GuardPhaseDeps, acc: GuardAccumulator): Promise<void> {
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
  const demote = (marker: string, why: string): void =>
    demoteToWarn(acc, { marker, why, surface: '/policies', pastPrefix: 'over-budget past' });

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
 * Evaluation only selects candidate authority. The execution claim consumes
 * it atomically with the target attempt, so a block, abandoned evaluation,
 * or failed action insert cannot burn the operator's approval.
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
export async function applyOperatorApprovalGrant(deps: GuardPhaseDeps, acc: GuardAccumulator): Promise<void> {
  if (acc.highestDecision !== 'require_approval') return;
  const { context, sql, orgId } = deps;
  if (!Array.isArray(context.client_capabilities) || !context.client_capabilities.includes('execution_claims')) return;
  if (!context.agent_id || !context.declared_goal) return;
  try {
    const actionType = context.action_type ?? null;
    // Recomputed server-side from the retry's act — a NULL here (no act on
    // the retry) can only match rows that were never act-stamped.
    const retryActHash = computeActContentHash(context.act);
    const rows = await sql`
        SELECT action_id, approved_by, act_content_hash
        FROM action_records AS approval
        WHERE org_id = ${orgId}
          AND agent_id = ${context.agent_id}
          AND declared_goal = ${context.declared_goal}
          AND (${actionType}::text IS NULL OR action_type = ${actionType})
          AND act_content_hash IS NOT DISTINCT FROM ${retryActHash}::text
          AND execution_protocol = 1
          AND (${context._execution_principal_id ?? null}::text IS NULL
            OR created_by = ${context._execution_principal_id ?? null}
            OR (action_type = 'containment_promote' AND EXISTS (
              SELECT 1 FROM action_records origin WHERE origin.action_id = approval.parent_action_id
                AND origin.org_id = approval.org_id AND origin.agent_id = approval.agent_id
                AND origin.created_by = ${context._execution_principal_id ?? null}
            )))
          AND approved_by IS NOT NULL
          AND approved_by <> ''
          AND approved_at > NOW() - make_interval(mins => ${OPERATOR_APPROVAL_WINDOW_MINUTES})
          AND approval_grant_used_at IS NULL
          AND execution_claimed_at IS NULL
          AND status = 'running' AND outcome_status = 'pending'
        ORDER BY (action_id = ${context.action_id ?? null}) DESC NULLS LAST, approved_at DESC
        LIMIT 1
    `;
    const grant = rows[0];
    if (!grant) return;
    acc.executionAuthorization = { kind: 'operator', id: String(grant.action_id) };
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
 *  2. Authority selection: when the decision is require_approval, an approved,
 *     unconsumed, unexpired, act-or-goal-bound step is selected read-only and
 *     the decision downgrades to allow. The later execution claim revalidates
 *     and consumes that step atomically with the action attempt. Operator
 *     grants run FIRST (more specific; they win). Selection requires the full
 *     triple (agent_id, declared_goal, action_type), so a grant is usable only
 *     by the agent and goal it was issued to.
 *
 * Never touches block. Never runs in simulate mode (gated at the call site).
 * Fail-soft/fail-closed split, NOT uniform: the deny lookup fails CLOSED
 * (an unverifiable denial state raises to require_approval — see the catch
 * below) because a grant downgrade built on top of a broken deny check would
 * be unsafe; the authority lookup fails SOFT and leaves require_approval,
 * which is already the safe state.
 */
// U3: the operator's preview verdict (preview_decision, stamped at plan
// submission) vs. what the LIVE evaluation just raised (live_reasons_count)
// is the audit trail for drift inside the grant's TTL window.
export type PlanGrantInfo = { plan_id: string; step_id: string; seq: number; preview_decision: string | null; live_reasons_count: number };

export async function applyPlanStepGrant(deps: GuardPhaseDeps, acc: GuardAccumulator): Promise<PlanGrantInfo | null> {
  const { context, sql, orgId } = deps;
  // Final fix-wave IMPORTANT 2 (2026-07-27) / Locked Decision 5
  // (RFC containment-verdicts): same reasoning as applyAllowGrants above —
  // an operator-approved plan step must never stand in for the promote
  // click's single-use grant. A containment_promote action is never a
  // legitimate plan step in the first place (it's the synthetic merge row
  // minted by the containment route, not something a plan ever proposes),
  // so this excludes it from both the deny-check and authority-selection phases.
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
      // and skip authority selection entirely; unlike the fail-soft authority
      // catch below, a require_approval left in place here could otherwise
      // still be downgraded by a grant this same call never got to check.
      console.warn('[Guard] plan-deny lookup failed — failing closed:', (err as Error).message);
      acc.reasons.push('Plan-denial lookup unavailable — failing closed to human review');
      acc.matchedPolicies.push('builtin:plan_deny_failsafe');
      raiseDecision(acc, 'require_approval');
      return null;
    }
  }

  // Authority selection keeps the strict full-triple requirement — action_type is
  // no longer guaranteed by the entry guard above (V2 relaxed it to allow a
  // hash-only deny check), so it must be re-asserted here explicitly.
  if (!context.agent_id || !context.action_type || !declaredGoal) return null;
  if (acc.highestDecision !== 'require_approval') return null;
  if (!Array.isArray(context.client_capabilities) || !context.client_capabilities.includes('execution_claims')) return null;

  try {
    const { findPlanExecutionAuthority } = await import('../repositories/actions.repository.execution');
    const grant = await findPlanExecutionAuthority(sql as never, orgId, {
      agentId: context.agent_id,
      actionType: context.action_type,
      declaredGoal,
      actHash,
    });
    if (!grant) return null;
    acc.executionAuthorization = { kind: 'plan', id: String(grant.step_id) };
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
    // Fail-soft: failed authority selection leaves require_approval intact,
    // already the safe state unlike the deny lookup above.
    console.warn('[Guard] plan-grant authority lookup failed:', (err as Error).message);
    return null;
  }
}
