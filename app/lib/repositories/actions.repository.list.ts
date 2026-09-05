import { sqlFragment, type Row, type SqlClient } from './actions.repository.shared';

interface ListActionsFilters {
  agent_id?: string;
  swarm_id?: string;
  status?: string;
  exclude_status?: string;
  action_type?: string;
  risk_min?: number | string;
  outcome_status?: string;
  /** Containment Verdicts (drizzle/0064): filters to a single lifecycle status. */
  containment_status?: string;
  /** Optional rolling window (1-365 days): scopes the list AND total/stats. */
  days?: number | string;
  /**
   * ISO cutoff for the expired-approvals view: only rows whose
   * approval_expires_at is strictly after this instant are listed. Backs the
   * /approvals "Clear expired" cursor; rows with a NULL expiry (legacy TTL
   * sweeps) are hidden once any cutoff is set.
   */
  expired_after?: string;
  limit?: number | string;
  offset?: number | string;
}

interface ParsedListActionsFilters {
  agent_id?: string;
  swarm_id?: string;
  status?: string;
  exclude_status?: string;
  action_type?: string;
  containment_status?: string;
  outcomeFilter: string | null;
  parsedRiskMin: number | null;
  /** ISO cutoff derived from `days` (null = no window). */
  sinceIso: string | null;
  /** Validated ISO cutoff from `expired_after` (null = no cursor). */
  expiredAfterIso: string | null;
  parsedLimit: number;
  parsedOffset: number;
}

interface ListActionSqlFragments {
  agent: ReturnType<SqlClient>;
  swarm: ReturnType<SqlClient>;
  status: ReturnType<SqlClient>;
  excludeStatus: ReturnType<SqlClient>;
  actionType: ReturnType<SqlClient>;
  riskMin: ReturnType<SqlClient>;
  outcome: ReturnType<SqlClient>;
  since: ReturnType<SqlClient>;
  expiredAfter: ReturnType<SqlClient>;
  containmentStatus: ReturnType<SqlClient>;
}

// Neon returns numeric aggregates (AVG/SUM) as strings; coerce the two stats
// the UI treats as numbers so callers receive numbers, not strings. COUNT-based
// fields are left as-is (callers parse them where needed).
function coerceActionStats(row: Row | undefined): Row {
  const s = row || {};
  return {
    ...s,
    avg_risk: Number(s.avg_risk) || 0,
    total_cost: Number(s.total_cost) || 0,
  };
}

function parseListActionsFilters(filters: ListActionsFilters): ParsedListActionsFilters {
  const {
    agent_id,
    swarm_id,
    status,
    exclude_status,
    action_type,
    risk_min,
    outcome_status,
    containment_status,
    days,
    expired_after,
    limit = 50,
    offset = 0,
  } = filters;
  const validOutcomes = new Set(['pending', 'completed', 'partial', 'failed', 'lost_confirmation']);
  // SECURITY LOW (2026-07-27 pre-ship sweep): containment_status wasn't
  // allowlisted like outcome_status above -- mirror the same pattern so an
  // arbitrary client-supplied value can't reach the SQL fragment unvalidated.
  // Matches the four lifecycle values the drizzle/0064 CHECK constraint
  // enforces (contained -> awaiting_promotion -> promoted|discarded).
  const validContainmentStatuses = new Set(['contained', 'awaiting_promotion', 'promoted', 'discarded']);
  // Rolling window: the cutoff is computed once here so the list, countQuery,
  // and statsQuery all scope identically (the windowed `total` is what makes
  // the activity narrative truthful — it is NOT a buffer length).
  const parsedDays = parseInt(days as string, 10);
  const clampedDays = Number.isFinite(parsedDays) ? Math.min(Math.max(parsedDays, 1), 365) : null;
  const expiredAfterMs = expired_after ? Date.parse(expired_after) : NaN;
  return {
    agent_id,
    swarm_id,
    status,
    exclude_status,
    action_type,
    containment_status: validContainmentStatuses.has(containment_status as string) ? (containment_status as string) : undefined,
    outcomeFilter: validOutcomes.has(outcome_status as string) ? (outcome_status as string) : null,
    parsedRiskMin: Number.isFinite(Number(risk_min)) ? Number(risk_min) : null,
    sinceIso: clampedDays != null ? new Date(Date.now() - clampedDays * 86_400_000).toISOString() : null,
    expiredAfterIso: Number.isFinite(expiredAfterMs) ? new Date(expiredAfterMs).toISOString() : null,
    parsedLimit: Math.min(parseInt(limit as string, 10) || 50, 200),
    parsedOffset: parseInt(offset as string, 10) || 0,
  };
}

function addQueryCondition(
  conditions: string[],
  params: unknown[],
  condition: string,
  value: unknown,
): void {
  conditions.push(`${condition} $${params.push(value)}`);
}

interface QueryConditionSpec {
  active: boolean;
  condition: string;
  value: unknown;
}

function buildListActionsQueryParts(orgId: string, filters: ParsedListActionsFilters) {
  const conditions = ['org_id = $1'];
  const params: unknown[] = [orgId];
  for (const spec of listActionQuerySpecs(filters)) {
    if (spec.active) addQueryCondition(conditions, params, spec.condition, spec.value);
  }

  return { conditions, params, where: `WHERE ${conditions.join(' AND ')}` };
}

function listActionQuerySpecs(filters: ParsedListActionsFilters): QueryConditionSpec[] {
  return [
    { active: !!filters.agent_id, condition: 'agent_id =', value: filters.agent_id },
    { active: !!filters.swarm_id, condition: 'swarm_id =', value: filters.swarm_id },
    { active: !!filters.status, condition: 'status =', value: filters.status },
    { active: !!filters.exclude_status && !filters.status, condition: 'status !=', value: filters.exclude_status },
    { active: !!filters.action_type, condition: 'action_type =', value: filters.action_type },
    { active: filters.parsedRiskMin != null, condition: 'risk_score >=', value: filters.parsedRiskMin },
    { active: !!filters.outcomeFilter, condition: 'outcome_status =', value: filters.outcomeFilter },
    { active: !!filters.containment_status, condition: 'containment_status =', value: filters.containment_status },
    { active: filters.sinceIso != null, condition: 'created_at::timestamptz >=', value: filters.sinceIso },
    { active: filters.expiredAfterIso != null, condition: 'approval_expires_at::timestamptz >', value: filters.expiredAfterIso },
  ];
}

async function listActionsViaQueryMock(
  sql: SqlClient,
  orgId: string,
  filters: ParsedListActionsFilters,
): Promise<{ actions: Row[]; total: number; stats: Row }> {
  const { conditions, params, where } = buildListActionsQueryParts(orgId, filters);
  // guard_decision_id is load-bearing for /approvals, not decoration: it is
  // the key enrichWithPlainLanguage batches its guard-context read on, and
  // without it that read is handed an empty id list and every card silently
  // loses its intel — plain.reversible can never be false, so the
  // irreversibility band never renders and the same action reads differently
  // here than on /decisions/[id]. Keep it in step with the tagged-sql path
  // below; plain-language-review-regressions.test.js asserts both.
  const listCols = 'action_id, agent_id, agent_name, swarm_id, action_type, declared_goal, reasoning, authorization_scope, systems_touched, status, reversible, risk_score, confidence, model, output_summary, error_message, side_effects, artifacts_created, duration_ms, cost_estimate, timestamp_start, timestamp_end, created_at, verified, approved_by, approved_at, outcome_status, outcome_at, outcome_summary, outcome_error, containment_status, containment_ref, containment_resolved_by, containment_resolved_at, guard_decision_id';
  const query = `SELECT ${listCols} FROM action_records ${where} ORDER BY timestamp_start DESC LIMIT $${params.push(filters.parsedLimit)} OFFSET $${params.push(filters.parsedOffset)}`;
  const countQuery = `SELECT COUNT(*) as total FROM action_records ${where}`;
  const statsQuery = `
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'completed') as completed,
        COUNT(*) FILTER (WHERE status = 'failed') as failed,
        COUNT(*) FILTER (WHERE status = 'running') as running,
        COUNT(*) FILTER (WHERE status = 'blocked') as blocked,
        COUNT(*) FILTER (WHERE risk_score >= 70) as high_risk,
        COALESCE(AVG(risk_score), 0) as avg_risk,
        COALESCE(SUM(cost_estimate), 0) as total_cost
      FROM action_records ${where}
    `;

  const [actions, countResult, stats] = await Promise.all([
    sql.query(query, params),
    sql.query(countQuery, params.slice(0, conditions.length)),
    sql.query(statsQuery, params.slice(0, conditions.length)),
  ]);

  return {
    actions,
    total: parseInt((countResult[0]?.total as string) || '0', 10),
    stats: coerceActionStats(stats[0]),
  };
}

function listActionSqlFragments(
  sql: SqlClient,
  filters: ParsedListActionsFilters,
): ListActionSqlFragments {
  return {
    agent: sqlFragment(sql, !!filters.agent_id, () => sql`AND agent_id = ${filters.agent_id}`),
    swarm: sqlFragment(sql, !!filters.swarm_id, () => sql`AND swarm_id = ${filters.swarm_id}`),
    status: sqlFragment(sql, !!filters.status, () => sql`AND status = ${filters.status}`),
    excludeStatus: sqlFragment(sql, !!filters.exclude_status && !filters.status, () => sql`AND status != ${filters.exclude_status}`),
    actionType: sqlFragment(sql, !!filters.action_type, () => sql`AND action_type = ${filters.action_type}`),
    riskMin: sqlFragment(sql, filters.parsedRiskMin != null, () => sql`AND risk_score >= ${filters.parsedRiskMin}`),
    outcome: sqlFragment(sql, !!filters.outcomeFilter, () => sql`AND outcome_status = ${filters.outcomeFilter}`),
    containmentStatus: sqlFragment(sql, !!filters.containment_status, () => sql`AND containment_status = ${filters.containment_status}`),
    since: sqlFragment(sql, filters.sinceIso != null, () => sql`AND created_at::timestamptz >= ${filters.sinceIso}`),
    expiredAfter: sqlFragment(sql, filters.expiredAfterIso != null, () => sql`AND approval_expires_at::timestamptz > ${filters.expiredAfterIso}`),
  };
}

async function listActionsViaTaggedSql(
  sql: SqlClient,
  orgId: string,
  filters: ParsedListActionsFilters,
): Promise<{ actions: Row[]; total: number; stats: Row }> {
  const fragments = listActionSqlFragments(sql, filters);
  const where = listActionsWhere(sql, orgId, fragments);
  const [actions, countResult, stats] = await Promise.all([
    sql`
      SELECT
        action_id, agent_id, agent_name, swarm_id, action_type, declared_goal, reasoning, authorization_scope, systems_touched, status, reversible, risk_score, confidence, model, output_summary, error_message, side_effects, artifacts_created, duration_ms, cost_estimate, timestamp_start, timestamp_end, created_at, verified, approved_by, approved_at, outcome_status, outcome_at, outcome_summary, outcome_error, approval_expires_at, act_content_hash, containment_status, containment_ref, containment_resolved_by, containment_resolved_at, enforcement_mode, executed_despite, guard_decision_id
      FROM action_records
      ${where}
      ORDER BY timestamp_start DESC
      LIMIT ${filters.parsedLimit}
      OFFSET ${filters.parsedOffset}
    `,
    sql`
      SELECT COUNT(*) as total
      FROM action_records
      ${where}
    `,
    sql`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'completed') as completed,
        COUNT(*) FILTER (WHERE status = 'failed') as failed,
        COUNT(*) FILTER (WHERE status = 'running') as running,
        COUNT(*) FILTER (WHERE status = 'blocked') as blocked,
        COUNT(*) FILTER (WHERE risk_score >= 70) as high_risk,
        COALESCE(AVG(risk_score), 0) as avg_risk,
        COALESCE(SUM(cost_estimate), 0) as total_cost
      FROM action_records
      ${where}
    `,
  ]);

  return {
    actions,
    total: parseInt((countResult[0]?.total as string) || '0', 10),
    stats: coerceActionStats(stats[0]),
  };
}

function listActionsWhere(
  sql: SqlClient,
  orgId: string,
  fragments: ListActionSqlFragments,
): ReturnType<SqlClient> {
  return sql`
      WHERE org_id = ${orgId}
        ${fragments.agent}
        ${fragments.swarm}
        ${fragments.status}
        ${fragments.excludeStatus}
        ${fragments.actionType}
        ${fragments.riskMin}
        ${fragments.outcome}
        ${fragments.containmentStatus}
        ${fragments.since}
        ${fragments.expiredAfter}
    `;
}

export async function listActions(
  sql: SqlClient,
  orgId: string,
  filters: ListActionsFilters = {},
): Promise<{ actions: Row[]; total: number; stats: Row }> {
  const parsed = parseListActionsFilters(filters);
  // Test-contract compatibility path for sql mocks that only provide .query() responses.
  if (typeof sql.query === 'function' && Array.isArray(sql.queryCalls)) {
    return listActionsViaQueryMock(sql, orgId, parsed);
  }

  return listActionsViaTaggedSql(sql, orgId, parsed);
}

export async function hasAgentAction(sql: SqlClient, orgId: string, agentId: string): Promise<boolean> {
  const rows = await sql`
    SELECT 1 FROM action_records WHERE org_id = ${orgId} AND agent_id = ${agentId} LIMIT 1
  `;
  return rows.length > 0;
}

/**
 * Returns true if the given action_id is the first action_record ever
 * created for this org — used by the launch-window new-connect alert
 * (Plan 03-02, DOG-04 telemetry). "First" = no OTHER action_record
 * exists for this org besides the one being created.
 */
export async function isFirstActionForOrg(
  sql: SqlClient,
  orgId: string,
  excludingActionId: string,
): Promise<boolean> {
  const rows = await sql`
    SELECT 1 FROM action_records
    WHERE org_id = ${orgId}
      AND action_id != ${excludingActionId}
    LIMIT 1
  `;
  return rows.length === 0;
}

/**
 * Look up an existing action by idempotency key for this org.
 * Returns the row if found, null otherwise. Used by POST /api/actions
 * to short-circuit duplicate create calls.
 */
export async function getActionByIdempotencyKey(
  sql: SqlClient,
  orgId: string,
  idempotencyKey: string | null | undefined,
): Promise<Row | null> {
  if (!idempotencyKey) return null;
  const rows = await sql`
    SELECT * FROM action_records
    WHERE org_id = ${orgId} AND idempotency_key = ${idempotencyKey}
    LIMIT 1
  `;
  return rows[0] || null;
}

/**
 * Narrow variant of getActionByIdempotencyKey for the guard ?record=true hot
 * path, which only ever reads action_id/id from the row. POST /api/actions
 * keeps the full-row variant above because its idempotent-replay response
 * returns the entire row.
 */
export async function getActionIdByIdempotencyKey(
  sql: SqlClient,
  orgId: string,
  idempotencyKey: string | null | undefined,
): Promise<{ action_id: string | null; id: number | null } | null> {
  if (!idempotencyKey) return null;
  const rows = await sql`
    SELECT action_id, id FROM action_records
    WHERE org_id = ${orgId} AND idempotency_key = ${idempotencyKey}
    LIMIT 1
  `;
  return (rows[0] as { action_id: string | null; id: number | null } | undefined) || null;
}
