import type { SqlTag } from '../types/db';

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

export async function listAssumptions(
  sql: SqlClient,
  orgId: string,
  filters: ListAssumptionsFilters = {}
): Promise<{ assumptions: Record<string, unknown>[]; total: number }> {
  const {
    validated,
    stale,
    action_id,
    agent_id,
    limit = 50,
    offset = 0,
  } = filters;

  const parsedLimit = Math.min(parseInt(limit as string, 10) || 50, 200);
  const parsedOffset = parseInt(offset as string, 10) || 0;

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

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

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

export async function getAssumption(
  sql: SqlTag,
  orgId: string,
  assumptionId: string
): Promise<Record<string, unknown> | null> {
  const assumptions = await sql`
    SELECT a.*, ar.agent_id, ar.agent_name, ar.declared_goal, ar.action_type, ar.status as action_status
    FROM assumptions a
    LEFT JOIN action_records ar ON a.action_id = ar.action_id
    WHERE a.assumption_id = ${assumptionId} AND a.org_id = ${orgId}
  `;
  return assumptions[0] || null;
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

export async function getAssumptionsSummary(
  sql: SqlClient,
  orgId: string,
  agentId: string
): Promise<{ total: number; validated: number; invalidated: number; unverified: number }> {
  const result = await sql.query(
    `SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE a.validated = 1)::int AS validated,
      COUNT(*) FILTER (WHERE a.invalidated = 1)::int AS invalidated,
      COUNT(*) FILTER (WHERE a.validated = 0 AND a.invalidated = 0)::int AS unverified
    FROM assumptions a
    JOIN action_records ar ON a.action_id = ar.action_id AND ar.org_id = a.org_id
    WHERE a.org_id = $1 AND ar.agent_id = $2`,
    [orgId, agentId]
  );
  const row = result[0] || {};
  return {
    total: parseInt((row.total as string | undefined) || '0', 10),
    validated: parseInt((row.validated as string | undefined) || '0', 10),
    invalidated: parseInt((row.invalidated as string | undefined) || '0', 10),
    unverified: parseInt((row.unverified as string | undefined) || '0', 10),
  };
}
