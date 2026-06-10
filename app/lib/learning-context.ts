import type { SqlTag } from './types/db.js';

interface LearningContext {
  recent_score_avg: number | null;
  baseline_score_avg: number | null;
  drift_status: string | null;
  patterns: string[];
  feedback_summary: string | null;
}

interface LearningContextOptions {
  agentId?: string | null;
  actionType?: string | null;
}

interface LearningContextRow {
  recent_scores?: unknown;
  baseline_avg?: number | string | null;
  drift_severity?: string | null;
  rec_guidance?: unknown;
  negative_count?: number | string | null;
  negative_avg_rating?: number | string | null;
}

const asArray = (v: unknown): unknown[] => {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') {
    try { const parsed = JSON.parse(v); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
  }
  return [];
};

/**
 * Build learning context for a guard decision.
 * Best-effort — never blocks guard decisions on failure.
 *
 * Hot path: this runs on every governed call, so the five source reads
 * (recent episodes, baseline, drift alerts, recommendations, negative
 * feedback) are batched into ONE round-trip via scalar subqueries. The
 * returned shape is identical to the previous sequential implementation.
 */
export async function getLearningContext(
  sql: SqlTag,
  orgId: string,
  { agentId, actionType }: LearningContextOptions
): Promise<LearningContext | null> {
  if (!agentId) return null;

  const context: LearningContext = {
    recent_score_avg: null,
    baseline_score_avg: null,
    drift_status: null,
    patterns: [],
    feedback_summary: null,
  };

  try {
    const episodeType = actionType || 'unknown';
    const rows = await sql`
      SELECT
        (SELECT COALESCE(json_agg(s.score), '[]'::json) FROM (
            SELECT score FROM learning_episodes
            WHERE org_id = ${orgId} AND agent_id = ${agentId}
              AND action_type = ${episodeType}
            ORDER BY created_at DESC LIMIT 10
          ) s) AS recent_scores,
        (SELECT AVG(score) FROM learning_episodes
          WHERE org_id = ${orgId} AND agent_id = ${agentId}
            AND action_type = ${episodeType}) AS baseline_avg,
        (SELECT severity FROM drift_alerts
          WHERE org_id = ${orgId} AND agent_id = ${agentId}
            AND acknowledged = false
          ORDER BY severity DESC LIMIT 1) AS drift_severity,
        (SELECT COALESCE(json_agg(r.guidance), '[]'::json) FROM (
            SELECT guidance FROM learning_recommendations
            WHERE org_id = ${orgId} AND agent_id = ${agentId} AND active = 1
            ${actionType ? sql`AND action_type = ${actionType}` : sql``}
            ORDER BY confidence DESC, sample_size DESC LIMIT 3
          ) r) AS rec_guidance,
        (SELECT COUNT(*) FROM feedback
          WHERE org_id = ${orgId} AND agent_id = ${agentId}
            AND sentiment = 'negative'
            AND created_at > NOW() - INTERVAL '7 days') AS negative_count,
        (SELECT AVG(rating) FROM feedback
          WHERE org_id = ${orgId} AND agent_id = ${agentId}
            AND sentiment = 'negative'
            AND created_at > NOW() - INTERVAL '7 days') AS negative_avg_rating
    ` as LearningContextRow[];

    const row = rows[0];
    if (!row) return null;

    // 1. Recent scores for this action type (last 10 episodes)
    const recentScores = asArray(row.recent_scores) as Array<number | null>;
    if (recentScores.length > 0) {
      context.recent_score_avg = Math.round(
        recentScores.reduce((s: number, v) => s + (Number(v) || 0), 0) / recentScores.length
      );
    }

    // 2. Baseline score (all-time for this action type)
    if (row.baseline_avg != null) {
      context.baseline_score_avg = Math.round(Number(row.baseline_avg));
    }

    // 3. Active drift alerts for this agent
    if (row.drift_severity != null) {
      context.drift_status = row.drift_severity;
    }

    // 4. Recommendations (patterns from successful actions)
    const guidanceList = asArray(row.rec_guidance);
    if (guidanceList.length > 0) {
      context.patterns = guidanceList.map((g) => {
        const guidance = typeof g === 'string' ? JSON.parse(g) : g;
        return (guidance as { text?: string; summary?: string })?.text || (guidance as { text?: string; summary?: string })?.summary || '';
      }).filter(Boolean);
    }

    // 5. Recent negative feedback
    if (Number(row.negative_count) > 0) {
      context.feedback_summary = `${row.negative_count} negative rating(s) in last 7 days (avg ${Number(row.negative_avg_rating).toFixed(1)})`;
    }
  } catch (err) {
    console.error('[learning-context] Error building context:', (err as Error)?.message);
  }

  const hasData = context.recent_score_avg != null || context.drift_status || context.patterns.length > 0 || context.feedback_summary;
  return hasData ? context : null;
}
