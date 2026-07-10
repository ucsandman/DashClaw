/**
 * Guardrails Test Runs repository
 */

import { invalidateGuardPolicyCache } from '../guard';
import {
  SYNTHETIC_ACTION_TYPE_LIKE_PATTERNS,
  SYNTHETIC_AGENT_LIKE_PATTERNS,
} from '../calibration-mining.js';
import type { SqlTag } from '../types/db';

type SqlClient = {
  (s: TemplateStringsArray, ...v: unknown[]): Promise<Record<string, unknown>[]>;
  query: (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
};

interface CreateTestRunData {
  id: string;
  total_policies: number;
  total_tests: number;
  passed: number;
  failed: number;
  success: boolean;
  details: unknown;
  triggered_by?: string;
  [k: string]: unknown;
}

interface GuardrailDecisionFilters {
  decision?: string;
  agentId?: string;
  limit?: number;
  offset?: number;
}

interface InsertPolicyData {
  id: string;
  name: string;
  policyType: string;
  rules: unknown;
  agentIds?: unknown;
  active?: number;
}

export async function createTestRun(
  sql: SqlTag,
  orgId: string,
  data: CreateTestRunData
): Promise<Record<string, unknown> | null> {
  const result = await sql`
    INSERT INTO guardrails_test_runs (id, org_id, total_policies, total_tests, passed, failed, success, details, triggered_by, created_at)
    VALUES (${data.id}, ${orgId}, ${data.total_policies}, ${data.total_tests}, ${data.passed}, ${data.failed}, ${data.success ? 1 : 0}, ${JSON.stringify(data.details)}, ${data.triggered_by || 'manual'}, ${new Date().toISOString()})
    RETURNING *
  `;
  return result[0] ?? null;
}

export async function listTestRuns(
  sql: SqlTag,
  orgId: string,
  limit = 20
): Promise<Record<string, unknown>[]> {
  return sql`
    SELECT * FROM guardrails_test_runs
    WHERE org_id = ${orgId}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
}

export async function getActivePolicies(
  sql: SqlTag,
  orgId: string
): Promise<Record<string, unknown>[]> {
  return sql`
    SELECT * FROM guard_policies
    WHERE org_id = ${orgId} AND active = 1
    ORDER BY created_at DESC
  `;
}

export async function findPolicyByName(
  sql: SqlTag,
  orgId: string,
  name: string
): Promise<Record<string, unknown>[]> {
  return sql`
    SELECT id FROM guard_policies WHERE org_id = ${orgId} AND name = ${name}
  `;
}

export async function deletePoliciesByIds(
  sql: SqlTag,
  orgId: string,
  idList: string[]
): Promise<Record<string, unknown>[]> {
  const rows = await sql`
    DELETE FROM guard_policies
    WHERE id = ANY(${idList}) AND org_id = ${orgId}
    RETURNING id
  `;
  invalidateGuardPolicyCache(orgId);
  return rows;
}

export async function listGuardrailDecisions(
  sql: SqlClient,
  orgId: string,
  filters: GuardrailDecisionFilters = {}
): Promise<{ decisions: Record<string, unknown>[]; total: number }> {
  const { decision, agentId, limit = 50, offset = 0 } = filters;

  let paramIdx = 1;
  const conditions = [`gd.org_id = $${paramIdx++}`];
  const params: unknown[] = [orgId];

  if (decision) {
    conditions.push(`gd.decision = $${paramIdx++}`);
    params.push(decision);
  }
  if (agentId) {
    conditions.push(`gd.agent_id = $${paramIdx++}`);
    params.push(agentId);
  }

  const where = `WHERE ${conditions.join(' AND ')}`;

  const decisionsQuery = `
    SELECT gd.id, gd.decision, gd.risk_score, gd.agent_id, gd.action_type,
           gd.reason, gd.matched_policies, gd.context, gd.created_at,
           gd.verification_status, gd.replay_status, gd.act_status
    FROM guard_decisions gd
    ${where}
    ORDER BY gd.created_at DESC
    LIMIT $${paramIdx++} OFFSET $${paramIdx++}
  `;
  params.push(limit, offset);

  const countQuery = `SELECT COUNT(*)::int AS total FROM guard_decisions gd ${where}`;
  const countParams = params.slice(0, -2);

  const [decisions, countResult] = await Promise.all([
    sql.query(decisionsQuery, params),
    sql.query(countQuery, countParams),
  ]);

  return {
    decisions: decisions || [],
    total: parseInt((countResult[0]?.total as string | undefined) || '0', 10),
  };
}

export async function getGuardDecisionStats(
  sql: SqlClient,
  orgId: string
): Promise<{ blocks: number; approvals: number; warns: number }> {
  const result = await sql.query(
    `SELECT
      COUNT(*) FILTER (WHERE decision = 'block')::int AS blocks,
      COUNT(*) FILTER (WHERE decision = 'require_approval')::int AS approvals,
      COUNT(*) FILTER (WHERE decision = 'warn')::int AS warns
    FROM guard_decisions
    WHERE org_id = $1 AND created_at::timestamptz > NOW() - INTERVAL '7 days'`,
    [orgId]
  );
  const row = result[0] || {};
  return {
    blocks: parseInt((row.blocks as string | undefined) || '0', 10),
    approvals: parseInt((row.approvals as string | undefined) || '0', 10),
    warns: parseInt((row.warns as string | undefined) || '0', 10),
  };
}

/**
 * Per-policy fire counts over the last `days` days, keyed by `guard_policies.id`.
 * `guard_decisions.matched_policies` is a JSON-array TEXT column holding the ids of
 * every policy that fired on a decision (see `applyResult` in app/lib/guard.ts).
 * Read-only; no schema change. Defensive: only array-shaped JSON text is unnested,
 * so malformed/null rows are skipped rather than throwing on the `::jsonb` cast.
 * Numeric strings are coerced (Neon HTTP driver returns counts as strings).
 */
export async function getDecisionCountsByPolicy(
  sql: SqlClient,
  orgId: string,
  days = 30
): Promise<Record<string, { fired: number; lastFiredAt: string | null }>> {
  const rows = await sql.query(
    `SELECT sub.policy_id AS policy_id,
            COUNT(*)::int AS cnt,
            MAX(sub.fired_at) AS last_fired
     FROM (
       SELECT jsonb_array_elements_text(matched_policies::jsonb) AS policy_id,
              created_at::timestamptz AS fired_at
       FROM guard_decisions
       WHERE org_id = $1
         AND created_at::timestamptz > NOW() - make_interval(days => $2::int)
         AND matched_policies IS NOT NULL
         AND matched_policies LIKE '[%'
     ) sub
     GROUP BY sub.policy_id`,
    [orgId, days]
  );
  const out: Record<string, { fired: number; lastFiredAt: string | null }> = {};
  for (const r of rows as Array<{ policy_id: string; cnt: number | string; last_fired: string | null }>) {
    if (typeof r.policy_id !== 'string') continue;
    out[r.policy_id] = { fired: Number(r.cnt) || 0, lastFiredAt: r.last_fired ?? null };
  }
  return out;
}

/**
 * Org-wide decision OUTCOME counts over the last `days` days, by nominal decision.
 * `allow` is derived (total − warn − require_approval − block) and floored at 0.
 * Read-only; no schema change.
 */
export async function getDecisionOutcomeCounts(
  sql: SqlClient,
  orgId: string,
  days = 30
): Promise<{ total: number; allow: number; warn: number; require_approval: number; block: number }> {
  const result = await sql.query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE decision = 'warn')::int AS warn,
            COUNT(*) FILTER (WHERE decision = 'require_approval')::int AS require_approval,
            COUNT(*) FILTER (WHERE decision = 'block')::int AS block
     FROM guard_decisions
     WHERE org_id = $1 AND created_at::timestamptz > NOW() - make_interval(days => $2::int)`,
    [orgId, days]
  );
  const row = result[0] || {};
  const total = parseInt((row.total as string | undefined) || '0', 10);
  const warn = parseInt((row.warn as string | undefined) || '0', 10);
  const require_approval = parseInt((row.require_approval as string | undefined) || '0', 10);
  const block = parseInt((row.block as string | undefined) || '0', 10);
  return { total, allow: Math.max(0, total - warn - require_approval - block), warn, require_approval, block };
}

/**
 * require_approval decision counts per matched policy inside a short window
 * (minutes). Drives the W3 interruption budget / approval flood guard.
 *
 * Synthetic traffic (policy-smoke, self-tests; shared v3.1 predicate from
 * calibration-mining.js) is excluded by default so the platform's own
 * verification runs can never trip a flood, suppress real per-action pings,
 * or mint the red approval_flood signal. `includeSynthetic` exists ONLY for
 * the floods endpoint's ?include_synthetic=1 diagnostic view (ephemeral,
 * never persisted) so the smoke harness can positively prove detection with
 * its own marked traffic — the tightening.repository.ts precedent.
 */
export async function getRecentApprovalCountsByPolicy(
  sql: SqlClient,
  orgId: string,
  windowMinutes = 15,
  opts: { includeSynthetic?: boolean } = {},
): Promise<Record<string, number>> {
  const rows = await sql.query(
    `SELECT sub.policy_id AS policy_id, COUNT(*)::int AS cnt
     FROM (
       SELECT jsonb_array_elements_text(matched_policies::jsonb) AS policy_id
       FROM guard_decisions
       WHERE org_id = $1
         AND decision = 'require_approval'
         AND created_at::timestamptz > NOW() - make_interval(mins => $2::int)
         AND matched_policies IS NOT NULL
         AND matched_policies LIKE '[%'
         AND ($3::boolean OR (
           (action_type IS NULL OR action_type NOT LIKE ALL($4::text[]))
           AND (agent_id IS NULL OR agent_id NOT LIKE ALL($5::text[]))
         ))
     ) sub
     GROUP BY sub.policy_id`,
    [
      orgId,
      windowMinutes,
      opts.includeSynthetic === true,
      SYNTHETIC_ACTION_TYPE_LIKE_PATTERNS,
      SYNTHETIC_AGENT_LIKE_PATTERNS,
    ],
  );
  const out: Record<string, number> = {};
  for (const r of rows as Array<{ policy_id: string; cnt: number }>) {
    if (typeof r.policy_id !== 'string') continue;
    out[r.policy_id] = Number(r.cnt) || 0;
  }
  return out;
}

/** Single policy fetch (bulk approval resolution reads its rules). */
export async function getPolicyById(
  sql: SqlClient,
  orgId: string,
  id: string,
): Promise<{ id: string; name: string; policy_type: string; rules: string | null } | null> {
  const rows = await sql.query(
    `SELECT id, name, policy_type, rules FROM guard_policies WHERE org_id = $1 AND id = $2 LIMIT 1`,
    [orgId, id],
  );
  return (rows as Array<{ id: string; name: string; policy_type: string; rules: string | null }>)[0] ?? null;
}

/**
 * Single guard-decision fetch by id, org-scoped. Feeds the agent_defense
 * rollup on the action detail response via `action_records.guard_decision_id`
 * — the exact FK link, not the legacy action_type+timestamp heuristic.
 */
export async function getGuardDecisionById(
  sql: SqlClient,
  orgId: string,
  id: string,
): Promise<Record<string, unknown> | null> {
  const rows = await sql.query(
    `SELECT id, decision, reason, matched_policies, context, evidence,
            risk_score, action_type, agent_id, verification_status,
            replay_status, act_status, created_at
     FROM guard_decisions WHERE org_id = $1 AND id = $2 LIMIT 1`,
    [orgId, id],
  );
  return rows[0] ?? null;
}

/** id → name for a bounded set of guard policies (flood labels). */
export async function getPolicyNamesByIds(
  sql: SqlClient,
  orgId: string,
  ids: string[],
): Promise<Record<string, string>> {
  if (!ids.length) return {};
  const rows = await sql.query(
    `SELECT id, name FROM guard_policies WHERE org_id = $1 AND id = ANY($2) LIMIT 100`,
    [orgId, ids],
  );
  const out: Record<string, string> = {};
  for (const r of rows as Array<{ id: string; name: string }>) out[r.id] = r.name;
  return out;
}

export async function insertPolicy(
  sql: SqlTag,
  orgId: string,
  { id, name, policyType, rules, agentIds, active = 1 }: InsertPolicyData
): Promise<Record<string, unknown> | null> {
  // `active` defaults to 1 to preserve existing callers. Behavior Learning
  // adoption passes active=0 so a suggested draft never auto-enforces — the
  // operator activates it later from the Policies surface.
  const activeFlag = active ? 1 : 0;
  const now = new Date().toISOString();
  const result = await sql`
    INSERT INTO guard_policies (id, org_id, name, policy_type, rules, active, agent_ids, created_at, updated_at)
    VALUES (${id}, ${orgId}, ${name}, ${policyType}, ${rules}, ${activeFlag}, ${agentIds || null}, ${now}, ${now})
    RETURNING *
  `;
  invalidateGuardPolicyCache(orgId);
  return result[0] ?? null;
}

/**
 * Reactivate an existing mode-generated policy in place and refresh it to the
 * mode's current compiled definition. Used by the modes import path: applying a
 * mode whose policies already exist (e.g. a previously-applied mode later toggled
 * off) must turn them back ON, not silently skip them — otherwise re-applying a
 * mode is a no-op and the cockpit stays "ungoverned". The rules + policy_type are
 * internally generated by the mode compiler, so they are stored directly (same
 * trust level as the original insert — no re-validation needed).
 *
 * Also used by the review-verdict route to revive a same-named inactive rule
 * instead of dead-ending an Always allow / Tighten click on the name-unique
 * constraint (rules there are route-generated, same trust level).
 */
export async function reactivateModePolicy(
  sql: SqlTag,
  orgId: string,
  id: string,
  { policyType, rules }: { policyType: string; rules: string }
): Promise<Record<string, unknown> | null> {
  const now = new Date().toISOString();
  const result = await sql`
    UPDATE guard_policies
    SET active = 1, policy_type = ${policyType}, rules = ${rules}, updated_at = ${now}
    WHERE id = ${id} AND org_id = ${orgId}
    RETURNING *
  `;
  invalidateGuardPolicyCache(orgId);
  return result[0] ?? null;
}
