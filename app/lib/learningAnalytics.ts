import crypto from 'crypto';
import { getSql } from './db';
import { getOrgId } from './org';
import { average, quantile } from './learning-loop';

// getSql() / the Neon tagged-template client are sourced from untyped JS
// modules; this is the established tagged-template + `.query` surface.
type Sql = ((strings: TemplateStringsArray, ...values: unknown[]) => Promise<any[]>) & {
  query: (text: string, params?: unknown[]) => Promise<any[]>;
};

// The request is only consumed by getOrgId() (reads x-org-id header).
type ReqLike = Parameters<typeof getOrgId>[0];

// DB rows are external boundaries (Neon HTTP driver; numeric cols arrive as
// strings). Typed loosely and coerced with Number() where summed.
type Row = Record<string, any>;

// -----------------------------------------------
// Statistical Utilities
// -----------------------------------------------

function round(v: number): number { return Math.round(v * 1000) / 1000; }

function linearRegSlope(values: number[]): number {
  // Simple linear regression slope: how fast scores change over time
  const n = values.length;
  if (n < 2) return 0;
  const xMean = (n - 1) / 2;
  const yMean = average(values);
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xMean) * ((values[i] as number) - yMean);
    den += (i - xMean) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

// -----------------------------------------------
// Maturity Model (based on episode volume + quality)
// -----------------------------------------------

interface MaturityLevel {
  level: string;
  min_episodes: number;
  min_success_rate: number;
  min_avg_score: number;
}

const MATURITY_LEVELS: MaturityLevel[] = [
  { level: 'novice', min_episodes: 0, min_success_rate: 0, min_avg_score: 0 },
  { level: 'developing', min_episodes: 10, min_success_rate: 0.4, min_avg_score: 40 },
  { level: 'competent', min_episodes: 50, min_success_rate: 0.6, min_avg_score: 55 },
  { level: 'proficient', min_episodes: 150, min_success_rate: 0.75, min_avg_score: 65 },
  { level: 'expert', min_episodes: 500, min_success_rate: 0.85, min_avg_score: 75 },
  { level: 'master', min_episodes: 1000, min_success_rate: 0.92, min_avg_score: 85 },
];

interface MaturityClassification {
  level: string;
  score: number;
}

function classifyMaturity(totalEpisodes: number, successRate: number, avgScore: number): MaturityClassification {
  let best = MATURITY_LEVELS[0] as MaturityLevel;
  for (const level of MATURITY_LEVELS) {
    if (totalEpisodes >= level.min_episodes && successRate >= level.min_success_rate && avgScore >= level.min_avg_score) {
      best = level;
    }
  }
  // Numeric score (0-100) based on weighted factors
  const episodeScore = Math.min(totalEpisodes / 1000, 1) * 30;
  const rateScore = successRate * 40;
  const qualityScore = (avgScore / 100) * 30;
  return {
    level: best.level,
    score: round(episodeScore + rateScore + qualityScore),
  };
}

// -----------------------------------------------
// Velocity Computation
// -----------------------------------------------

interface VelocityOptions {
  agent_id?: string;
  lookback_days?: number;
  period?: string;
}

export async function computeVelocity(request: ReqLike, { agent_id, lookback_days, period }: VelocityOptions = {}) {
  const sql = getSql() as unknown as Sql;
  const orgId = getOrgId(request);
  const days = lookback_days || 30;
  const periodType = period || 'daily';
  const results: any[] = [];

  const agents = agent_id ? [agent_id] : await getAgentIds(sql, orgId);

  for (const agentId of agents) {
    // Get all episodes in lookback window
    const episodes: Row[] = await sql.query(
      `SELECT score, outcome_label, duration_ms, cost_estimate, created_at
       FROM learning_episodes
       WHERE org_id = $1 AND agent_id = $2
         AND created_at::timestamptz >= NOW() - $3::interval
       ORDER BY created_at ASC`,
      [orgId, agentId, `${days} days`]
    );

    if (episodes.length < 3) continue;

    // Divide into time windows
    const windowMs = periodType === 'weekly' ? 7 * 86400000 : 86400000;
    const startTime = new Date((episodes[0] as Row).created_at).getTime();
    const endTime = Date.now();
    const windows: Array<{ start: string; end: string; count: number; avg_score: number; success_rate: number }> = [];
    let winStart = startTime;

    while (winStart < endTime) {
      const winEnd = winStart + windowMs;
      const windowEps = episodes.filter(e => {
        const t = new Date(e.created_at).getTime();
        return t >= winStart && t < winEnd;
      });
      if (windowEps.length > 0) {
        const scores = windowEps.map(e => Number(e.score));
        const avgScore = round(average(scores));
        const successCount = windowEps.filter(e => e.outcome_label === 'success').length;
        const successRate = round(successCount / windowEps.length);
        windows.push({
          start: new Date(winStart).toISOString(),
          end: new Date(winEnd).toISOString(),
          count: windowEps.length,
          avg_score: avgScore,
          success_rate: successRate,
        });
      }
      winStart = winEnd;
    }

    if (windows.length < 2) continue;

    // Compute velocity: slope of avg_score over time windows
    const scoreTimeline = windows.map(w => w.avg_score);
    const velocity = round(linearRegSlope(scoreTimeline));

    // Compute acceleration: change in velocity (second derivative)
    let acceleration = 0;
    if (windows.length >= 3) {
      const firstHalf = scoreTimeline.slice(0, Math.floor(scoreTimeline.length / 2));
      const secondHalf = scoreTimeline.slice(Math.floor(scoreTimeline.length / 2));
      const v1 = linearRegSlope(firstHalf);
      const v2 = linearRegSlope(secondHalf);
      acceleration = round(v2 - v1);
    }

    // Score delta (latest window vs first window)
    const scoreDelta = round((windows[windows.length - 1] as typeof windows[number]).avg_score - (windows[0] as typeof windows[number]).avg_score);

    // Overall maturity
    const totalEpisodes = episodes.length;
    const overallSuccessRate = episodes.filter(e => e.outcome_label === 'success').length / totalEpisodes;
    const overallAvgScore = average(episodes.map(e => Number(e.score)));
    const maturity = classifyMaturity(totalEpisodes, overallSuccessRate, overallAvgScore);

    // Store velocity record
    const id = 'lv_' + crypto.randomBytes(12).toString('hex');
    await sql`
      INSERT INTO learning_velocity (id, org_id, agent_id, period, period_start, period_end, episode_count, avg_score, success_rate, score_delta, velocity, acceleration, maturity_score, maturity_level)
      VALUES (${id}, ${orgId}, ${agentId}, ${periodType}, ${new Date(startTime).toISOString()}, ${new Date().toISOString()}, ${totalEpisodes}, ${round(overallAvgScore)}, ${round(overallSuccessRate)}, ${scoreDelta}, ${velocity}, ${acceleration}, ${maturity.score}, ${maturity.level})
      ON CONFLICT (org_id, agent_id, period) DO UPDATE SET
        period_start = EXCLUDED.period_start,
        period_end = EXCLUDED.period_end,
        episode_count = EXCLUDED.episode_count,
        avg_score = EXCLUDED.avg_score,
        success_rate = EXCLUDED.success_rate,
        score_delta = EXCLUDED.score_delta,
        velocity = EXCLUDED.velocity,
        acceleration = EXCLUDED.acceleration,
        maturity_score = EXCLUDED.maturity_score,
        maturity_level = EXCLUDED.maturity_level
    `;

    results.push({
      agent_id: agentId,
      episode_count: totalEpisodes,
      avg_score: round(overallAvgScore),
      success_rate: round(overallSuccessRate),
      score_delta: scoreDelta,
      velocity,
      acceleration,
      maturity: maturity,
      windows: windows.length,
    });
  }

  return { agents_computed: results.length, results };
}

async function getAgentIds(sql: Sql, orgId: string): Promise<string[]> {
  const rows = await sql`SELECT DISTINCT agent_id FROM learning_episodes WHERE org_id = ${orgId} AND agent_id IS NOT NULL AND agent_id != '' LIMIT 50`;
  return rows.map(r => r.agent_id);
}

// -----------------------------------------------
// Learning Curves (per action_type)
// -----------------------------------------------

interface LearningCurvesOptions {
  agent_id?: string;
  lookback_days?: number;
}

export async function computeLearningCurves(request: ReqLike, { agent_id, lookback_days }: LearningCurvesOptions = {}) {
  const sql = getSql() as unknown as Sql;
  const orgId = getOrgId(request);
  const days = lookback_days || 60;
  const results: any[] = [];

  const agents = agent_id ? [agent_id] : await getAgentIds(sql, orgId);

  for (const agentId of agents) {
    // Get distinct action types
    const actionTypes = await sql`
      SELECT DISTINCT action_type FROM learning_episodes
      WHERE org_id = ${orgId} AND agent_id = ${agentId} AND action_type IS NOT NULL AND action_type != ''
      LIMIT 20
    `;

    for (const { action_type } of actionTypes) {
      const episodes: Row[] = await sql.query(
        `SELECT score, outcome_label, duration_ms, cost_estimate, created_at
         FROM learning_episodes
         WHERE org_id = $1 AND agent_id = $2 AND action_type = $3
           AND created_at::timestamptz >= NOW() - $4::interval
         ORDER BY created_at ASC`,
        [orgId, agentId, action_type, `${days} days`]
      );

      if (episodes.length < 3) continue;

      // Create weekly windows
      const windowMs = 7 * 86400000;
      const startTime = new Date((episodes[0] as Row).created_at).getTime();
      let winStart = startTime;

      while (winStart < Date.now()) {
        const winEnd = winStart + windowMs;
        const windowEps = episodes.filter(e => {
          const t = new Date(e.created_at).getTime();
          return t >= winStart && t < winEnd;
        });

        if (windowEps.length > 0) {
          const scores = windowEps.map(e => Number(e.score)).sort((a, b) => a - b);
          const id = 'lc_' + crypto.randomBytes(12).toString('hex');
          const successCount = windowEps.filter(e => e.outcome_label === 'success').length;
          const durations = windowEps.map(e => Number(e.duration_ms || 0)).filter(d => d > 0);
          const costs = windowEps.map(e => Number(e.cost_estimate || 0)).filter(c => c > 0);

          await sql`
            INSERT INTO learning_curves (id, org_id, agent_id, action_type, window_start, window_end, episode_count, avg_score, success_rate, avg_duration_ms, avg_cost, p25_score, p75_score)
            VALUES (${id}, ${orgId}, ${agentId}, ${action_type}, ${new Date(winStart).toISOString()}, ${new Date(winEnd).toISOString()}, ${windowEps.length}, ${round(average(scores))}, ${round(successCount / windowEps.length)}, ${round(durations.length > 0 ? average(durations) : 0)}, ${round(costs.length > 0 ? average(costs) : 0)}, ${round(quantile(scores, 0.25) ?? 0)}, ${round(quantile(scores, 0.75) ?? 0)})
            ON CONFLICT (org_id, agent_id, action_type, window_start) DO UPDATE SET
              window_end = EXCLUDED.window_end,
              episode_count = EXCLUDED.episode_count,
              avg_score = EXCLUDED.avg_score,
              success_rate = EXCLUDED.success_rate,
              avg_duration_ms = EXCLUDED.avg_duration_ms,
              avg_cost = EXCLUDED.avg_cost,
              p25_score = EXCLUDED.p25_score,
              p75_score = EXCLUDED.p75_score
          `;

          results.push({ agent_id: agentId, action_type, window_start: new Date(winStart).toISOString(), count: windowEps.length });
        }
        winStart = winEnd;
      }
    }
  }

  return { curves_computed: results.length, results };
}

// -----------------------------------------------
// Analytics Queries
// -----------------------------------------------

interface VelocityDataOptions {
  agent_id?: string;
  limit?: string | number;
}

export async function getVelocityData(request: ReqLike, { agent_id, limit }: VelocityDataOptions = {}) {
  const sql = getSql() as unknown as Sql;
  const orgId = getOrgId(request);
  // Guard a non-numeric ?limit= (e.g. "abc"): parseInt yields NaN and LIMIT NaN
  // makes Postgres 500 the request. Fall back to the default instead.
  const parsedLimit = parseInt(limit as string, 10);
  const lim = Math.min(Number.isFinite(parsedLimit) ? parsedLimit : 30, 100);

  if (agent_id) {
    return sql`SELECT * FROM learning_velocity WHERE org_id = ${orgId} AND agent_id = ${agent_id} ORDER BY created_at DESC LIMIT ${lim}`;
  }
  return sql`SELECT * FROM learning_velocity WHERE org_id = ${orgId} ORDER BY created_at DESC LIMIT ${lim}`;
}

interface CurveDataOptions {
  agent_id?: string;
  action_type?: string;
  limit?: string | number;
}

export async function getCurveData(request: ReqLike, { agent_id, action_type, limit }: CurveDataOptions = {}) {
  const sql = getSql() as unknown as Sql;
  const orgId = getOrgId(request);
  const parsedLimit = parseInt(limit as string, 10);
  const lim = Math.min(Number.isFinite(parsedLimit) ? parsedLimit : 50, 200);

  if (agent_id && action_type) {
    return sql`SELECT * FROM learning_curves WHERE org_id = ${orgId} AND agent_id = ${agent_id} AND action_type = ${action_type} ORDER BY window_start ASC LIMIT ${lim}`;
  }
  if (agent_id) {
    return sql`SELECT * FROM learning_curves WHERE org_id = ${orgId} AND agent_id = ${agent_id} ORDER BY window_start ASC LIMIT ${lim}`;
  }
  return sql`SELECT * FROM learning_curves WHERE org_id = ${orgId} ORDER BY window_start ASC LIMIT ${lim}`;
}

interface AnalyticsSummaryOptions {
  agent_id?: string;
}

export async function getAnalyticsSummary(request: ReqLike, { agent_id }: AnalyticsSummaryOptions = {}) {
  const sql = getSql() as unknown as Sql;
  const orgId = getOrgId(request);

  // Overall episode stats from learning_episodes directly
  let episodeStats: Row[];
  if (agent_id) {
    episodeStats = await sql`
      SELECT
        COUNT(*) AS total_episodes,
        ROUND(AVG(score)::numeric, 2) AS avg_score,
        COUNT(*) FILTER (WHERE outcome_label = 'success') AS success_count,
        COUNT(*) FILTER (WHERE outcome_label = 'failure') AS failure_count,
        COUNT(*) FILTER (WHERE outcome_label = 'pending') AS pending_count,
        ROUND(AVG(duration_ms)::numeric, 0) AS avg_duration_ms,
        ROUND(SUM(cost_estimate)::numeric, 4) AS total_cost
      FROM learning_episodes WHERE org_id = ${orgId} AND agent_id = ${agent_id}
    `;
  } else {
    episodeStats = await sql`
      SELECT
        COUNT(*) AS total_episodes,
        ROUND(AVG(score)::numeric, 2) AS avg_score,
        COUNT(*) FILTER (WHERE outcome_label = 'success') AS success_count,
        COUNT(*) FILTER (WHERE outcome_label = 'failure') AS failure_count,
        COUNT(*) FILTER (WHERE outcome_label = 'pending') AS pending_count,
        ROUND(AVG(duration_ms)::numeric, 0) AS avg_duration_ms,
        ROUND(SUM(cost_estimate)::numeric, 4) AS total_cost
      FROM learning_episodes WHERE org_id = ${orgId}
    `;
  }

  const overall = (episodeStats[0] || {}) as Row;
  const totalOutcomes = (Number(overall.success_count) || 0) + (Number(overall.failure_count) || 0);
  const successRate = totalOutcomes > 0 ? round((Number(overall.success_count) / totalOutcomes)) : 0;

  // Per-agent summary — when filtering, collapse to the single selected agent
  // so the leaderboard view matches the dropdown choice.
  const agentSummary: Row[] = agent_id
    ? await sql`
        SELECT
          agent_id,
          COUNT(*) AS episode_count,
          ROUND(AVG(score)::numeric, 2) AS avg_score,
          COUNT(*) FILTER (WHERE outcome_label = 'success') AS success_count,
          COUNT(*) FILTER (WHERE outcome_label = 'failure') AS failure_count,
          ROUND(AVG(duration_ms)::numeric, 0) AS avg_duration_ms,
          ROUND(SUM(cost_estimate)::numeric, 4) AS total_cost
        FROM learning_episodes WHERE org_id = ${orgId} AND agent_id = ${agent_id}
        GROUP BY agent_id ORDER BY episode_count DESC LIMIT 10
      `
    : await sql`
        SELECT
          agent_id,
          COUNT(*) AS episode_count,
          ROUND(AVG(score)::numeric, 2) AS avg_score,
          COUNT(*) FILTER (WHERE outcome_label = 'success') AS success_count,
          COUNT(*) FILTER (WHERE outcome_label = 'failure') AS failure_count,
          ROUND(AVG(duration_ms)::numeric, 0) AS avg_duration_ms,
          ROUND(SUM(cost_estimate)::numeric, 4) AS total_cost
        FROM learning_episodes WHERE org_id = ${orgId}
        GROUP BY agent_id ORDER BY episode_count DESC LIMIT 10
      `;

  // Per action_type
  const actionTypeSummary: Row[] = agent_id
    ? await sql`
        SELECT
          action_type,
          COUNT(*) AS episode_count,
          ROUND(AVG(score)::numeric, 2) AS avg_score,
          COUNT(*) FILTER (WHERE outcome_label = 'success') AS success_count,
          COUNT(*) FILTER (WHERE outcome_label = 'failure') AS failure_count
        FROM learning_episodes WHERE org_id = ${orgId} AND agent_id = ${agent_id}
        GROUP BY action_type ORDER BY episode_count DESC LIMIT 15
      `
    : await sql`
        SELECT
          action_type,
          COUNT(*) AS episode_count,
          ROUND(AVG(score)::numeric, 2) AS avg_score,
          COUNT(*) FILTER (WHERE outcome_label = 'success') AS success_count,
          COUNT(*) FILTER (WHERE outcome_label = 'failure') AS failure_count
        FROM learning_episodes WHERE org_id = ${orgId}
        GROUP BY action_type ORDER BY episode_count DESC LIMIT 15
      `;

  // Latest velocity per agent
  const latestVelocity: Row[] = agent_id
    ? await sql`
        SELECT DISTINCT ON (agent_id) agent_id, velocity, acceleration, maturity_score, maturity_level, score_delta, created_at
        FROM learning_velocity WHERE org_id = ${orgId} AND agent_id = ${agent_id}
        ORDER BY agent_id, created_at DESC
      `
    : await sql`
        SELECT DISTINCT ON (agent_id) agent_id, velocity, acceleration, maturity_score, maturity_level, score_delta, created_at
        FROM learning_velocity WHERE org_id = ${orgId}
        ORDER BY agent_id, created_at DESC
      `;

  // Recommendation effectiveness
  const recEffectiveness: Row[] = agent_id
    ? await sql`
        SELECT
          COUNT(*) AS total_recommendations,
          COUNT(*) FILTER (WHERE active = 1) AS active_recommendations,
          ROUND(AVG(success_rate)::numeric, 3) AS avg_success_rate,
          ROUND(AVG(avg_score)::numeric, 2) AS avg_rec_score,
          ROUND(AVG(confidence)::numeric, 0) AS avg_confidence
        FROM learning_recommendations WHERE org_id = ${orgId} AND agent_id = ${agent_id}
      `
    : await sql`
        SELECT
          COUNT(*) AS total_recommendations,
          COUNT(*) FILTER (WHERE active = 1) AS active_recommendations,
          ROUND(AVG(success_rate)::numeric, 3) AS avg_success_rate,
          ROUND(AVG(avg_score)::numeric, 2) AS avg_rec_score,
          ROUND(AVG(confidence)::numeric, 0) AS avg_confidence
        FROM learning_recommendations WHERE org_id = ${orgId}
      `;

  return {
    overall: {
      ...overall,
      success_rate: successRate,
    },
    by_agent: agentSummary.map(a => {
      const vel = latestVelocity.find(v => v.agent_id === a.agent_id);
      const agentOutcomes = (Number(a.success_count) || 0) + (Number(a.failure_count) || 0);
      return {
        ...a,
        success_rate: agentOutcomes > 0 ? round(Number(a.success_count) / agentOutcomes) : 0,
        velocity: vel ? Number(vel.velocity) : null,
        acceleration: vel ? Number(vel.acceleration) : null,
        maturity_level: vel ? vel.maturity_level : 'unknown',
        maturity_score: vel ? Number(vel.maturity_score) : 0,
      };
    }),
    by_action_type: actionTypeSummary.map(a => {
      const outcomes = (Number(a.success_count) || 0) + (Number(a.failure_count) || 0);
      return { ...a, success_rate: outcomes > 0 ? round(Number(a.success_count) / outcomes) : 0 };
    }),
    recommendations: recEffectiveness[0] || {},
    velocity: latestVelocity,
  };
}

export function getMaturityLevels(): MaturityLevel[] {
  return MATURITY_LEVELS;
}
