import type { SqlTag } from '../types/db';
import { baseAgentId } from '../agent-identity-resolve';

type SqlClient = {
  (s: TemplateStringsArray, ...v: unknown[]): Promise<Record<string, unknown>[]>;
  query: (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
};

interface ListAssumptionsFilters {
  validated?: string | null;
  stale?: string | null;
  action_id?: string | null;
  agent_id?: string | null;
  limit?: number | string | null;
  offset?: number | string | null;
}

interface CreateAssumptionData {
  assumption_id: string;
  action_id: string;
  assumption: string;
  basis?: string | null;
  validated?: boolean;
  invalidated?: boolean;
  invalidated_reason?: string | null;
  [k: string]: unknown;
}

interface UpdateAssumptionData {
  validated?: boolean;
  invalidated_reason?: string | null;
  invalidated?: boolean;
  validated_at?: string | null;
  invalidated_at?: string | null;
  [k: string]: unknown;
}

interface UpdateAssumptionOptions {
  gateInvalidated?: boolean;
}

// Shared WHERE builder so the list, count, and drift-summary queries can never
// disagree about which rows are in scope.
function buildAssumptionsWhere(
  orgId: string,
  filters: ListAssumptionsFilters
): { where: string; params: unknown[] } {
  const { validated, stale, action_id, agent_id } = filters;

  let paramIdx = 1;
  const conditions = [`a.org_id = $${paramIdx++}`];
  const params: unknown[] = [orgId];

  if (validated === 'true') {
    conditions.push(`a.validated = 1`);
  } else if (validated === 'false') {
    conditions.push(`a.validated = 0 AND a.invalidated = 0`);
  }
  if (stale === 'true' && validated !== 'true') {
    conditions.push(`a.validated = 0 AND a.invalidated = 0 AND a.created_at < NOW() - INTERVAL '7 days'`);
  }
  if (action_id) {
    conditions.push(`a.action_id = $${paramIdx++}`);
    params.push(action_id);
  }
  if (agent_id) {
    conditions.push(`ar.agent_id = $${paramIdx++}`);
    params.push(agent_id);
  }

  return { where: `WHERE ${conditions.join(' AND ')}`, params };
}

export async function listAssumptions(
  sql: SqlClient,
  orgId: string,
  filters: ListAssumptionsFilters = {}
): Promise<{ assumptions: Record<string, unknown>[]; total: number }> {
  const { limit = 50, offset = 0 } = filters;

  const parsedLimit = Math.min(parseInt(limit as string, 10) || 50, 200);
  const parsedOffset = parseInt(offset as string, 10) || 0;

  const { where, params } = buildAssumptionsWhere(orgId, filters);
  let paramIdx = params.length + 1;

  const query = `
    SELECT a.*, ar.agent_id, ar.agent_name, ar.declared_goal
    FROM assumptions a
    LEFT JOIN action_records ar ON a.action_id = ar.action_id AND ar.org_id = a.org_id
    ${where}
    ORDER BY a.created_at DESC
    LIMIT $${paramIdx++} OFFSET $${paramIdx++}
  `;
  params.push(parsedLimit, parsedOffset);

  // The WHERE clause may reference ar.agent_id (the action_records join), so the
  // count query needs the same LEFT JOIN as the main query — otherwise an
  // agent_id filter raises "missing FROM-clause entry for table ar".
  const countQuery = `SELECT COUNT(*) as total FROM assumptions a
    LEFT JOIN action_records ar ON a.action_id = ar.action_id AND ar.org_id = a.org_id
    ${where}`;
  const countParams = params.slice(0, -2);

  const [assumptions, countResult] = await Promise.all([
    sql.query(query, params),
    sql.query(countQuery, countParams)
  ]);

  return {
    assumptions,
    total: parseInt((countResult[0]?.total as string | undefined) || '0', 10),
  };
}

export interface AssumptionsDriftCounts {
  total: number;
  at_risk: number;
  validated: number;
  invalidated: number;
  unvalidated: number;
}

/**
 * Whole-table drift counts under the same filters as listAssumptions. The
 * route used to derive these from the returned page, which silently understated
 * every tile once the table outgrew the page size (limit caps at 200).
 *
 * at_risk mirrors the route's per-row drift_score >= 50: drift_score =
 * round(daysOld / 30 * 100) >= 50 ⇔ daysOld >= 14.85, hence the fractional
 * interval.
 */
export async function getAssumptionsDriftCounts(
  sql: SqlClient,
  orgId: string,
  filters: ListAssumptionsFilters = {}
): Promise<AssumptionsDriftCounts> {
  const { where, params } = buildAssumptionsWhere(orgId, filters);

  const result = await sql.query(
    `SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE a.validated = 1)::int AS validated,
      COUNT(*) FILTER (WHERE a.invalidated = 1)::int AS invalidated,
      COUNT(*) FILTER (WHERE a.validated = 0 AND a.invalidated = 0)::int AS unvalidated,
      COUNT(*) FILTER (
        WHERE a.validated = 0 AND a.invalidated = 0
          AND a.created_at <= NOW() - INTERVAL '14.85 days'
      )::int AS at_risk
    FROM assumptions a
    LEFT JOIN action_records ar ON a.action_id = ar.action_id AND ar.org_id = a.org_id
    ${where}`,
    params
  );
  const row = result[0] || {};
  return {
    total: parseInt((row.total as string | undefined) || '0', 10),
    at_risk: parseInt((row.at_risk as string | undefined) || '0', 10),
    validated: parseInt((row.validated as string | undefined) || '0', 10),
    invalidated: parseInt((row.invalidated as string | undefined) || '0', 10),
    unvalidated: parseInt((row.unvalidated as string | undefined) || '0', 10),
  };
}

export async function getAssumption(
  sql: SqlTag,
  orgId: string,
  assumptionId: string
): Promise<Record<string, unknown> | null> {
  // ar.org_id = a.org_id mirrors listAssumptions — without it an action_id
  // collision across orgs could leak another org's agent fields.
  const assumptions = await sql`
    SELECT a.*, ar.agent_id, ar.agent_name, ar.declared_goal, ar.action_type, ar.status as action_status
    FROM assumptions a
    LEFT JOIN action_records ar ON a.action_id = ar.action_id AND ar.org_id = a.org_id
    WHERE a.assumption_id = ${assumptionId} AND a.org_id = ${orgId}
  `;
  return assumptions[0] || null;
}

export interface RecentInvalidatedAssumption {
  assumption_id: string;
  assumption: string;
  invalidated_reason: string | null;
  invalidated_at: string | null;
  action_id: string | null;
}

/**
 * Assumptions belonging to an agent FAMILY that an operator invalidated inside
 * the last `windowMinutes` — the lookup behind the `assumption_hold` guard
 * policy (app/lib/guard/policy.ts).
 *
 * `assumptions` has no agent_id column, so the family match runs on the parent
 * action's `action_records.agent_id`, joined exactly the way getAssumption and
 * listAssumptions join it (`ar.org_id = a.org_id`, so an action_id collision
 * across orgs cannot leak another org's rows).
 *
 * Family match mirrors getAssumptionAlerts in app/lib/assumption-notify.ts: the
 * id itself, its base id, and any composed child (`<agentId>:%`). agent_id is
 * client-controlled, so LIKE metacharacters are escaped — a '%' or '_' in an id
 * must not widen the match onto another agent's assumptions.
 */
export async function listRecentInvalidatedForAgent(
  sql: SqlTag,
  orgId: string,
  agentId: string,
  windowMinutes: number
): Promise<RecentInvalidatedAssumption[]> {
  const ids = [agentId];
  const base = baseAgentId(agentId);
  if (base && base !== agentId) ids.push(base);
  const likePrefix = agentId.replace(/([\\%_])/g, '\\$1') + ':%';
  const minutes = Math.max(1, Math.min(10080, Math.floor(Number(windowMinutes) || 60)));

  const rows = await sql`
    SELECT a.assumption_id, a.assumption, a.invalidated_reason, a.invalidated_at, a.action_id
    FROM assumptions a
    JOIN action_records ar ON a.action_id = ar.action_id AND ar.org_id = a.org_id
    WHERE a.org_id = ${orgId}
      AND a.invalidated = 1
      AND a.invalidated_at > NOW() - (INTERVAL '1 minute' * ${minutes})
      AND (ar.agent_id = ANY(${ids}) OR ar.agent_id LIKE ${likePrefix})
    ORDER BY a.invalidated_at DESC
    LIMIT 3
  `;

  return rows.map((r) => ({
    assumption_id: String(r.assumption_id ?? ''),
    assumption: String(r.assumption ?? ''),
    invalidated_reason: r.invalidated_reason == null ? null : String(r.invalidated_reason),
    invalidated_at: r.invalidated_at == null ? null : String(r.invalidated_at),
    action_id: r.action_id == null ? null : String(r.action_id),
  }));
}

export async function createAssumption(
  sql: SqlTag,
  orgId: string,
  data: CreateAssumptionData
): Promise<Record<string, unknown> | null> {
  const result = await sql`
    INSERT INTO assumptions (
      org_id, assumption_id, action_id, assumption, basis,
      validated, invalidated, invalidated_reason
    ) VALUES (
      ${orgId},
      ${data.assumption_id},
      ${data.action_id},
      ${data.assumption},
      ${data.basis || null},
      ${data.validated ? 1 : 0},
      ${data.invalidated ? 1 : 0},
      ${data.invalidated_reason || null}
    )
    RETURNING *
  `;
  return result[0] ?? null;
}

export async function updateAssumption(
  sql: SqlTag,
  orgId: string,
  assumptionId: string,
  data: UpdateAssumptionData,
  options: UpdateAssumptionOptions = {}
): Promise<Record<string, unknown> | null> {
  const { validated, invalidated_reason, invalidated, validated_at, invalidated_at } = data;
  // `gateInvalidated` (optional) — when true, the UPDATE only applies if
  // the row's invalidated column is currently 0. Two concurrent invalidate
  // PATCH requests both see invalidated=0 at the route boundary, but only
  // one passes this compare-and-set; the loser gets null back so the
  // caller can return 409 instead of silently overwriting the reason.
  const { gateInvalidated = false } = options;
  const gate = gateInvalidated ? 1 : 0;

  const result = await sql`
    UPDATE assumptions
    SET
      validated = COALESCE(${validated !== undefined ? (validated ? 1 : 0) : null}, validated),
      invalidated = COALESCE(${invalidated !== undefined ? (invalidated ? 1 : 0) : null}, invalidated),
      invalidated_reason = COALESCE(${invalidated_reason || null}, invalidated_reason),
      validated_at = COALESCE(${validated_at || null}, validated_at),
      invalidated_at = COALESCE(${invalidated_at || null}, invalidated_at)
    WHERE assumption_id = ${assumptionId} AND org_id = ${orgId}
      AND (${gate} = 0 OR invalidated = 0)
    RETURNING *
  `;
  return result[0] || null;
}
