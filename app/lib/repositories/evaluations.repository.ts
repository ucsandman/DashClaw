import type { SqlTag } from '../types/db';

type Row = Record<string, unknown>;

interface ListEvalScoresFilters {
  actionId?: string;
  scorerName?: string;
  evaluatedBy?: string;
  minScore?: number | string;
  maxScore?: number | string;
  agentId?: string;
  limit?: number | string;
  offset?: number | string;
}

export async function listEvalScores(
  sql: SqlTag,
  orgId: string,
  filters: ListEvalScoresFilters = {},
): Promise<{ scores: Row[]; total: number }> {
  const {
    actionId,
    scorerName,
    evaluatedBy,
    minScore,
    maxScore,
    agentId,
    limit = 50,
    offset = 0,
  } = filters;

  const parsedMinScore = minScore != null ? parseFloat(minScore as string) : null;
  const parsedMaxScore = maxScore != null ? parseFloat(maxScore as string) : null;
  const parsedLimit = Math.min(parseInt(limit as string, 10) || 50, 200);
  const parsedOffset = parseInt(offset as string, 10) || 0;

  const [scores, countResult] = await Promise.all([
    sql`
      SELECT es.*
      FROM eval_scores es
      ${agentId ? sql`LEFT JOIN action_records ar ON es.action_id = ar.action_id AND ar.org_id = es.org_id` : sql``}
      WHERE es.org_id = ${orgId}
        ${actionId ? sql`AND es.action_id = ${actionId}` : sql``}
        ${scorerName ? sql`AND es.scorer_name = ${scorerName}` : sql``}
        ${evaluatedBy ? sql`AND es.evaluated_by = ${evaluatedBy}` : sql``}
        ${parsedMinScore != null ? sql`AND es.score >= ${parsedMinScore}` : sql``}
        ${parsedMaxScore != null ? sql`AND es.score <= ${parsedMaxScore}` : sql``}
        ${agentId ? sql`AND ar.agent_id = ${agentId}` : sql``}
      ORDER BY es.created_at DESC
      LIMIT ${parsedLimit}
      OFFSET ${parsedOffset}
    `,
    sql`
      SELECT COUNT(*) as total
      FROM eval_scores es
      ${agentId ? sql`LEFT JOIN action_records ar ON es.action_id = ar.action_id AND ar.org_id = es.org_id` : sql``}
      WHERE es.org_id = ${orgId}
        ${actionId ? sql`AND es.action_id = ${actionId}` : sql``}
        ${scorerName ? sql`AND es.scorer_name = ${scorerName}` : sql``}
        ${evaluatedBy ? sql`AND es.evaluated_by = ${evaluatedBy}` : sql``}
        ${parsedMinScore != null ? sql`AND es.score >= ${parsedMinScore}` : sql``}
        ${parsedMaxScore != null ? sql`AND es.score <= ${parsedMaxScore}` : sql``}
        ${agentId ? sql`AND ar.agent_id = ${agentId}` : sql``}
    `,
  ]);

  return {
    scores: scores || [],
    total: parseInt((countResult?.[0]?.total as string) || '0', 10),
  };
}

interface CreateEvalScoreInput {
  id: string;
  action_id: string;
  scorer_name: string;
  score: number;
  label?: string | null;
  reasoning?: string | null;
  evaluated_by?: string | null;
  metadata?: unknown;
  created_at: string;
  [field: string]: unknown;
}

export async function createEvalScore(
  sql: SqlTag,
  orgId: string,
  data: CreateEvalScoreInput,
): Promise<{ id: string; action_id: string; scorer_name: string; score: number }> {
  const { id, action_id, scorer_name, score, label, reasoning, evaluated_by, metadata, created_at } = data;

  await sql`
    INSERT INTO eval_scores (id, org_id, action_id, scorer_name, score, label, reasoning, evaluated_by, metadata, created_at)
    VALUES (${id}, ${orgId}, ${action_id}, ${scorer_name}, ${score}, ${label || null}, ${reasoning || null}, ${evaluated_by || 'human'}, ${metadata ? JSON.stringify(metadata) : null}, ${created_at})
  `;

  return { id, action_id, scorer_name, score };
}

interface ListEvalRunsFilters {
  status?: string;
  limit?: number | string;
  offset?: number | string;
}

export async function listEvalRuns(
  sql: SqlTag,
  orgId: string,
  filters: ListEvalRunsFilters = {},
): Promise<Row[]> {
  const { status, limit = 50, offset = 0 } = filters;

  if (status) {
    return sql`
      SELECT er.*, es.name as scorer_name, es.scorer_type
      FROM eval_runs er
      LEFT JOIN eval_scorers es ON er.scorer_id = es.id
      WHERE er.org_id = ${orgId} AND er.status = ${status}
      ORDER BY er.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
  }

  return sql`
    SELECT er.*, es.name as scorer_name, es.scorer_type
    FROM eval_runs er
    LEFT JOIN eval_scorers es ON er.scorer_id = es.id
    WHERE er.org_id = ${orgId}
    ORDER BY er.created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `;
}

interface CreateEvalRunInput {
  id: string;
  name: string;
  scorer_id: string;
  status: string;
  filter_criteria?: unknown;
  created_by?: string | null;
  created_at: string;
  [field: string]: unknown;
}

export async function createEvalRun(
  sql: SqlTag,
  orgId: string,
  data: CreateEvalRunInput,
): Promise<{ id: string; name: string }> {
  const { id, name, scorer_id, status, filter_criteria, created_by, created_at } = data;

  await sql`
    INSERT INTO eval_runs (id, org_id, name, scorer_id, status, filter_criteria, created_by, created_at)
    VALUES (${id}, ${orgId}, ${name}, ${scorer_id}, ${status}, ${filter_criteria ? JSON.stringify(filter_criteria) : null}, ${created_by}, ${created_at})
  `;

  return { id, name };
}

export async function getEvalRun(
  sql: SqlTag,
  orgId: string,
  runId: string,
): Promise<{ run: Row; distribution: Row[] } | null> {
  const [run] = await sql`
    SELECT er.*, es.name as scorer_name, es.scorer_type
    FROM eval_runs er
    LEFT JOIN eval_scorers es ON er.scorer_id = es.id
    WHERE er.id = ${runId} AND er.org_id = ${orgId}
  `;

  if (!run) return null;

  // Scope the distribution to THIS run only. The prior query filtered on
  // (scorer_id + created_at >= run.started_at) which aggregated across
  // every run that shared the same scorer — including runs that hadn't
  // started yet (fallback to created_at). run_id is now written on every
  // eval_scores row by executeEvalRun, so we can filter exactly.
  const distribution = await sql`
    SELECT
      CASE
        WHEN score >= 0.8 THEN 'excellent'
        WHEN score >= 0.5 THEN 'acceptable'
        ELSE 'poor'
      END as bucket,
      COUNT(*) as count,
      AVG(score) as avg_score
    FROM eval_scores
    WHERE run_id = ${runId}
      AND org_id = ${orgId}
    GROUP BY bucket
  `;

  return { run, distribution };
}

export async function updateEvalRunStatus(
  sql: SqlTag,
  orgId: string,
  runId: string,
  status: string,
): Promise<void> {
  await sql`
    UPDATE eval_runs SET status = ${status}, completed_at = ${new Date().toISOString()}
    WHERE id = ${runId} AND org_id = ${orgId}
  `;
}

export async function getEvalScorer(
  sql: SqlTag,
  orgId: string,
  scorerId: string,
): Promise<Row | undefined> {
  const [scorer] = await sql`
    SELECT * FROM eval_scorers WHERE id = ${scorerId} AND org_id = ${orgId}
  `;
  return scorer;
}

export async function listEvalScorers(sql: SqlTag, orgId: string): Promise<Row[]> {
  return sql`
    SELECT s.*,
      (SELECT COUNT(*) FROM eval_scores WHERE scorer_id = s.id AND org_id = s.org_id) AS total_scores,
      (SELECT AVG(score) FROM eval_scores WHERE scorer_id = s.id AND org_id = s.org_id) AS avg_score
    FROM eval_scorers s
    WHERE s.org_id = ${orgId}
    ORDER BY s.created_at DESC
  `;
}

interface CreateEvalScorerInput {
  id: string;
  name: string;
  scorer_type: string;
  config?: unknown;
  description?: string | null;
  created_at: string;
  [field: string]: unknown;
}

export async function createEvalScorer(
  sql: SqlTag,
  orgId: string,
  data: CreateEvalScorerInput,
): Promise<{ id: string; name: string; scorer_type: string }> {
  const { id, name, scorer_type, config, description, created_at } = data;
  const configStr = config ? (typeof config === 'string' ? config : JSON.stringify(config)) : null;

  await sql`
    INSERT INTO eval_scorers (id, org_id, name, scorer_type, config, description, created_at, updated_at)
    VALUES (${id}, ${orgId}, ${name}, ${scorer_type}, ${configStr}, ${description || null}, ${created_at}, ${created_at})
  `;

  return { id, name, scorer_type };
}

interface UpdateEvalScorerInput {
  name?: string | null;
  scorer_type?: string | null;
  config?: unknown;
  description?: string | null;
  [field: string]: unknown;
}

export async function updateEvalScorer(
  sql: SqlTag,
  orgId: string,
  scorerId: string,
  updates: UpdateEvalScorerInput,
): Promise<Row | undefined> {
  if (Object.keys(updates).length === 0) return;

  const configValue =
    'config' in updates && updates.config !== undefined
      ? typeof updates.config === 'string'
        ? updates.config
        : JSON.stringify(updates.config)
      : null;

  const [updated] = await sql`
    UPDATE eval_scorers
    SET
      name        = COALESCE(${updates.name ?? null}, name),
      scorer_type = COALESCE(${updates.scorer_type ?? null}, scorer_type),
      config      = COALESCE(${configValue}, config),
      description = COALESCE(${updates.description ?? null}, description),
      updated_at  = ${new Date().toISOString()}
    WHERE org_id = ${orgId} AND id = ${scorerId}
    RETURNING *
  `;

  return updated;
}

export async function deleteEvalScorer(sql: SqlTag, orgId: string, scorerId: string): Promise<void> {
  await sql`DELETE FROM eval_scorers WHERE id = ${scorerId} AND org_id = ${orgId}`;
}

interface GetEvalStatsFilters {
  cutoff?: string;
  agentId?: string | null;
  scorerName?: string | null;
}

export async function getEvalStats(
  sql: SqlTag,
  orgId: string,
  filters: GetEvalStatsFilters = {},
): Promise<{ overall: Row; by_scorer: Row[]; trends: Row[]; distribution: Row[] }> {
  const { cutoff, agentId, scorerName } = filters;
  const now = new Date().toISOString();

  // Notes on the SQL shape (all four aggregates share it):
  // - eval_scores is aliased `es` and agentId joins action_records exactly like
  //   listEvalScores, so ?agent_id filters by the action's agent.
  // - scorerName filters es.scorer_name; both filters were previously ignored.
  // - created_at is TEXT; compare as ::timestamptz (temporal, not lexicographic)
  //   and bucket the day with TO_CHAR(... AT TIME ZONE 'UTC') so it is robust to
  //   format drift and matches the prior LEFT(created_at,10) UTC-date output.
  const [byScorer, trends, distribution, [overall]] = await Promise.all([
    sql`
      SELECT es.scorer_name, AVG(es.score) as avg_score, COUNT(*) as total_scores
      FROM eval_scores es
      ${agentId ? sql`LEFT JOIN action_records ar ON es.action_id = ar.action_id AND ar.org_id = es.org_id` : sql``}
      WHERE es.org_id = ${orgId} AND es.created_at::timestamptz >= ${cutoff}
        ${scorerName ? sql`AND es.scorer_name = ${scorerName}` : sql``}
        ${agentId ? sql`AND ar.agent_id = ${agentId}` : sql``}
      GROUP BY es.scorer_name
      ORDER BY avg_score DESC
    `,
    sql`
      SELECT
        TO_CHAR(es.created_at::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD') as date,
        AVG(es.score) as avg_score,
        COUNT(*) as count
      FROM eval_scores es
      ${agentId ? sql`LEFT JOIN action_records ar ON es.action_id = ar.action_id AND ar.org_id = es.org_id` : sql``}
      WHERE es.org_id = ${orgId} AND es.created_at::timestamptz >= ${cutoff}
        ${scorerName ? sql`AND es.scorer_name = ${scorerName}` : sql``}
        ${agentId ? sql`AND ar.agent_id = ${agentId}` : sql``}
      GROUP BY TO_CHAR(es.created_at::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD')
      ORDER BY date ASC
    `,
    sql`
      SELECT
        CASE
          WHEN es.score >= 0.8 THEN 'excellent'
          WHEN es.score >= 0.5 THEN 'acceptable'
          ELSE 'poor'
        END as bucket,
        COUNT(*) as count
      FROM eval_scores es
      ${agentId ? sql`LEFT JOIN action_records ar ON es.action_id = ar.action_id AND ar.org_id = es.org_id` : sql``}
      WHERE es.org_id = ${orgId} AND es.created_at::timestamptz >= ${cutoff}
        ${scorerName ? sql`AND es.scorer_name = ${scorerName}` : sql``}
        ${agentId ? sql`AND ar.agent_id = ${agentId}` : sql``}
      GROUP BY bucket
    `,
    sql`
      SELECT
        COUNT(*) as total_scores,
        AVG(es.score) as avg_score,
        COUNT(DISTINCT es.scorer_name) as unique_scorers,
        COUNT(CASE WHEN TO_CHAR(es.created_at::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD') = LEFT(${now}, 10) THEN 1 END) as today_count
      FROM eval_scores es
      ${agentId ? sql`LEFT JOIN action_records ar ON es.action_id = ar.action_id AND ar.org_id = es.org_id` : sql``}
      WHERE es.org_id = ${orgId} AND es.created_at::timestamptz >= ${cutoff}
        ${scorerName ? sql`AND es.scorer_name = ${scorerName}` : sql``}
        ${agentId ? sql`AND ar.agent_id = ${agentId}` : sql``}
    `,
  ]);

  return {
    overall: overall || {},
    by_scorer: byScorer,
    trends,
    distribution,
  };
}
