// app/lib/repositories/loosening.repository.ts
// Loosening proposals (roadmap v4.5: proposals that relax).
// Spec: docs/superpowers/specs/2026-07-05-loosening-direction.md
//
// Three halves, mirroring tightening.repository.ts:
//  1. The interrupt-outcome evidence loader — require_approval decisions
//     joined to their action_records resolution at (policy, action_type)
//     grain, with the tuning repository's degradation + approval predicates
//     and synthetic traffic excluded in SQL BEFORE aggregation (the v3.1
//     lesson; the toggle exists only for the policy-smoke harness).
//  2. CRUD for loosening_proposal_decisions (drizzle/0051): the human's
//     ratify/dismiss judgment, keyed by the engine's content-stable lp_ id.
//  3. The relaxation write — the ONLY mutation in this family: ratify
//     splices an action type out of a policy's envelope or deactivates it,
//     bumping updated_at (which resets the evidence window — ratify
//     self-suppresses through the policy, not through bookkeeping).

import { invalidateGuardPolicyCache } from '../guard';
import type { SqlTag } from '../types/db';
import {
  NOT_DEGRADED,
  SYNTHETIC_PARAMS,
  syntheticExclusionSql,
} from './policy-tuning.repository';
import type { InterruptOutcomeRow, InterruptVolumeRow, PrecedentOutcomeRow } from '../posture/loosening';

export interface LooseningDecisionRow {
  id: number;
  org_id: string;
  proposal_id: string;
  rule: string;
  decision: 'ratified' | 'dismissed';
  action_type: string | null;
  policy_id: string | null;
  snapshot: Record<string, unknown> | null;
  reason: string | null;
  decided_by: string | null;
  decided_at: string;
}

export interface LooseningDecisionInput {
  proposalId: string;
  rule: string;
  decision: 'ratified' | 'dismissed';
  actionType: string | null;
  policyId: string | null;
  snapshot: Record<string, unknown> | null;
  reason: string | null;
  decidedBy: string | null;
}

/**
 * Approval outcomes of require_approval interruptions at (policy,
 * action_type) grain — the loosening evidence. Outcome predicates mirror
 * getApprovalOutcomesByPolicy (policy-tuning.repository.ts); the LEFT JOIN
 * (vs tuning's INNER) keeps unresolved interrupts in `fired` so volume is
 * truthful — they simply never count as approved or denied. Per-policy
 * windows are clipped at guard_policies.updated_at: a config change (and
 * therefore a ratified relaxation) resets the evidence.
 */
export async function getInterruptOutcomesByPolicyAction(
  sql: SqlTag,
  orgId: string,
  days: number,
  opts: { includeSynthetic?: boolean } = {},
): Promise<InterruptOutcomeRow[]> {
  const rows = await sql.query(
    `SELECT sub.policy_id AS policy_id,
            COALESCE(sub.action_type, '') AS action_type,
            COUNT(*)::int AS fired,
            COUNT(*) FILTER (WHERE ar.approved_by IS NOT NULL)::int AS approved,
            COUNT(*) FILTER (
              WHERE ar.approved_by IS NULL
                AND ar.reasoning LIKE '%[HITL Decision: DENY%'
            )::int AS denied,
            COUNT(*) FILTER (WHERE ar.status = 'pending_approval')::int AS pending,
            (array_agg(sub.decision_id ORDER BY sub.fired_at DESC))[1:5] AS example_decision_ids
     FROM (
       SELECT gd.id AS decision_id,
              jsonb_array_elements_text(gd.matched_policies::jsonb) AS policy_id,
              gd.action_type AS action_type,
              gd.created_at::timestamptz AS fired_at
       FROM guard_decisions gd
       WHERE gd.org_id = $1
         AND gd.decision = 'require_approval'
         -- ::timestamptz matters: created_at is TEXT on fresh drizzle schemas.
         AND gd.created_at::timestamptz > NOW() - make_interval(days => $2::int)
         AND gd.matched_policies IS NOT NULL
         AND gd.matched_policies LIKE '[%'
         AND ${NOT_DEGRADED}
         AND ${syntheticExclusionSql(3, 4, 5)}
     ) sub
     LEFT JOIN action_records ar
       ON ar.guard_decision_id = sub.decision_id AND ar.org_id = $1
     JOIN guard_policies gp ON gp.id = sub.policy_id AND gp.org_id = $1
     WHERE sub.fired_at > GREATEST(
       NOW() - make_interval(days => $2::int),
       COALESCE(gp.updated_at::timestamptz, '-infinity'::timestamptz)
     )
     GROUP BY sub.policy_id, COALESCE(sub.action_type, '')`,
    [orgId, days, opts.includeSynthetic === true, ...SYNTHETIC_PARAMS],
  );
  return rows as unknown as InterruptOutcomeRow[];
}

/**
 * Interruption VOLUME per policy — the interruption-budget evidence.
 *
 * The critical difference from every other loosening query in this file: it
 * does NOT join action_records, because it does not care whether a human ever
 * resolved anything. That join is the defect this query exists to route around.
 *
 * 2026-08-16 incident: the org took 1,759 require_approval decisions in seven
 * days and resolved effectively none of them, because the volume itself is
 * what stops a human working the queue. Every existing rule gates on
 * `resolved >= minResolved` and an override RATE, so the harder the system
 * interrupts, the less evidence it earns to stop — the feedback loop runs
 * backwards. `fired` is observable no matter what the human does, so a rule
 * built on it alone still fires when the operator has given up entirely.
 *
 * Counts a decision when the policy interrupted OR when relief already
 * demoted it (`builtin:interruption_budget`, or `builtin:calibration_relief`
 * from the controller's demote arm, which runs FIRST and short-circuits the
 * budget phase entirely). Without those terms the signal self-erases:
 * demoting drops the require_approval count, which restores the policy, which
 * raises the count — an oscillator. Counting "times this policy WOULD have
 * interrupted" is stable.
 *
 * Window clipped at guard_policies.updated_at like its siblings, so editing a
 * policy (or ratifying relief for it) resets the evidence.
 */
export async function getInterruptVolumeByPolicy(
  sql: SqlTag,
  orgId: string,
  hours: number,
  opts: { includeSynthetic?: boolean } = {},
): Promise<InterruptVolumeRow[]> {
  const rows = await sql.query(
    `SELECT sub.policy_id AS policy_id,
            COUNT(*)::int AS fired,
            MIN(sub.fired_at)::text AS first_fired_at,
            (array_agg(sub.decision_id ORDER BY sub.fired_at DESC))[1:5] AS example_decision_ids
     FROM (
       SELECT gd.id AS decision_id,
              jsonb_array_elements_text(gd.matched_policies::jsonb) AS policy_id,
              gd.created_at::timestamptz AS fired_at
       FROM guard_decisions gd
       WHERE gd.org_id = $1
         AND (
           gd.decision = 'require_approval'
           OR gd.matched_policies LIKE '%builtin:interruption_budget%'
           OR gd.matched_policies LIKE '%builtin:calibration_relief%'
         )
         -- ::timestamptz matters: created_at is TEXT on fresh drizzle schemas.
         AND gd.created_at::timestamptz > NOW() - make_interval(hours => $2::int)
         AND gd.matched_policies IS NOT NULL
         AND gd.matched_policies LIKE '[%'
         AND ${NOT_DEGRADED}
         AND ${syntheticExclusionSql(3, 4, 5)}
     ) sub
     JOIN guard_policies gp ON gp.id = sub.policy_id AND gp.org_id = $1
     WHERE sub.fired_at > GREATEST(
       NOW() - make_interval(hours => $2::int),
       COALESCE(gp.updated_at::timestamptz, '-infinity'::timestamptz)
     )
     GROUP BY sub.policy_id`,
    [orgId, hours, opts.includeSynthetic === true, ...SYNTHETIC_PARAMS],
  );
  return rows as unknown as InterruptVolumeRow[];
}

/**
 * Raw declared_goals of recent interruptions — the SHAPE-budget evidence.
 *
 * Returns rows rather than an aggregate on purpose: the grouping key is
 * commandShapeKey() (policy-shapes.ts), a normalizer that strips wrappers,
 * flags and paths. Reimplementing that in SQL would fork the definition, and
 * the guard side must group EXACTLY the same way or the budget it enforces is
 * not the budget it measured. Volume is small (this is a 24h slice of
 * require_approval only, a few hundred rows at the incident's rate) and the
 * caller caches for 60s, so the JS-side grouping costs nothing that matters.
 *
 * declared_goal lives inside the context JSON — guard_decisions has no such
 * column. The `context LIKE '{%'` guard is load-bearing: ::jsonb throws on a
 * row whose context is non-JSON, which would take out the whole page.
 *
 * Like getInterruptVolumeByPolicy, it counts already-demoted decisions too, so
 * the signal does not erase itself once relief starts.
 */
export async function getRecentInterruptGoals(
  sql: SqlTag,
  orgId: string,
  hours: number,
  opts: { includeSynthetic?: boolean; limit?: number } = {},
): Promise<Array<{ declared_goal: string | null }>> {
  const limit = Math.min(Math.max(opts.limit ?? 5000, 1), 20000);
  const rows = await sql.query(
    `SELECT gd.context::jsonb->>'declared_goal' AS declared_goal
     FROM guard_decisions gd
     WHERE gd.org_id = $1
       AND (
         gd.decision = 'require_approval'
         OR gd.matched_policies LIKE '%builtin:shape_budget%'
         OR gd.matched_policies LIKE '%builtin:calibration_relief%'
       )
       AND gd.created_at::timestamptz > NOW() - make_interval(hours => $2::int)
       AND gd.context IS NOT NULL
       AND gd.context LIKE '{%'
       AND ${NOT_DEGRADED}
       AND ${syntheticExclusionSql(3, 4, 5)}
     ORDER BY gd.created_at DESC
     LIMIT ${limit}`,
    [orgId, hours, opts.includeSynthetic === true, ...SYNTHETIC_PARAMS],
  );
  return rows as unknown as Array<{ declared_goal: string | null }>;
}

/**
 * Adjudicated-approval evidence at (action_type, evidence flag set) grain —
 * the precedent evidence. Sibling of getInterruptOutcomesByPolicyAction above
 * and shares its predicates (NOT_DEGRADED, synthetic exclusion in SQL before
 * aggregation, ::timestamptz because created_at is TEXT on fresh schemas).
 *
 * Two differences that matter:
 *  - Grouped by the SERVER-computed evidence flags, not by policy. A precedent
 *    is about a KIND of act, so it must survive the operator editing, renaming
 *    or replacing whichever policy happened to interrupt it.
 *  - Counts DISTINCT APPROVAL DAYS, because five approvals inside one frantic
 *    hour is one decision repeated, not five independent judgments.
 *
 * The `context LIKE '{%'` guard is load-bearing: ::jsonb throws on a row whose
 * context is null or non-JSON, which would take out the whole /policies page.
 */
export async function getPrecedentOutcomes(
  sql: SqlTag,
  orgId: string,
  days: number,
  opts: { includeSynthetic?: boolean } = {},
): Promise<PrecedentOutcomeRow[]> {
  const rows = await sql.query(
    `SELECT gd.action_type AS action_type,
            gd.context::jsonb->'evidence_flags' AS flags,
            COUNT(*) FILTER (WHERE ar.approved_by IS NOT NULL)::int AS approved,
            COUNT(*) FILTER (
              WHERE ar.approved_by IS NULL
                AND ar.reasoning LIKE '%[HITL Decision: DENY%'
            )::int AS denied,
            COUNT(DISTINCT (ar.approved_at::timestamptz)::date)
              FILTER (WHERE ar.approved_by IS NOT NULL)::int AS distinct_days,
            (array_agg(gd.id ORDER BY gd.created_at DESC))[1:5] AS example_decision_ids
     FROM guard_decisions gd
     LEFT JOIN action_records ar
       ON ar.guard_decision_id = gd.id AND ar.org_id = $1
     WHERE gd.org_id = $1
       AND gd.decision = 'require_approval'
       AND gd.created_at::timestamptz > NOW() - make_interval(days => $2::int)
       AND gd.action_type IS NOT NULL
       AND gd.context IS NOT NULL
       AND gd.context LIKE '{%'
       AND gd.context::jsonb ? 'evidence_flags'
       AND jsonb_typeof(gd.context::jsonb->'evidence_flags') = 'array'
       AND ${NOT_DEGRADED}
       AND ${syntheticExclusionSql(3, 4, 5)}
     GROUP BY gd.action_type, gd.context::jsonb->'evidence_flags'`,
    [orgId, days, opts.includeSynthetic === true, ...SYNTHETIC_PARAMS],
  );
  return rows as unknown as PrecedentOutcomeRow[];
}

/**
 * The precedent write: insert a narrow allow_grant scoped by the exact flag
 * set. Deliberately NOT parameterised on anything client-sent — the caller
 * passes values the SERVER re-derived from its own mined evidence.
 *
 * `precedent_flags` is what makes the grant narrow; `target_prefix` is
 * intentionally ABSENT, because a target prefix is exactly the shape of
 * over-broad grant that produced `security -> C:/Users/` (see pathPrefix in
 * app/lib/policy-shapes.ts).
 */
export async function createPrecedentGrant(
  sql: SqlTag,
  orgId: string,
  input: { policyId: string; name: string; actionType: string; flags: string[]; ttlDays: number },
): Promise<void> {
  const now = new Date();
  const rules = JSON.stringify({
    action_type: input.actionType,
    precedent_flags: input.flags,
    expires_at: new Date(now.getTime() + input.ttlDays * 86_400_000).toISOString(),
    _grant: true,
    _precedent: true,
  });
  await sql.query(
    `INSERT INTO guard_policies (id, org_id, name, policy_type, rules, active, created_at, updated_at)
     VALUES ($1, $2, $3, 'allow_grant', $4, 1, $5, $5)`,
    [input.policyId, orgId, input.name, rules, now.toISOString()],
  );
  invalidateGuardPolicyCache(orgId);
}

/** All decision rows for the org, newest judgment first. */
export async function getLooseningDecisions(
  sql: SqlTag,
  orgId: string,
): Promise<LooseningDecisionRow[]> {
  const rows = await sql.query(
    `SELECT * FROM loosening_proposal_decisions
     WHERE org_id = $1
     ORDER BY decided_at DESC`,
    [orgId],
  );
  return rows as unknown as LooseningDecisionRow[];
}

/** Record (or overwrite) the human's judgment on a proposal. */
export async function upsertLooseningDecision(
  sql: SqlTag,
  orgId: string,
  input: LooseningDecisionInput,
): Promise<LooseningDecisionRow | undefined> {
  const rows = await sql.query(
    `INSERT INTO loosening_proposal_decisions
       (org_id, proposal_id, rule, decision, action_type, policy_id,
        snapshot, reason, decided_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (org_id, proposal_id) DO UPDATE SET
       rule = EXCLUDED.rule,
       decision = EXCLUDED.decision,
       action_type = EXCLUDED.action_type,
       policy_id = EXCLUDED.policy_id,
       snapshot = EXCLUDED.snapshot,
       reason = EXCLUDED.reason,
       decided_by = EXCLUDED.decided_by,
       decided_at = now()
     RETURNING *`,
    [
      orgId,
      input.proposalId,
      input.rule,
      input.decision,
      input.actionType,
      input.policyId,
      input.snapshot == null ? null : JSON.stringify(input.snapshot),
      input.reason,
      input.decidedBy,
    ],
  );
  return (rows as unknown as LooseningDecisionRow[])[0];
}

/** Undo — removes the judgment entirely (a relaxation a prior ratify applied
 *  stays: the policy is a first-class guard policy, managed at /policies). */
export async function deleteLooseningDecision(
  sql: SqlTag,
  orgId: string,
  proposalId: string,
): Promise<LooseningDecisionRow | null> {
  const rows = await sql.query(
    `DELETE FROM loosening_proposal_decisions
     WHERE org_id = $1 AND proposal_id = $2
     RETURNING *`,
    [orgId, proposalId],
  );
  return (rows as unknown as LooseningDecisionRow[])[0] ?? null;
}

/** Full policy row for ratify's server-side rebuild (org-scoped). */
export async function getPolicyForLoosening(
  sql: SqlTag,
  orgId: string,
  policyId: string,
): Promise<Record<string, unknown> | null> {
  const rows = await sql.query(
    `SELECT * FROM guard_policies WHERE org_id = $1 AND id = $2 LIMIT 1`,
    [orgId, policyId],
  );
  return (rows[0] as Record<string, unknown> | undefined) ?? null;
}

/**
 * Apply a ratified relaxation: new rules JSON (scope carve-out) or
 * deactivation. Bumps updated_at (evidence-window reset) and invalidates the
 * guard policy cache — same discipline as every policy write in
 * guardrails.repository.ts.
 */
export async function applyLooseningRelaxation(
  sql: SqlTag,
  orgId: string,
  policyId: string,
  change: { rules: string } | { active: 0 },
): Promise<Record<string, unknown> | null> {
  const now = new Date().toISOString();
  const rows =
    'rules' in change
      ? await sql.query(
          `UPDATE guard_policies SET rules = $3, updated_at = $4
           WHERE id = $1 AND org_id = $2 RETURNING *`,
          [policyId, orgId, change.rules, now],
        )
      : await sql.query(
          `UPDATE guard_policies SET active = 0, updated_at = $3
           WHERE id = $1 AND org_id = $2 RETURNING *`,
          [policyId, orgId, now],
        );
  invalidateGuardPolicyCache(orgId);
  return (rows[0] as Record<string, unknown> | undefined) ?? null;
}
