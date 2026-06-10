import type { SqlTag } from './types/db';

interface PolicySuggestionOptions {
  lookbackDays?: number;
  minFeedbackCount?: number;
}

interface NegativeTrendRow {
  agent_id: string;
  action_type: string;
  negative_count: number | string;
  avg_rating: number | string;
  latest_feedback: string | Date | null;
}

interface CriticalDriftRow {
  agent_id: string;
  metric: string;
  z_score: number | string;
}

interface PolicySuggestion {
  type: string;
  trigger: string;
  agent_id: string;
  action_type: string;
  evidence: Record<string, unknown>;
  suggested_policy: {
    name: string;
    policy_type: string;
    rules: string;
    agent_ids: string;
  };
  severity: string;
}

/**
 * Analyze feedback trends and drift alerts to suggest policy changes.
 * Runs on a schedule (cron) or on-demand via API.
 */
export async function generatePolicySuggestions(
  sql: SqlTag,
  orgId: string,
  { lookbackDays = 14, minFeedbackCount = 3 }: PolicySuggestionOptions = {}
): Promise<PolicySuggestion[]> {
  const suggestions: PolicySuggestion[] = [];

  // 1. Find action types with trending negative feedback
  const negativeTrends = await sql`
    SELECT
      f.agent_id,
      a.action_type,
      COUNT(*) as negative_count,
      AVG(f.rating) as avg_rating,
      MAX(f.created_at) as latest_feedback
    FROM feedback f
    JOIN action_records a ON f.action_id = a.action_id AND a.org_id = f.org_id
    WHERE f.org_id = ${orgId}
      AND f.sentiment = 'negative'
      AND f.created_at > NOW() - ${lookbackDays + ' days'}::interval
    GROUP BY f.agent_id, a.action_type
    HAVING COUNT(*) >= ${minFeedbackCount}
    ORDER BY COUNT(*) DESC
    LIMIT 20
  ` as unknown as NegativeTrendRow[];

  for (const trend of negativeTrends) {
    // Check if a matching policy already exists
    const existingPolicy = await sql`
      SELECT id FROM guard_policies
      WHERE org_id = ${orgId}
        AND active = 1
        AND (
          rules::jsonb @> ${JSON.stringify({ action_types: [trend.action_type] })}::jsonb
          OR (agent_ids IS NOT NULL AND agent_ids::text LIKE ${`%${trend.agent_id}%`})
        )
      LIMIT 1
    `;

    if (existingPolicy.length > 0) continue;

    suggestions.push({
      type: 'require_approval',
      trigger: 'negative_feedback_trend',
      agent_id: trend.agent_id,
      action_type: trend.action_type,
      evidence: {
        negative_count: Number(trend.negative_count),
        avg_rating: Number(Number(trend.avg_rating).toFixed(1)),
        period_days: lookbackDays,
      },
      suggested_policy: {
        name: `auto-review-${trend.action_type}-${trend.agent_id}`,
        policy_type: 'require_approval',
        rules: JSON.stringify({
          action_types: [trend.action_type],
          reason: `${trend.negative_count} negative feedback items (avg rating ${Number(trend.avg_rating).toFixed(1)}) in the last ${lookbackDays} days`,
        }),
        agent_ids: JSON.stringify([trend.agent_id]),
      },
      severity: Number(trend.negative_count) >= 5 ? 'high' : 'medium',
    });
  }

  // 2. Find agents with critical drift that don't have tightened policies
  const criticalDrift = await sql`
    SELECT agent_id, metric, z_score
    FROM drift_alerts
    WHERE org_id = ${orgId}
      AND severity = 'critical'
      AND acknowledged = false
    ORDER BY created_at DESC
    LIMIT 10
  ` as unknown as CriticalDriftRow[];

  for (const alert of criticalDrift) {
    if (alert.metric === 'risk_score') {
      suggestions.push({
        type: 'risk_threshold',
        trigger: 'critical_drift',
        agent_id: alert.agent_id,
        action_type: '*',
        evidence: {
          metric: alert.metric,
          z_score: Number(Number(alert.z_score).toFixed(1)),
        },
        suggested_policy: {
          name: `drift-guard-${alert.agent_id}`,
          policy_type: 'risk_threshold',
          rules: JSON.stringify({
            threshold: 50,
            action: 'require_approval',
            reason: `Critical risk score drift detected (z=${Number(alert.z_score).toFixed(1)})`,
          }),
          agent_ids: JSON.stringify([alert.agent_id]),
        },
        severity: 'high',
      });
    }
  }

  return suggestions;
}
