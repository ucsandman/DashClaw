import type { SqlTag } from '../types/db';

export async function findPlanExecutionAuthority(sql: SqlTag, orgId: string, input: {
  agentId: string; actionType: string; declaredGoal: string; actHash: string | null;
}) {
  const rows = await sql`
    SELECT s.step_id, s.plan_id, s.seq, s.act_content_hash, s.preview_decision, p.reviewed_by,
      (SELECT COUNT(*)::int FROM plan_authorization_steps WHERE plan_id = p.plan_id AND org_id = p.org_id) AS total_steps
    FROM plan_authorization_steps s JOIN plan_authorizations p ON p.plan_id = s.plan_id AND p.org_id = s.org_id
    WHERE s.org_id = ${orgId} AND p.agent_id = ${input.agentId}
      AND s.action_type = ${input.actionType} AND s.step_goal = ${input.declaredGoal}
      AND (s.act_content_hash IS NULL OR s.act_content_hash = ${input.actHash})
      AND p.status IN ('approved', 'partially_approved') AND p.expires_at > NOW()
      AND s.grant_status = 'approved' AND s.grant_used_at IS NULL
    ORDER BY s.seq ASC LIMIT 1
  `;
  return rows[0] as { step_id: string; plan_id: string; seq: number; act_content_hash: string | null;
    preview_decision: string | null; reviewed_by: string | null; total_steps: number } | undefined;
}

/** One SQL statement locks the candidate, consumes optional authority, and
 * claims the attempt. Any write failure rolls back all three. A repeated
 * nonce never grants execution again: a lost response must be reconciled. */
export async function claimActionExecution(sql: SqlTag, input: {
  orgId: string; actionId: string; agentId: string; attemptId: string; actHash: string | null;
  decisionId: string; principalId: string; identityVerified: boolean;
}) {
  const rows = await sql.query(`
    WITH candidate AS MATERIALIZED (
      SELECT a.*, d.context::jsonb -> '_execution_authorization' AS authority
      FROM action_records a
      JOIN guard_decisions d ON d.id = $6 AND d.org_id = a.org_id
        AND d.agent_id = a.agent_id AND d.action_type = a.action_type
        AND (d.context::jsonb ->> '_execution_act_content_hash') IS NOT DISTINCT FROM a.act_content_hash
      WHERE a.org_id = $1 AND a.action_id = $2 AND a.agent_id = $3
        AND a.created_by = $7
        AND (a.identity_verified IS DISTINCT FROM TRUE OR $8::boolean)
        AND a.act_content_hash IS NOT DISTINCT FROM $5::text
        AND a.status = 'running' AND a.outcome_status = 'pending'
        AND a.execution_claimed_at IS NULL
        AND a.execution_protocol = 1
        AND (a.approved_by IS NULL OR a.approved_by = '' OR (
          a.approval_grant_used_at IS NULL AND a.approved_at > NOW() - interval '15 minutes'
        ))
        AND d.decision IN ('allow', 'warn', 'allow_contained')
        AND (d.decision <> 'allow_contained' OR (a.containment_status = 'contained'
          AND a.containment_ref = d.context::jsonb -> '_execution_containment' ->> 'ref'))
      FOR UPDATE OF a
    ), operator_authority AS (
      UPDATE action_records source SET approval_grant_used_at = NOW()
      FROM candidate c
      WHERE c.authority ->> 'kind' = 'operator' AND source.action_id = c.authority ->> 'id'
        AND source.action_id <> c.action_id AND source.org_id = c.org_id
        AND source.execution_protocol = 1
        AND (source.created_by = c.created_by OR (
          source.action_type = 'containment_promote' AND EXISTS (
            SELECT 1 FROM action_records origin WHERE origin.action_id = source.parent_action_id
              AND origin.org_id = source.org_id AND origin.agent_id = source.agent_id
              AND origin.created_by = c.created_by
          )
        ))
        AND source.agent_id = c.agent_id AND source.action_type = c.action_type
        AND source.declared_goal = c.declared_goal
        AND source.act_content_hash IS NOT DISTINCT FROM c.act_content_hash
        AND source.status = 'running' AND source.outcome_status = 'pending'
        AND NULLIF(source.approved_by, '') IS NOT NULL
        AND source.approved_at > NOW() - interval '15 minutes'
        AND source.approval_grant_used_at IS NULL AND source.execution_claimed_at IS NULL
      RETURNING c.action_id
    ), plan_authority AS (
      UPDATE plan_authorization_steps s SET grant_used_at = NOW(), matched_action_id = c.action_id
      FROM candidate c, plan_authorizations p
      WHERE c.authority ->> 'kind' = 'plan' AND s.step_id = c.authority ->> 'id'
        AND s.org_id = c.org_id AND p.org_id = s.org_id AND p.plan_id = s.plan_id
        AND p.agent_id = c.agent_id AND p.status IN ('approved', 'partially_approved')
        AND p.expires_at > NOW() AND s.grant_status = 'approved' AND s.grant_used_at IS NULL
        AND s.action_type = c.action_type AND s.step_goal = c.declared_goal
        AND (s.act_content_hash IS NULL OR s.act_content_hash = c.act_content_hash)
      RETURNING c.action_id
    )
    UPDATE action_records a SET execution_claimed_at = NOW(), execution_attempt_id = $4,
      execution_guard_decision_id = $6,
      approval_grant_used_at = CASE WHEN NULLIF(a.approved_by, '') IS NOT NULL
        THEN NOW() ELSE a.approval_grant_used_at END
    FROM candidate c
    WHERE a.action_id = c.action_id AND a.org_id = c.org_id
      AND (c.authority IS NULL OR c.authority = 'null'::jsonb
        OR (c.authority ->> 'kind' = 'operator' AND c.authority ->> 'id' = c.action_id
          AND NULLIF(c.approved_by, '') IS NOT NULL)
        OR EXISTS (SELECT 1 FROM operator_authority o WHERE o.action_id = c.action_id)
        OR EXISTS (SELECT 1 FROM plan_authority p WHERE p.action_id = c.action_id))
    RETURNING a.action_id, a.execution_attempt_id, a.execution_claimed_at
  `, [input.orgId, input.actionId, input.agentId, input.attemptId, input.actHash, input.decisionId, input.principalId, input.identityVerified]);
  return rows[0] ?? null;
}

export async function getExecutionCandidate(sql: SqlTag, input: {
  orgId: string; actionId: string; agentId: string; principalId: string; actHash: string | null;
}) {
  const rows = await sql`
    SELECT a.*, d.context AS guard_context
    FROM action_records a JOIN guard_decisions d ON d.id = a.guard_decision_id AND d.org_id = a.org_id
    WHERE a.org_id = ${input.orgId} AND a.action_id = ${input.actionId}
      AND a.agent_id = ${input.agentId} AND a.created_by = ${input.principalId}
      AND a.act_content_hash IS NOT DISTINCT FROM ${input.actHash}::text
      AND a.execution_protocol = 1 AND a.execution_claimed_at IS NULL
      AND a.status = 'running' AND a.outcome_status = 'pending'
      AND d.decision <> 'block'
  `;
  return rows[0] ?? null;
}
