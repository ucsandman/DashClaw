export async function listEvalScores(sql, orgId, filters = {}) {
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

  let conditions = [`es.org_id = $1`];
  const params = [orgId];

  if (actionId) {
    conditions.push(`es.action_id = $${params.push(actionId)}`);
  }
  if (scorerName) {
    conditions.push(`es.scorer_name = $${params.push(scorerName)}`);
  }
  if (evaluatedBy) {
    conditions.push(`es.evaluated_by = $${params.push(evaluatedBy)}`);
  }
  if (minScore != null) {
    conditions.push(`es.score >= $${params.push(parseFloat(minScore))}`);
  }
  if (maxScore != null) {
    conditions.push(`es.score <= $${params.push(parseFloat(maxScore))}`);
  }

  let joinClause = '';
  if (agentId) {
    joinClause = 'LEFT JOIN action_records ar ON es.action_id = ar.action_id';
    conditions.push(`ar.agent_id = $${params.push(agentId)}`);
  }

  const where = `WHERE ${conditions.join(' AND ')}`;
  const query = `
    SELECT es.* FROM eval_scores es ${joinClause}
    ${where}
    ORDER BY es.created_at DESC
    LIMIT $${params.push(Math.min(limit, 200))} OFFSET $${params.push(offset)}
  `;

  const countQuery = `SELECT COUNT(*) as total FROM eval_scores es ${joinClause} ${where}`;

  const [scores, countResult] = await Promise.all([
    sql.query(query, params.slice(0, -2)), // slice off limit/offset for count
    sql.query(countQuery, params.slice(0, -2)),
  ]);

  return {
    scores: scores || [],
    total: parseInt(countResult?.[0]?.total || '0', 10),
  };
}

export async function createEvalScore(sql, orgId, data) {
  const { id, action_id, scorer_name, score, label, reasoning, evaluated_by, metadata, created_at } = data;
  
  await sql`
    INSERT INTO eval_scores (id, org_id, action_id, scorer_name, score, label, reasoning, evaluated_by, metadata, created_at)
    VALUES (${id}, ${orgId}, ${action_id}, ${scorer_name}, ${score}, ${label || null}, ${reasoning || null}, ${evaluated_by || 'human'}, ${metadata ? JSON.stringify(metadata) : null}, ${created_at})
  `;
  
  return { id, action_id, scorer_name, score };
}

export async function listEvalRuns(sql, orgId, filters = {}) {
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

export async function createEvalRun(sql, orgId, data) {
  const { id, name, scorer_id, status, filter_criteria, created_by, created_at } = data;
  
  await sql`
    INSERT INTO eval_runs (id, org_id, name, scorer_id, status, filter_criteria, created_by, created_at)
    VALUES (${id}, ${orgId}, ${name}, ${scorer_id}, ${status}, ${filter_criteria ? JSON.stringify(filter_criteria) : null}, ${created_by}, ${created_at})
  `;
  
  return { id, name };
}

export async function getEvalRun(sql, orgId, runId) {
  const [run] = await sql`
    SELECT er.*, es.name as scorer_name, es.scorer_type
    FROM eval_runs er
    LEFT JOIN eval_scorers es ON er.scorer_id = es.id
    WHERE er.id = ${runId} AND er.org_id = ${orgId}
  `;
  
  if (!run) return null;

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
    WHERE scorer_id = ${run.scorer_id}
      AND org_id = ${orgId}
      AND created_at >= ${run.started_at || run.created_at}
    GROUP BY bucket
  `;

  return { run, distribution };
}

export async function updateEvalRunStatus(sql, orgId, runId, status) {
  await sql`
    UPDATE eval_runs SET status = ${status}, completed_at = ${new Date().toISOString()}
    WHERE id = ${runId} AND org_id = ${orgId}
  `;
}

export async function getEvalScorer(sql, orgId, scorerId) {
  const [scorer] = await sql`
    SELECT * FROM eval_scorers WHERE id = ${scorerId} AND org_id = ${orgId}
  `;
  return scorer;
}

export async function listEvalScorers(sql, orgId) {
  return sql`
    SELECT s.*,
      (SELECT COUNT(*) FROM eval_scores WHERE scorer_id = s.id) AS total_scores,
      (SELECT AVG(score) FROM eval_scores WHERE scorer_id = s.id) AS avg_score
    FROM eval_scorers s
    WHERE s.org_id = ${orgId}
    ORDER BY s.created_at DESC
  `;
}

export async function createEvalScorer(sql, orgId, data) {
  const { id, name, scorer_type, config, description, created_at } = data;
  const configStr = config ? (typeof config === 'string' ? config : JSON.stringify(config)) : null;

  await sql`
    INSERT INTO eval_scorers (id, org_id, name, scorer_type, config, description, created_at, updated_at)
    VALUES (${id}, ${orgId}, ${name}, ${scorer_type}, ${configStr}, ${description || null}, ${created_at}, ${created_at})
  `;
  
  return { id, name, scorer_type };
}

export async function updateEvalScorer(sql, orgId, scorerId, updates) {
  if (Object.keys(updates).length === 0) return;
  
  const fields = [];
  const values = [orgId, scorerId];
  
  Object.entries(updates).forEach(([k, v]) => {
    if (k === 'config' && typeof v !== 'string') {
      v = JSON.stringify(v);
    }
    fields.push(`${k} = $${values.push(v)}`);
  });
  
  const query = `UPDATE eval_scorers SET ${fields.join(', ')} WHERE org_id = $1 AND id = $2`;
  await sql.query(query, values);
}

export async function deleteEvalScorer(sql, orgId, scorerId) {
  await sql`DELETE FROM eval_scorers WHERE id = ${scorerId} AND org_id = ${orgId}`;
}

export async function getEvalStats(sql, orgId, filters = {}) {
  const { cutoff } = filters;
  const now = new Date().toISOString();

  const [byScorer, trends, distribution, [overall]] = await Promise.all([
    sql`
      SELECT scorer_name, AVG(score) as avg_score, COUNT(*) as total_scores
      FROM eval_scores
      WHERE org_id = ${orgId} AND created_at >= ${cutoff}
      GROUP BY scorer_name
      ORDER BY avg_score DESC
    `,
    sql`
      SELECT
        LEFT(created_at, 10) as date,
        AVG(score) as avg_score,
        COUNT(*) as count
      FROM eval_scores
      WHERE org_id = ${orgId} AND created_at >= ${cutoff}
      GROUP BY LEFT(created_at, 10)
      ORDER BY date ASC
    `,
    sql`
      SELECT
        CASE
          WHEN score >= 0.8 THEN 'excellent'
          WHEN score >= 0.5 THEN 'acceptable'
          ELSE 'poor'
        END as bucket,
        COUNT(*) as count
      FROM eval_scores
      WHERE org_id = ${orgId} AND created_at >= ${cutoff}
      GROUP BY bucket
    `,
    sql`
      SELECT
        COUNT(*) as total_scores,
        AVG(score) as avg_score,
        COUNT(DISTINCT scorer_name) as unique_scorers,
        COUNT(CASE WHEN LEFT(created_at, 10) = LEFT(${now}, 10) THEN 1 END) as today_count
      FROM eval_scores
      WHERE org_id = ${orgId} AND created_at >= ${cutoff}
    `
  ]);

  return {
    overall: overall || {},
    by_scorer: byScorer,
    trends,
    distribution,
  };
}
