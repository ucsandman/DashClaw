import crypto from 'crypto';

type SqlClient = {
  (s: TemplateStringsArray, ...v: unknown[]): Promise<Record<string, unknown>[]>;
  query: (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
};

function parseJson(value: unknown, fallback: unknown): unknown {
  if (!value) return fallback;
  try {
    return JSON.parse(value as string);
  } catch {
    return fallback;
  }
}

function toBoolean(value: unknown): boolean {
  return value === true || value === 1 || value === '1';
}

export async function listOrganizations(sql: SqlClient, options: { includeDefault?: boolean } = {}): Promise<Record<string, unknown>[]> {
  const includeDefault = options.includeDefault !== false;
  if (includeDefault) {
    return sql`SELECT id FROM organizations ORDER BY id`;
  }
  return sql`SELECT id FROM organizations WHERE id != 'org_default' ORDER BY id`;
}

interface UnscoredFilters {
  lookbackDays?: number | string;
  limit?: number | string;
}

export async function listUnscoredActionIds(sql: SqlClient, orgId: string, filters: UnscoredFilters = {}): Promise<Record<string, unknown>[]> {
  const lookbackDays = Math.max(1, Math.min(Number(filters.lookbackDays) || 30, 365));
  const limit = Math.max(1, Math.min(Number(filters.limit) || 1000, 20000));

  return sql.query(
    `
      SELECT ar.action_id
      FROM action_records ar
      LEFT JOIN learning_episodes le
        ON le.org_id = ar.org_id
       AND le.action_id = ar.action_id
      WHERE ar.org_id = $1
        AND ar.timestamp_start::timestamptz > NOW() - INTERVAL '1 day' * $2
        AND le.action_id IS NULL
      ORDER BY ar.timestamp_start DESC
      LIMIT $3
    `,
    [orgId, lookbackDays, limit]
  );
}

export async function getActionEpisodeSource(sql: SqlClient, orgId: string, actionId: string): Promise<Record<string, unknown> | null> {
  const rows = await sql`
    SELECT
      ar.*,
      (
        SELECT COUNT(*)::int
        FROM assumptions a
        WHERE a.org_id = ${orgId}
          AND a.action_id = ${actionId}
          AND a.invalidated = 1
      ) AS invalidated_assumptions,
      (
        SELECT COUNT(*)::int
        FROM open_loops ol
        WHERE ol.org_id = ${orgId}
          AND ol.action_id = ${actionId}
          AND ol.status = 'open'
      ) AS open_loops
    FROM action_records ar
    WHERE ar.org_id = ${orgId}
      AND ar.action_id = ${actionId}
    LIMIT 1
  `;
  return rows[0] || null;
}

interface EpisodeSource {
  action_id?: unknown;
  agent_id?: unknown;
  action_type?: unknown;
  status?: unknown;
  risk_score?: unknown;
  reversible?: unknown;
  confidence?: unknown;
  duration_ms?: unknown;
  cost_estimate?: unknown;
  invalidated_assumptions?: unknown;
  open_loops?: unknown;
  recommendation_id?: unknown;
  recommendation_applied?: unknown;
  timestamp_start?: unknown;
  [k: string]: unknown;
}

interface ScoredEpisode {
  outcome_label?: unknown;
  score?: unknown;
  breakdown?: unknown;
  [k: string]: unknown;
}

export async function upsertLearningEpisode(sql: SqlClient, orgId: string, source: EpisodeSource, scored: ScoredEpisode): Promise<Record<string, unknown> | null> {
  const now = new Date().toISOString();
  const id = `lep_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`;

  const rows = await sql`
    INSERT INTO learning_episodes (
      id,
      org_id,
      action_id,
      agent_id,
      action_type,
      status,
      outcome_label,
      risk_score,
      reversible,
      confidence,
      duration_ms,
      cost_estimate,
      invalidated_assumptions,
      open_loops,
      recommendation_id,
      recommendation_applied,
      score,
      score_breakdown,
      created_at,
      updated_at
    ) VALUES (
      ${id},
      ${orgId},
      ${source.action_id},
      ${source.agent_id},
      ${source.action_type},
      ${source.status || null},
      ${scored.outcome_label},
      ${source.risk_score ?? 0},
      ${source.reversible ?? 1},
      ${source.confidence ?? 50},
      ${source.duration_ms ?? null},
      ${source.cost_estimate ?? 0},
      ${source.invalidated_assumptions ?? 0},
      ${source.open_loops ?? 0},
      ${source.recommendation_id ?? null},
      ${source.recommendation_applied ?? 0},
      ${scored.score},
      ${JSON.stringify(scored.breakdown)},
      ${source.timestamp_start || now},
      ${now}
    )
    ON CONFLICT (org_id, action_id)
    DO UPDATE SET
      agent_id = EXCLUDED.agent_id,
      action_type = EXCLUDED.action_type,
      status = EXCLUDED.status,
      outcome_label = EXCLUDED.outcome_label,
      risk_score = EXCLUDED.risk_score,
      reversible = EXCLUDED.reversible,
      confidence = EXCLUDED.confidence,
      duration_ms = EXCLUDED.duration_ms,
      cost_estimate = EXCLUDED.cost_estimate,
      invalidated_assumptions = EXCLUDED.invalidated_assumptions,
      open_loops = EXCLUDED.open_loops,
      recommendation_id = EXCLUDED.recommendation_id,
      recommendation_applied = EXCLUDED.recommendation_applied,
      score = EXCLUDED.score,
      score_breakdown = EXCLUDED.score_breakdown,
      updated_at = EXCLUDED.updated_at
    RETURNING *
  `;

  const row = rows[0] || null;
  if (!row) return null;
  return {
    ...row,
    recommendation_applied: toBoolean(row.recommendation_applied),
    score_breakdown: parseJson(row.score_breakdown, {}),
  };
}

interface ListEpisodesFilters {
  agentId?: string;
  actionType?: string;
  lookbackDays?: number | string;
  limit?: number | string;
}

export async function listLearningEpisodes(sql: SqlClient, orgId: string, filters: ListEpisodesFilters = {}): Promise<Record<string, unknown>[]> {
  const { agentId, actionType, lookbackDays = 30, limit = 5000 } = filters;
  let idx = 1;
  const conditions = [`org_id = $${idx++}`];
  const params: unknown[] = [orgId];

  const boundedDays = Math.max(1, Math.min(Number(lookbackDays) || 30, 365));
  conditions.push(`updated_at::timestamptz > NOW() - INTERVAL '1 day' * $${idx++}`);
  params.push(boundedDays);

  if (agentId) {
    conditions.push(`agent_id = $${idx++}`);
    params.push(agentId);
  }
  if (actionType) {
    conditions.push(`action_type = $${idx++}`);
    params.push(actionType);
  }

  const boundedLimit = Math.max(1, Math.min(Number(limit) || 5000, 10000));
  const query = `
    SELECT *
    FROM learning_episodes
    WHERE ${conditions.join(' AND ')}
    ORDER BY updated_at DESC
    LIMIT $${idx}
  `;
  params.push(boundedLimit);
  const rows = await sql.query(query, params);
  return rows.map((row) => ({
    ...row,
    recommendation_applied: toBoolean(row.recommendation_applied),
    score_breakdown: parseJson(row.score_breakdown, {}),
  }));
}

interface ClearRecsFilters {
  agentId?: string;
  actionType?: string;
  olderThan?: string;
}

export async function clearLearningRecommendations(sql: SqlClient, orgId: string, filters: ClearRecsFilters = {}): Promise<number> {
  const { agentId, actionType, olderThan } = filters;
  let idx = 1;
  const conditions = [`org_id = $${idx++}`];
  const params: unknown[] = [orgId];

  if (agentId) {
    conditions.push(`agent_id = $${idx++}`);
    params.push(agentId);
  }
  if (actionType) {
    conditions.push(`action_type = $${idx++}`);
    params.push(actionType);
  }
  if (olderThan) {
    // Used by the rebuild service to drop only recommendations that weren't
    // refreshed in the current batch. Lets us upsert-then-prune so the
    // learning_recommendations table is never empty mid-rebuild.
    conditions.push(`updated_at::timestamptz < $${idx++}`);
    params.push(olderThan);
  }

  const rows = await sql.query(
    `DELETE FROM learning_recommendations WHERE ${conditions.join(' AND ')} RETURNING id`,
    params
  );
  return rows.length;
}

interface RecommendationInput {
  agent_id?: unknown;
  action_type?: unknown;
  confidence?: unknown;
  sample_size?: unknown;
  top_sample_size?: unknown;
  success_rate?: unknown;
  avg_score?: unknown;
  hints?: unknown;
  guidance?: unknown;
  active?: unknown;
  [k: string]: unknown;
}

// Columns in the learning_recommendations INSERT, in order.
const LRECS_COLS = 14;

export async function upsertLearningRecommendations(sql: SqlClient, orgId: string, recommendations: RecommendationInput[]): Promise<Record<string, unknown>[]> {
  if (!recommendations.length) return [];
  const now = new Date().toISOString();

  // recommendations are unique by (agent_id, action_type) by construction
  // (buildRecommendationsFromEpisodes groups on that key). De-dupe keeping the
  // LAST occurrence anyway: a multi-row ON CONFLICT DO UPDATE errors if the same
  // conflict key appears twice in one statement, and the prior per-row loop let
  // the last write win. Generate one id per surviving row (discarded on update,
  // exactly as before — id is not in the SET clause).
  // NUL separator (built as plain ASCII, never appears in agent_id/action_type)
  // keeps the composite key injective and faithful to the per-(agent_id,
  // action_type) DB conflict key.
  const SEP = String.fromCharCode(0);
  const recKey = (agentId: unknown, actionType: unknown) => `${agentId}${SEP}${actionType}`;
  const byKey = new Map<string, { rec: RecommendationInput; id: string }>();
  for (const rec of recommendations) {
    byKey.set(recKey(rec.agent_id, rec.action_type), { rec, id: `lrec_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}` });
  }
  const deduped = [...byKey.values()];

  const placeholders: string[] = [];
  const params: unknown[] = [];
  deduped.forEach(({ rec, id }, j) => {
    const b = j * LRECS_COLS;
    placeholders.push(`(${Array.from({ length: LRECS_COLS }, (_, k) => `$${b + k + 1}`).join(', ')})`);
    params.push(
      id,
      orgId,
      rec.agent_id,
      rec.action_type,
      rec.confidence,
      rec.sample_size,
      rec.top_sample_size,
      rec.success_rate,
      rec.avg_score,
      JSON.stringify(rec.hints || {}),
      JSON.stringify(rec.guidance || []),
      rec.active === false ? 0 : 1,
      now,
      now
    );
  });

  // EXCLUDED.x equals the value the old per-row statement interpolated; `active`
  // still preserves the existing row's value (not EXCLUDED), unchanged.
  const rows = await sql.query(
    `INSERT INTO learning_recommendations (
       id, org_id, agent_id, action_type, confidence, sample_size, top_sample_size,
       success_rate, avg_score, hints, guidance, active, computed_at, updated_at
     ) VALUES ${placeholders.join(', ')}
     ON CONFLICT (org_id, agent_id, action_type)
     DO UPDATE SET
       confidence = EXCLUDED.confidence,
       sample_size = EXCLUDED.sample_size,
       top_sample_size = EXCLUDED.top_sample_size,
       success_rate = EXCLUDED.success_rate,
       avg_score = EXCLUDED.avg_score,
       hints = EXCLUDED.hints,
       guidance = EXCLUDED.guidance,
       active = learning_recommendations.active,
       computed_at = EXCLUDED.computed_at,
       updated_at = EXCLUDED.updated_at
     RETURNING *`,
    params
  );

  // Multi-row RETURNING order is unspecified — re-map to input order by the
  // conflict key so the returned array matches the prior per-row output.
  const byReturnedKey = new Map<string, Record<string, unknown>>();
  for (const row of rows) byReturnedKey.set(recKey(row.agent_id, row.action_type), row);

  const saved: Record<string, unknown>[] = [];
  for (const { rec } of deduped) {
    const row = byReturnedKey.get(recKey(rec.agent_id, rec.action_type));
    if (row) {
      saved.push({
        ...row,
        hints: parseJson(row.hints, {}),
        guidance: parseJson(row.guidance, []),
        active: toBoolean(row.active),
      });
    }
  }

  return saved;
}

interface ListRecsFilters {
  agentId?: string;
  actionType?: string;
  limit?: number | string;
  includeInactive?: boolean;
}

export async function listLearningRecommendations(sql: SqlClient, orgId: string, filters: ListRecsFilters = {}): Promise<Record<string, unknown>[]> {
  const { agentId, actionType, limit = 50, includeInactive = false } = filters;
  let idx = 1;
  const conditions = [`org_id = $${idx++}`];
  const params: unknown[] = [orgId];

  if (agentId) {
    conditions.push(`agent_id = $${idx++}`);
    params.push(agentId);
  }
  if (actionType) {
    conditions.push(`action_type = $${idx++}`);
    params.push(actionType);
  }
  if (!includeInactive) {
    conditions.push(`active = 1`);
  }

  const boundedLimit = Math.max(1, Math.min(Number(limit) || 50, 200));
  const rows = await sql.query(
    `SELECT * FROM learning_recommendations WHERE ${conditions.join(' AND ')} ORDER BY confidence DESC, sample_size DESC LIMIT $${idx}`,
    [...params, boundedLimit]
  );

  return rows.map((row) => ({
    ...row,
    hints: parseJson(row.hints, {}),
    guidance: parseJson(row.guidance, []),
    active: toBoolean(row.active),
  }));
}

export async function updateLearningRecommendationActive(sql: SqlClient, orgId: string, recommendationId: string, active: boolean): Promise<Record<string, unknown> | null> {
  const now = new Date().toISOString();
  const rows = await sql`
    UPDATE learning_recommendations
    SET active = ${active ? 1 : 0},
        updated_at = ${now}
    WHERE org_id = ${orgId}
      AND id = ${recommendationId}
    RETURNING *
  `;

  const row = rows[0];
  if (!row) return null;
  return {
    ...row,
    hints: parseJson(row.hints, {}),
    guidance: parseJson(row.guidance, []),
    active: toBoolean(row.active),
  };
}

interface RecommendationEvent {
  recommendation_id?: unknown;
  agent_id?: unknown;
  action_id?: unknown;
  event_type?: unknown;
  event_key?: unknown;
  details?: unknown;
  created_at?: unknown;
  [k: string]: unknown;
}

// Columns in the learning_recommendation_events INSERT, in order.
const LREV_COLS = 9;

export async function createLearningRecommendationEvents(sql: SqlClient, orgId: string, events: RecommendationEvent[] = []): Promise<Record<string, unknown>[]> {
  if (!events.length) return [];

  // Stamp an id + created_at per event (each event keeps its own timestamp,
  // exactly as the per-row loop did). ON CONFLICT (org_id, event_key) DO NOTHING
  // is duplicate-safe in a multi-row INSERT — Postgres silently skips intra-batch
  // and pre-existing conflicts (no "affect row a second time" error, which only
  // applies to DO UPDATE), matching the loop's "first write wins" behavior.
  const prepared = events.map((event) => ({
    id: `lrev_${crypto.randomUUID().replace(/-/g, '').slice(0, 24)}`,
    event,
    created_at: event.created_at || new Date().toISOString(),
  }));

  const placeholders: string[] = [];
  const params: unknown[] = [];
  prepared.forEach(({ id, event, created_at }, j) => {
    const b = j * LREV_COLS;
    placeholders.push(`(${Array.from({ length: LREV_COLS }, (_, k) => `$${b + k + 1}`).join(', ')})`);
    params.push(
      id,
      orgId,
      event.recommendation_id || null,
      event.agent_id || null,
      event.action_id || null,
      event.event_type,
      event.event_key || null,
      event.details ? JSON.stringify(event.details) : null,
      created_at
    );
  });

  const rows = await sql.query(
    `INSERT INTO learning_recommendation_events (
       id, org_id, recommendation_id, agent_id, action_id, event_type, event_key, details, created_at
     ) VALUES ${placeholders.join(', ')}
     ON CONFLICT (org_id, event_key)
     DO NOTHING
     RETURNING *`,
    params
  );

  // DO NOTHING returns only rows actually inserted; nothing is updated, so each
  // returned row keeps the id we generated. Map back to input order and drop
  // skipped (conflicting) events, exactly as the per-row loop's `if (row)` did.
  const insertedById = new Map<string, Record<string, unknown>>();
  for (const row of rows) insertedById.set(row.id as string, row);

  const created: Record<string, unknown>[] = [];
  for (const { id } of prepared) {
    const row = insertedById.get(id);
    if (row) created.push({ ...row, details: parseJson(row.details, {}) });
  }
  return created;
}

interface ListEventsFilters {
  agentId?: string;
  recommendationIds?: unknown[];
  actionType?: string;
  lookbackDays?: number | string;
  limit?: number | string;
}

export async function listLearningRecommendationEvents(sql: SqlClient, orgId: string, filters: ListEventsFilters = {}): Promise<Record<string, unknown>[]> {
  const {
    agentId,
    recommendationIds,
    actionType,
    lookbackDays = 30,
    limit = 20000,
  } = filters;

  let idx = 1;
  const conditions = [`ev.org_id = $${idx++}`];
  const params: unknown[] = [orgId];

  const boundedDays = Math.max(1, Math.min(Number(lookbackDays) || 30, 365));
  conditions.push(`ev.created_at::timestamptz > NOW() - INTERVAL '1 day' * $${idx++}`);
  params.push(boundedDays);

  if (agentId) {
    conditions.push(`ev.agent_id = $${idx++}`);
    params.push(agentId);
  }

  if (Array.isArray(recommendationIds) && recommendationIds.length > 0) {
    conditions.push(`ev.recommendation_id = ANY($${idx++})`);
    params.push(recommendationIds);
  }

  if (actionType) {
    conditions.push(`rec.action_type = $${idx++}`);
    params.push(actionType);
  }

  const boundedLimit = Math.max(1, Math.min(Number(limit) || 20000, 100000));
  const query = `
    SELECT ev.*, rec.action_type
    FROM learning_recommendation_events ev
    LEFT JOIN learning_recommendations rec
      ON rec.org_id = ev.org_id
     AND rec.id = ev.recommendation_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY ev.created_at DESC
    LIMIT $${idx}
  `;

  const rows = await sql.query(query, [...params, boundedLimit]);
  return rows.map((row) => ({
    ...row,
    details: parseJson(row.details, {}),
  }));
}

/**
 * Count episodes created after the most recent recommendation rebuild.
 * Used to decide whether to trigger an automatic rebuild.
 */
export async function countEpisodesSinceLastRebuild(sql: SqlClient, orgId: string): Promise<number> {
  const rows = await sql`
    SELECT COUNT(*)::int AS cnt
    FROM learning_episodes le
    WHERE le.org_id = ${orgId}
      AND le.created_at > COALESCE(
        (SELECT MAX(computed_at) FROM learning_recommendations WHERE org_id = ${orgId}),
        '1970-01-01'::timestamptz
      )
  `;
  return (rows[0]?.cnt as number | undefined) || 0;
}
