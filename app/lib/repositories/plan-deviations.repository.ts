import { randomUUID } from 'crypto';
import { redactAny } from '../security';

type SqlClient = {
  (s: TemplateStringsArray, ...v: unknown[]): Promise<Record<string, unknown>[]>;
  query: (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
};

// Plan deviation events (docs/rfcs/2026-08-11-plan-deviation-events.md).
// All SQL for the feature lives here — routes must not embed SQL
// (route-sql:check). Deviations are the durable else-branch of
// consumePlanStepGrant: recording is unconditional (D1), consequence flows
// only through the deviation_response policy type (D2), and every write here
// is best-effort from the guard's perspective (D3 — callers wrap, we throw).

export const DEVIATION_KINDS = [
  'unplanned_action', 'goal_drift', 'act_substitution', 'scope_escape',
  'step_abandoned', 'budget_overrun',
] as const;
export type DeviationKind = (typeof DEVIATION_KINDS)[number];

export const DEVIATION_SEVERITIES = ['info', 'low', 'medium', 'high'] as const;
export type DeviationSeverity = (typeof DEVIATION_SEVERITIES)[number];

export const DEVIATION_RESOLUTIONS = ['acknowledged', 'accepted', 'rejected'] as const;
export type DeviationResolution = (typeof DEVIATION_RESOLUTIONS)[number];

const mintId = (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 16)}`;

export interface PlanDeviationInsert {
  orgId: string;
  agentId: string;
  sessionId?: string | null;
  actionId?: string | null;
  guardDecisionId?: string | null;
  planId: string;
  stepId?: string | null;
  kind: DeviationKind;
  dimension: string;
  severity: DeviationSeverity;
  declared?: unknown;
  observed?: unknown;
  detector?: 'server_derived' | 'agent_reported';
  matchConfidence?: number | null;
  agentNote?: string | null;
  policyOutcome?: string;
}

/**
 * Insert one deviation row. declared/observed pass through the same redaction
 * plan step acts use — a deviation must never become the one place a
 * secret-bearing act sits unredacted (RFC §4). Returns null when the
 * step_abandoned uniqueness guard swallows a duplicate (ON CONFLICT DO
 * NOTHING against uq_plan_deviations_step_abandoned) — that null is the
 * sweep's idempotency signal, not an error.
 */
export async function insertPlanDeviation(sql: SqlClient, orgId: string, input: PlanDeviationInsert) {
  const deviationId = mintId('dv');
  const declared = input.declared === undefined ? null : JSON.stringify(redactAny(input.declared, []));
  const observed = input.observed === undefined ? null : JSON.stringify(redactAny(input.observed, []));
  const rows = await sql`
    INSERT INTO plan_deviations
      (deviation_id, org_id, agent_id, session_id, action_id, guard_decision_id,
       plan_id, step_id, kind, dimension, severity, declared, observed,
       detector, match_confidence, agent_note, policy_outcome)
    VALUES
      (${deviationId}, ${orgId}, ${input.agentId}, ${input.sessionId ?? null},
       ${input.actionId ?? null}, ${input.guardDecisionId ?? null},
       ${input.planId}, ${input.stepId ?? null}, ${input.kind}, ${input.dimension},
       ${input.severity}, ${declared}, ${observed},
       ${input.detector ?? 'server_derived'}, ${input.matchConfidence ?? null},
       ${input.agentNote ?? null}, ${input.policyOutcome ?? 'none'})
    ON CONFLICT DO NOTHING
    RETURNING *
  `;
  return rows[0] ?? null;
}

export async function listDeviationsForPlan(sql: SqlClient, orgId: string, planId: string) {
  return sql`
    SELECT * FROM plan_deviations
    WHERE org_id = ${orgId} AND plan_id = ${planId}
    ORDER BY created_at DESC
    LIMIT 200
  `;
}

export async function listDeviationsForAction(sql: SqlClient, orgId: string, actionId: string) {
  return sql`
    SELECT * FROM plan_deviations
    WHERE org_id = ${orgId} AND action_id = ${actionId}
    ORDER BY created_at DESC
    LIMIT 50
  `;
}

export async function listDeviationsForSession(sql: SqlClient, orgId: string, sessionId: string) {
  return sql`
    SELECT * FROM plan_deviations
    WHERE org_id = ${orgId} AND session_id = ${sessionId}
    ORDER BY created_at DESC
    LIMIT 200
  `;
}

/**
 * Operator resolution. Only an operator resolves a deviation (RFC §6 — an
 * agent report may never set status), and only from 'open': the UPDATE
 * carries its precondition in SQL so a losing race returns null instead of
 * overwriting another operator's resolution. Resolution and approval are
 * strictly separate verbs (RFC OQ5): accepting a deviation never releases a
 * pending approval on the action.
 */
export async function resolveDeviation(
  sql: SqlClient,
  orgId: string,
  deviationId: string,
  input: { resolution: DeviationResolution; resolvedBy: string },
) {
  if (!DEVIATION_RESOLUTIONS.includes(input.resolution)) {
    throw new Error(`Invalid resolution "${input.resolution}" — expected one of ${DEVIATION_RESOLUTIONS.join(', ')}`);
  }
  const rows = await sql`
    UPDATE plan_deviations
    SET status = ${input.resolution}, resolved_by = ${input.resolvedBy}, resolved_at = now()
    WHERE org_id = ${orgId} AND deviation_id = ${deviationId} AND status = 'open'
    RETURNING *
  `;
  return rows[0] ?? null;
}

/**
 * step_abandoned sweep, run when a plan reaches a terminal state (revoke, or
 * derived-expired observed on a read path): one deviation per approved step
 * that was never consumed — the case pure per-action detection structurally
 * cannot catch, because it is the absence of an action (RFC §5). Idempotent
 * via uq_plan_deviations_step_abandoned (partial unique on step_id): re-runs
 * conflict away to zero inserts. Returns the number of NEW rows written.
 */
export async function sweepAbandonedSteps(sql: SqlClient, orgId: string, planId: string): Promise<number> {
  const steps = await sql`
    SELECT st.step_id, st.seq, st.action_type, st.step_goal, p.agent_id
    FROM plan_authorization_steps st
    JOIN plan_authorizations p ON p.plan_id = st.plan_id AND p.org_id = st.org_id
    WHERE st.org_id = ${orgId} AND st.plan_id = ${planId}
      AND st.grant_status = 'approved' AND st.grant_used_at IS NULL
    ORDER BY st.seq ASC
  `;
  let inserted = 0;
  for (const step of steps as Array<{ step_id: string; seq: number; action_type: string; step_goal: string; agent_id: string }>) {
    const row = await insertPlanDeviation(sql, orgId, {
      orgId,
      agentId: step.agent_id,
      planId,
      stepId: step.step_id,
      kind: 'step_abandoned',
      dimension: 'existence',
      severity: 'low',
      declared: { action_type: step.action_type, step_goal: step.step_goal, seq: step.seq },
      matchConfidence: 100,
    });
    if (row) inserted += 1;
  }
  return inserted;
}
