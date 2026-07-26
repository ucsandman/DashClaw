import { randomUUID } from 'crypto';
import { computeActContentHash } from '../act-content-hash';

type SqlClient = {
  (s: TemplateStringsArray, ...v: unknown[]): Promise<Record<string, unknown>[]>;
  query: (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
};

// Preflight Plan Authorization (docs/rfcs/2026-07-06-preflight-plan-authorization.md).
// All SQL for the feature lives here — routes must not embed SQL (route-sql:check).
// Grants are single-use: consumption is one atomic UPDATE ... WHERE grant_used_at
// IS NULL RETURNING, the same race-safety shape as applyOperatorApprovalGrant.

export const PLAN_STATUSES = ['pending', 'approved', 'partially_approved', 'denied', 'expired', 'revoked'];
export const STEP_GRANT_STATUSES = ['pending', 'approved', 'denied'];

const mintId = (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 16)}`;

export interface PlanStepInput {
  action_type: string;
  step_goal: string;
  act?: unknown;
}

export async function createPlanWithSteps(
  sql: SqlClient,
  orgId: string,
  input: { agentId: string; declaredGoal: string; ttlMinutes: number; steps: PlanStepInput[] },
) {
  const planId = mintId('pa');
  const planRows = await sql`
    INSERT INTO plan_authorizations (plan_id, org_id, agent_id, declared_goal, status, ttl_minutes)
    VALUES (${planId}, ${orgId}, ${input.agentId}, ${input.declaredGoal}, 'pending', ${input.ttlMinutes})
    RETURNING *
  `;
  const steps: Record<string, unknown>[] = [];
  let seq = 0;
  for (const step of input.steps) {
    seq += 1;
    const stepId = mintId('ps');
    const actHash = computeActContentHash(step.act);
    const rows = await sql`
      INSERT INTO plan_authorization_steps
        (step_id, plan_id, org_id, seq, action_type, step_goal, act, act_content_hash)
      VALUES
        (${stepId}, ${planId}, ${orgId}, ${seq}, ${step.action_type}, ${step.step_goal},
         ${step.act === undefined ? null : JSON.stringify(step.act)}, ${actHash})
      RETURNING *
    `;
    steps.push(rows[0]!);
  }
  return { plan: planRows[0], steps };
}

export async function stampStepPreview(
  sql: SqlClient,
  orgId: string,
  stepId: string,
  preview: { decision: string; riskScore: number; reasons: unknown[] },
) {
  await sql`
    UPDATE plan_authorization_steps
    SET preview_decision = ${preview.decision},
        preview_risk_score = ${preview.riskScore},
        preview_reasons = ${JSON.stringify(preview.reasons)}
    WHERE org_id = ${orgId} AND step_id = ${stepId}
  `;
}

export async function listPlans(
  sql: SqlClient,
  orgId: string,
  filters: { status?: string; agentId?: string; limit?: number } = {},
) {
  const conditions = ['org_id = $1'];
  const params: unknown[] = [orgId];
  let idx = 2;
  if (filters.status) { conditions.push(`status = $${idx}`); params.push(filters.status); idx++; }
  if (filters.agentId) { conditions.push(`agent_id = $${idx}`); params.push(filters.agentId); idx++; }
  return sql.query(
    `SELECT * FROM plan_authorizations WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC LIMIT $${idx}`,
    [...params, filters.limit ?? 50],
  );
}

export async function getPlanWithSteps(sql: SqlClient, orgId: string, planId: string) {
  const plans = await sql`
    SELECT * FROM plan_authorizations WHERE org_id = ${orgId} AND plan_id = ${planId}
  `;
  if (!plans[0]) return null;
  const steps = await sql`
    SELECT * FROM plan_authorization_steps WHERE org_id = ${orgId} AND plan_id = ${planId} ORDER BY seq ASC
  `;
  return { plan: plans[0], steps };
}

export async function countPendingPlans(sql: SqlClient, orgId: string): Promise<number> {
  const rows = await sql`
    SELECT COUNT(*)::int AS n FROM plan_authorizations WHERE org_id = ${orgId} AND status = 'pending'
  `;
  return Number(rows[0]?.n ?? 0);
}

/**
 * Operator verdict. 'approve' honors stepOverrides (step_id -> 'approve'|'deny');
 * unlisted steps inherit 'approve'. Any denied step => plan status
 * 'partially_approved' (all denied => 'denied'). 'deny' denies every step.
 * 'revoke' kills all unconsumed grants immediately (status 'revoked').
 * expires_at = now() + min(ttl_minutes, ttlClampMinutes). Only transitions
 * plans whose status is pending (approve/deny) or approved/partially_approved
 * (revoke). Returns null when the plan is missing or not transitionable.
 */
export async function reviewPlan(
  sql: SqlClient,
  orgId: string,
  planId: string,
  input: { verdict: 'approve' | 'deny' | 'revoke'; stepOverrides?: Record<string, string>; reviewedBy: string; ttlClampMinutes: number },
) {
  const plans = await sql`
    SELECT * FROM plan_authorizations WHERE org_id = ${orgId} AND plan_id = ${planId}
  `;
  const plan = plans[0] as { plan_id: string; status: string; ttl_minutes: number } | undefined;
  if (!plan) return null;

  if (input.verdict === 'revoke') {
    if (!['pending', 'approved', 'partially_approved'].includes(plan.status)) return null;
    await sql`
      UPDATE plan_authorization_steps SET grant_status = 'denied'
      WHERE org_id = ${orgId} AND plan_id = ${planId} AND grant_used_at IS NULL
    `;
    const updated = await sql`
      UPDATE plan_authorizations
      SET status = 'revoked', reviewed_by = ${input.reviewedBy}, reviewed_at = now()
      WHERE org_id = ${orgId} AND plan_id = ${planId}
      RETURNING *
    `;
    const steps = await sql`
      SELECT * FROM plan_authorization_steps WHERE org_id = ${orgId} AND plan_id = ${planId} ORDER BY seq ASC
    `;
    return { plan: updated[0], steps };
  }

  if (plan.status !== 'pending') return null;
  const clampedTtl = Math.min(Number(plan.ttl_minutes) || 60, input.ttlClampMinutes);

  if (input.verdict === 'deny') {
    await sql`
      UPDATE plan_authorization_steps SET grant_status = 'denied'
      WHERE org_id = ${orgId} AND plan_id = ${planId}
    `;
    const updated = await sql`
      UPDATE plan_authorizations
      SET status = 'denied', reviewed_by = ${input.reviewedBy}, reviewed_at = now(),
          expires_at = now() + make_interval(mins => ${clampedTtl})
      WHERE org_id = ${orgId} AND plan_id = ${planId}
      RETURNING *
    `;
    const steps = await sql`
      SELECT * FROM plan_authorization_steps WHERE org_id = ${orgId} AND plan_id = ${planId} ORDER BY seq ASC
    `;
    return { plan: updated[0], steps };
  }

  // approve (with optional per-step overrides)
  const overrides = input.stepOverrides ?? {};
  const stepRows = await sql`
    SELECT step_id FROM plan_authorization_steps WHERE org_id = ${orgId} AND plan_id = ${planId}
  `;
  let denied = 0;
  for (const row of stepRows as Array<{ step_id: string }>) {
    const verdict = overrides[row.step_id] === 'deny' ? 'denied' : 'approved';
    if (verdict === 'denied') denied += 1;
    await sql`
      UPDATE plan_authorization_steps SET grant_status = ${verdict}
      WHERE org_id = ${orgId} AND step_id = ${row.step_id}
    `;
  }
  const status = denied === 0 ? 'approved' : denied === stepRows.length ? 'denied' : 'partially_approved';
  const updated = await sql`
    UPDATE plan_authorizations
    SET status = ${status}, reviewed_by = ${input.reviewedBy}, reviewed_at = now(),
        expires_at = now() + make_interval(mins => ${clampedTtl})
    WHERE org_id = ${orgId} AND plan_id = ${planId}
    RETURNING *
  `;
  const steps = await sql`
    SELECT * FROM plan_authorization_steps WHERE org_id = ${orgId} AND plan_id = ${planId} ORDER BY seq ASC
  `;
  return { plan: updated[0], steps };
}

/**
 * Single-use atomic consumption — the plan-grant twin of the operator-grant
 * UPDATE in evaluate.ts. Matching: org + agent + action_type + live plan
 * (approved/partially_approved, unexpired) + approved unconsumed step + act
 * binding (step hash must equal the live hash when the step is act-bound;
 * hashless steps match on step_goal = live declared_goal instead).
 */
export async function consumePlanStepGrant(
  sql: SqlClient,
  orgId: string,
  input: { agentId: string; actionType: string; declaredGoal: string; actHash: string | null; matchedActionId: string },
) {
  const rows = await sql`
    UPDATE plan_authorization_steps s
    SET grant_used_at = now(), matched_action_id = ${input.matchedActionId}
    WHERE s.step_id = (
      SELECT st.step_id
      FROM plan_authorization_steps st
      JOIN plan_authorizations p ON p.plan_id = st.plan_id AND p.org_id = st.org_id
      WHERE st.org_id = ${orgId}
        AND p.agent_id = ${input.agentId}
        AND st.action_type = ${input.actionType}
        AND p.status IN ('approved', 'partially_approved')
        AND p.expires_at > now()
        AND st.grant_status = 'approved'
        AND st.grant_used_at IS NULL
        AND (
          (st.act_content_hash IS NOT NULL AND st.act_content_hash = ${input.actHash})
          OR (st.act_content_hash IS NULL AND st.step_goal = ${input.declaredGoal})
        )
      ORDER BY st.seq ASC
      LIMIT 1
    )
      AND s.org_id = ${orgId}
      AND s.grant_used_at IS NULL
    RETURNING s.step_id, s.plan_id, s.seq, s.act_content_hash,
      (SELECT reviewed_by FROM plan_authorizations WHERE plan_id = s.plan_id AND org_id = s.org_id) AS reviewed_by,
      (SELECT COUNT(*)::int FROM plan_authorization_steps WHERE plan_id = s.plan_id AND org_id = s.org_id) AS total_steps
  `;
  return (rows[0] as {
    step_id: string; plan_id: string; seq: number; reviewed_by: string | null;
    act_content_hash: string | null; total_steps: number;
  } | undefined) ?? null;
}

/**
 * Deny-grant lookup (read-only; denied steps raise on EVERY match until the
 * plan TTL — they are not consumed). Same matching rule as consumption.
 */
export async function findDeniedStepMatch(
  sql: SqlClient,
  orgId: string,
  input: { agentId: string; actionType: string; declaredGoal: string; actHash: string | null },
) {
  const rows = await sql`
    SELECT st.step_id, st.plan_id, p.reviewed_by
    FROM plan_authorization_steps st
    JOIN plan_authorizations p ON p.plan_id = st.plan_id AND p.org_id = st.org_id
    WHERE st.org_id = ${orgId}
      AND p.agent_id = ${input.agentId}
      AND st.action_type = ${input.actionType}
      AND p.status IN ('approved', 'partially_approved', 'denied')
      AND p.expires_at > now()
      AND st.grant_status = 'denied'
      AND (
        (st.act_content_hash IS NOT NULL AND st.act_content_hash = ${input.actHash})
        OR (st.act_content_hash IS NULL AND st.step_goal = ${input.declaredGoal})
      )
    ORDER BY st.seq ASC
    LIMIT 1
  `;
  return (rows[0] as { step_id: string; plan_id: string; reviewed_by: string | null } | undefined) ?? null;
}
