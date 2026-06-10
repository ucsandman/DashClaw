import { listLearningRecommendations } from './repositories/learningLoop.repository';

type SqlClient = {
  (s: TemplateStringsArray, ...v: unknown[]): Promise<Record<string, unknown>[]>;
  query: (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
};

interface ConsolidateLessonsFilters {
  agentId?: string | null;
  actionType?: string | null;
  limit?: number;
}

interface LessonHints {
  risk_cap: unknown;
  prefer_reversible: unknown;
  confidence_floor: unknown;
  expected_duration: unknown;
  expected_cost: unknown;
}

interface Lesson {
  action_type: unknown;
  confidence: unknown;
  success_rate: unknown;
  hints: LessonHints;
  guidance: unknown;
  sample_size: unknown;
}

interface DriftWarning {
  metric: unknown;
  severity: unknown;
  z_score: string;
  direction: unknown;
}

// Missing-table tolerance shared with GET /api/learning: older installs may
// lack learning_recommendations or drift_alerts — consolidation degrades to
// empty sections instead of 500ing (this also covers the SDK's
// learningLessons() path through GET /api/learning/lessons).
function isMissingTable(err: unknown): boolean {
  return String((err as { code?: string })?.code || '').includes('42P01')
    || String((err as Error)?.message || '').includes('does not exist');
}

/**
 * Consolidate lessons for an agent — what DashClaw has learned from scored outcomes.
 */
export async function consolidateLessons(
  sql: SqlClient,
  orgId: string,
  { agentId, actionType, limit = 10 }: ConsolidateLessonsFilters,
): Promise<{ lessons: Lesson[]; drift_warnings: DriftWarning[]; agent_id: string | null | undefined }> {
  const lessons: Lesson[] = [];

  // 1. Top recommendations by confidence
  let recs: Awaited<ReturnType<typeof listLearningRecommendations>> = [];
  try {
    recs = await listLearningRecommendations(sql, orgId, {
      agentId: agentId ?? undefined,
      actionType: actionType ?? undefined,
      limit,
    });
  } catch (err) {
    if (!isMissingTable(err)) throw err;
  }

  for (const rec of recs || []) {
    const hints = (typeof rec.hints === 'string' ? JSON.parse(rec.hints) : rec.hints || {}) as Record<string, unknown>;
    const guidance = (typeof rec.guidance === 'string' ? JSON.parse(rec.guidance) : rec.guidance || {}) as Record<string, unknown>;

    lessons.push({
      action_type: rec.action_type,
      confidence: rec.confidence,
      success_rate: rec.success_rate,
      hints: {
        risk_cap: hints.risk_cap,
        prefer_reversible: hints.prefer_reversible,
        confidence_floor: hints.confidence_floor,
        expected_duration: hints.expected_duration,
        expected_cost: hints.expected_cost,
      },
      guidance: guidance.text || guidance.summary || null,
      sample_size: rec.sample_size,
    });
  }

  // 2. Recent drift warnings
  let driftAlerts: Record<string, unknown>[] = [];
  try {
    driftAlerts = await sql`
      SELECT metric, severity, z_score, direction, agent_id, action_type
      FROM drift_alerts
      WHERE org_id = ${orgId}
        AND (${agentId ? sql`agent_id = ${agentId}` : sql`TRUE`})
        AND acknowledged = false
        AND severity IN ('warning', 'critical')
      ORDER BY created_at DESC LIMIT 5
    `;
  } catch (err) {
    if (!isMissingTable(err)) throw err;
  }

  const drift_warnings: DriftWarning[] = driftAlerts.map((a) => ({
    metric: a.metric,
    severity: a.severity,
    z_score: Number(a.z_score).toFixed(1),
    direction: a.direction,
  }));

  return { lessons, drift_warnings, agent_id: agentId };
}
