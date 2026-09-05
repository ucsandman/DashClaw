import { SYNTHETIC_AGENT_LIKE_PATTERNS, SYNTHETIC_ACTION_TYPE_LIKE_PATTERNS } from '../synthetic-agents';
import type { Row, SqlClient } from './actions.repository.shared';

/**
 * Fetch historical actions for policy simulation.
 */
/**
 * A Neon HTTP driver batches its three delete statements into one atomic
 * `.transaction()` call so a mid-sequence failure can't tear the audit trail
 * (children gone, action_records rows still present and visible to a
 * concurrent reader). The local/self-host `postgres`-package driver
 * (app/lib/db.ts) exposes no such primitive on the `SqlClient` surface this
 * repository is written against, so it's detected at call time and, when
 * absent, falls back to the original sequential order — which is already
 * children-first/parent-last, so a partial failure there leaves a
 * child-less parent (recoverable by re-running the same filter/id list)
 * rather than an orphaned child.
 */
type TxnQuery = {
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<Row[]>;
  query: (text: string, params?: unknown[]) => Promise<Row[]>;
};
type TransactableSql = SqlClient & {
  transaction?: (fn: (txn: TxnQuery) => Array<Promise<Row[]>>) => Promise<Row[][]>;
};

/**
 * Delete actions by a list of specific action IDs, including related loops and assumptions.
 */
export async function deleteActionsByIds(sql: SqlClient, orgId: string, idList: string[]): Promise<Row[]> {
  const txSql = sql as TransactableSql;
  if (typeof txSql.transaction === 'function') {
    const results = await txSql.transaction((txn) => [
      txn`DELETE FROM open_loops WHERE action_id = ANY(${idList}) AND org_id = ${orgId}`,
      txn`DELETE FROM assumptions WHERE action_id = ANY(${idList}) AND org_id = ${orgId}`,
      txn`DELETE FROM action_records WHERE action_id = ANY(${idList}) AND org_id = ${orgId} RETURNING action_id`,
    ]);
    return results[2] ?? [];
  }
  await sql`DELETE FROM open_loops WHERE action_id = ANY(${idList}) AND org_id = ${orgId}`;
  await sql`DELETE FROM assumptions WHERE action_id = ANY(${idList}) AND org_id = ${orgId}`;
  return sql`DELETE FROM action_records WHERE action_id = ANY(${idList}) AND org_id = ${orgId} RETURNING action_id`;
}

type ActionDeleteFilter = {
  before?: string | null; agentId?: string | null; status?: string | null;
  agentIds?: string[] | null; synthetic?: boolean;
};

/**
 * One WHERE builder shared by the filtered-delete read (audit target set) and
 * the delete itself, so the two can never diverge on filter semantics.
 */
function buildActionFilterWhere(orgId: string, { before, agentId, status, agentIds, synthetic }: ActionDeleteFilter): { where: string; params: unknown[] } {
  const conditions = ['org_id = $1'];
  const params: unknown[] = [orgId];
  let paramIdx = 2;
  if (before) {
    conditions.push(`timestamp_start::timestamptz < $${paramIdx++}::timestamptz`);
    params.push(before);
  }
  if (agentId) {
    conditions.push(`agent_id = $${paramIdx++}`);
    params.push(agentId);
  }
  if (status) {
    conditions.push(`status = $${paramIdx++}`);
    params.push(status);
  }
  if (agentIds && agentIds.length > 0) {
    conditions.push(`agent_id = ANY($${paramIdx++})`);
    params.push(agentIds);
  }
  if (synthetic) {
    // Test traffic: agent-name families OR synthetic action-type families
    // (some liveproof.* rows ride real agent ids).
    conditions.push(`(agent_id LIKE ANY($${paramIdx}) OR action_type LIKE ANY($${paramIdx + 1}))`);
    params.push(SYNTHETIC_AGENT_LIKE_PATTERNS, SYNTHETIC_ACTION_TYPE_LIKE_PATTERNS);
    paramIdx += 2;
  }
  return { where: `WHERE ${conditions.join(' AND ')}`, params };
}

/**
 * Resolve the action_ids a filtered bulk delete would remove, so the erasure
 * audit row can be written (and awaited) BEFORE any row is deleted. Mirrors
 * the filter semantics of DELETE /api/actions exactly.
 */
export async function listActionIdsByFilter(
  sql: SqlClient,
  orgId: string,
  filter: ActionDeleteFilter,
  limit?: number,
): Promise<string[]> {
  const { where, params } = buildActionFilterWhere(orgId, filter);
  const limitClause = Number.isInteger(limit) && (limit as number) > 0 ? ` LIMIT ${limit}` : '';
  const rows = await sql.query(
    `SELECT action_id FROM action_records ${where}${limitClause}`,
    params
  );
  return rows.map((r: Row) => String(r.action_id));
}

/**
 * Filtered bulk delete mirroring DELETE /api/actions semantics: related
 * open_loops and assumptions rows go first, then the action rows themselves.
 * Uses the same WHERE builder as listActionIdsByFilter, so the write-ahead
 * audit's target set and the deletion always agree on what the filter means.
 */
export async function deleteActionsByFilter(sql: SqlClient, orgId: string, filter: ActionDeleteFilter): Promise<Row[]> {
  const { where, params } = buildActionFilterWhere(orgId, filter);
  const txSql = sql as TransactableSql;
  if (typeof txSql.transaction === 'function') {
    const results = await txSql.transaction((txn) => [
      txn.query(`DELETE FROM open_loops WHERE org_id = $1 AND action_id IN (SELECT action_id FROM action_records ${where})`, params),
      txn.query(`DELETE FROM assumptions WHERE org_id = $1 AND action_id IN (SELECT action_id FROM action_records ${where})`, params),
      txn.query(`DELETE FROM action_records ${where} RETURNING action_id`, params),
    ]);
    return results[2] ?? [];
  }
  await sql.query(
    `DELETE FROM open_loops WHERE org_id = $1 AND action_id IN (SELECT action_id FROM action_records ${where})`,
    params
  );
  await sql.query(
    `DELETE FROM assumptions WHERE org_id = $1 AND action_id IN (SELECT action_id FROM action_records ${where})`,
    params
  );
  return sql.query(
    `DELETE FROM action_records ${where} RETURNING action_id`,
    params
  );
}

/**
 * Fetch historical actions for policy simulation.
 */
export async function listActionsForSimulation(
  sql: SqlClient,
  orgId: string,
  days: number | string = 7,
  limit: number | string = 200,
): Promise<Row[]> {
  return sql`
    SELECT action_id, agent_id, agent_name, action_type, declared_goal, risk_score,
           systems_touched, reversible, timestamp_start, status
    FROM action_records
    WHERE org_id = ${orgId}
      AND timestamp_start::timestamptz > NOW() - INTERVAL '1 day' * ${parseInt(days as string, 10)}
    ORDER BY timestamp_start DESC
    LIMIT ${parseInt(limit as string, 10)}
  `;
}
