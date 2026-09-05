import { sqlFragment, type Row, type SqlClient } from './actions.repository.shared';

interface ActionStatsResult {
  current: Row;
  previousTotal: unknown;
}

function defaultActionStats(): Row {
  return { total: 0, completed: 0, failed: 0, blocked: 0, cancelled: 0, approval: 0 };
}

function actionStatsResult(currentResults: Row[], previousResults: Row[]): ActionStatsResult {
  return {
    current: currentResults[0] || defaultActionStats(),
    previousTotal: previousResults[0]?.total || 0
  };
}

async function getActionStatsViaQueryMock(
  sql: SqlClient,
  orgId: string,
  agentId: string | null,
): Promise<ActionStatsResult> {
  const agentFilter = agentId ? ' AND agent_id = $2' : '';
  const params = agentId ? [orgId, agentId] : [orgId];
  const currentQuery = `
      SELECT
        COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE status='completed')::int as completed,
        COUNT(*) FILTER (WHERE status='failed')::int as failed,
        COUNT(*) FILTER (WHERE status='blocked')::int as blocked,
        COUNT(*) FILTER (WHERE status='cancelled')::int as cancelled,
        COUNT(*) FILTER (WHERE status='pending_approval')::int as approval
      FROM action_records
      WHERE org_id = $1 AND created_at > NOW() - INTERVAL '24 hours'${agentFilter}
    `;
  const previousQuery = `
      SELECT COUNT(*)::int as total
      FROM action_records
      WHERE org_id = $1 AND created_at <= NOW() - INTERVAL '24 hours' AND created_at > NOW() - INTERVAL '48 hours'${agentFilter}
    `;

  const [currentResults, previousResults] = await Promise.all([
    sql.query(currentQuery, params),
    sql.query(previousQuery, params)
  ]);

  return actionStatsResult(currentResults, previousResults);
}

async function getActionStatsViaTaggedSql(
  sql: SqlClient,
  orgId: string,
  agentId: string | null,
): Promise<ActionStatsResult> {
  const agentFilter = sqlFragment(sql, !!agentId, () => sql`AND agent_id = ${agentId}`);
  const [currentResults, previousResults] = await Promise.all([
    sql`
          SELECT
            COUNT(*)::int as total,
            COUNT(*) FILTER (WHERE status='completed')::int as completed,
            COUNT(*) FILTER (WHERE status='failed')::int as failed,
            COUNT(*) FILTER (WHERE status='blocked')::int as blocked,
            COUNT(*) FILTER (WHERE status='cancelled')::int as cancelled,
            COUNT(*) FILTER (WHERE status='pending_approval')::int as approval
          FROM action_records
          WHERE org_id = ${orgId}
            ${agentFilter}
            AND created_at > NOW() - INTERVAL '24 hours'
        `,
    sql`
          SELECT COUNT(*)::int as total
          FROM action_records
          WHERE org_id = ${orgId}
            ${agentFilter}
            AND created_at <= NOW() - INTERVAL '24 hours'
            AND created_at > NOW() - INTERVAL '48 hours'
        `
  ]);
  return actionStatsResult(currentResults, previousResults);
}

/**
 * Fetch decision throughput statistics for the last 24h and comparison window.
 */
export async function getActionStats(
  sql: SqlClient,
  orgId: string,
  agentId: string | null = null,
): Promise<ActionStatsResult> {
  // Test-contract compatibility path for sql mocks
  if (typeof sql.query === 'function' && Array.isArray(sql.queryCalls)) {
    return getActionStatsViaQueryMock(sql, orgId, agentId);
  }

  return getActionStatsViaTaggedSql(sql, orgId, agentId);
}

/**
 * Predicted vs actual: the agent's stated confidence against what actually
 * completed, per agent, over a rolling window.
 *
 * Two queries, one pass each over the same window:
 *  - `buckets` scores only rows that stated a confidence. `confidence` defaults
 *    to 50 at the column level and hooks never send one, so a row at exactly 50
 *    is a row nobody predicted; scoring it would invent a prediction. Excluded
 *    here, counted below.
 *  - `coverage` is the honest denominator — every closed action, and how many of
 *    them carried a stated confidence. A verdict computed from four scored rows
 *    out of a hundred thousand closed ones has to say so.
 *
 * Terminal outcomes only (`completed | partial | failed`): a `pending` row has no
 * actual to compare the prediction against yet.
 *
 * Tagged-template only — no `.query()` mock path. Callers hold the shaping in
 * app/lib/confidence-calibration.ts so the arithmetic stays testable without a DB.
 */
export async function getConfidenceCalibration(
  sql: SqlClient,
  orgId: string,
  agentId: string | null = null,
  windowDays = 30,
): Promise<{ buckets: Row[]; coverage: Row[] }> {
  const agentFilter = sqlFragment(sql, !!agentId, () => sql`AND agent_id = ${agentId}`);
  const [buckets, coverage] = await Promise.all([
    sql`
      SELECT
        agent_id,
        MAX(agent_name) AS agent_name,
        CASE
          WHEN confidence < 50 THEN 'lt50'
          WHEN confidence < 70 THEN 'b50_69'
          WHEN confidence < 90 THEN 'b70_89'
          ELSE 'b90_plus'
        END AS bucket,
        COUNT(*)::int AS n,
        COUNT(*) FILTER (WHERE outcome_status = 'completed')::int AS completed,
        AVG(confidence)::float AS avg_confidence
      FROM action_records
      WHERE org_id = ${orgId}
        ${agentFilter}
        AND created_at > NOW() - make_interval(days => ${windowDays}::int)
        AND outcome_status IN ('completed', 'partial', 'failed')
        AND confidence <> 50
      GROUP BY agent_id, bucket
    `,
    sql`
      SELECT
        agent_id,
        MAX(agent_name) AS agent_name,
        COUNT(*)::int AS closed,
        COUNT(*) FILTER (WHERE confidence <> 50)::int AS stated
      FROM action_records
      WHERE org_id = ${orgId}
        ${agentFilter}
        AND created_at > NOW() - make_interval(days => ${windowDays}::int)
        AND outcome_status IN ('completed', 'partial', 'failed')
      GROUP BY agent_id
    `
  ]);
  return { buckets, coverage };
}
