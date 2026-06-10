import { buildRecommendationsFromEpisodes, scoreActionEpisode, toNumber, average } from './learning-loop';
import {
  clearLearningRecommendations,
  countEpisodesSinceLastRebuild,
  createLearningRecommendationEvents,
  getActionEpisodeSource,
  listLearningEpisodes,
  listLearningRecommendationEvents,
  upsertLearningEpisode,
  upsertLearningRecommendations,
} from './repositories/learningLoop.repository';
import type { SqlTag } from './types/db';

type Sql = SqlTag;

export async function scoreAndStoreActionEpisode(sql: Sql, orgId: string, actionId: string | null | undefined) {
  if (!actionId) return null;
  const source = await getActionEpisodeSource(sql, orgId, actionId);
  if (!source) return null;

  const scored = scoreActionEpisode(source);
  // EpisodeScore is structurally compatible with the repo's loose ScoredEpisode
  // (its fields are a subset of the [k: string]: unknown index shape).
  return upsertLearningEpisode(sql, orgId, source, scored as Parameters<typeof upsertLearningEpisode>[3]);
}

/**
 * Auto-rebuild recommendations when enough new episodes have accumulated.
 * Called inline after episode scoring — replaces the need for a cron job.
 * Returns null if not enough episodes, or the rebuild result.
 */
const REBUILD_THRESHOLD = 10;

export async function maybeRebuildRecommendations(sql: Sql, orgId: string) {
  const newCount = await countEpisodesSinceLastRebuild(sql, orgId);
  if (newCount < REBUILD_THRESHOLD) return null;
  return rebuildLearningRecommendations(sql, orgId, { lookbackDays: 90, minSamples: 3 });
}

interface RebuildOptions {
  agentId?: string;
  actionType?: string;
  lookbackDays?: number;
  episodeLimit?: number;
  minSamples?: number;
}

export async function rebuildLearningRecommendations(sql: Sql, orgId: string, options: RebuildOptions = {}) {
  const { agentId, actionType, lookbackDays = 30, episodeLimit = 5000, minSamples = 5 } = options;

  const episodes = await listLearningEpisodes(sql, orgId, {
    agentId,
    actionType,
    lookbackDays,
    limit: episodeLimit,
  });
  const recommendations = buildRecommendationsFromEpisodes(episodes, { minSamples });

  // Upsert-then-prune (atomic in effect): capture a batch timestamp before
  // writing, upsert every new recommendation (stamping updated_at = now),
  // then delete only rows whose updated_at is strictly older than the batch.
  // Previously clear-then-upsert left the table empty for the duration of the
  // rebuild — if the process crashed or Vercel timed out mid-upsert, agents
  // requesting recommendations got nothing until the next rebuild completed.
  const batchTime = new Date().toISOString();
  // Recommendation[] is structurally compatible with the repo's loose
  // RecommendationInput[] (all fields are subsets of its [k: string]: unknown shape).
  const saved = await upsertLearningRecommendations(sql, orgId, recommendations as Parameters<typeof upsertLearningRecommendations>[2]);
  await clearLearningRecommendations(sql, orgId, { agentId, actionType, olderThan: batchTime });

  return {
    episodes_scanned: episodes.length,
    recommendations: saved,
  };
}

interface RecommendationEventInput {
  [key: string]: unknown;
}

export async function recordLearningRecommendationEvents(sql: Sql, orgId: string, events: RecommendationEventInput[] = []) {
  if (!Array.isArray(events) || events.length === 0) return [];
  return createLearningRecommendationEvents(sql, orgId, events);
}


function rate(numerator: number, denominator: number): number {
  if (!denominator) return 0;
  return numerator / denominator;
}

interface EpisodeRow {
  outcome_label?: string | null;
  duration_ms?: number | string | null;
  cost_estimate?: number | string | null;
  score?: number | string | null;
  recommendation_id?: string | null;
  recommendation_applied?: unknown;
  agent_id?: string | null;
  action_type?: string | null;
  [key: string]: unknown;
}

interface OutcomeSummary {
  total: number;
  success: number;
  failure: number;
  success_rate: number;
  failure_rate: number;
  avg_duration_ms: number;
  avg_cost_estimate: number;
  avg_score: number;
}

function summarizeOutcomes(episodes: EpisodeRow[]): OutcomeSummary {
  const total = episodes.length;
  const success = episodes.filter((e) => e.outcome_label === 'success').length;
  const failure = episodes.filter((e) => e.outcome_label === 'failure').length;
  return {
    total,
    success,
    failure,
    success_rate: rate(success, total),
    failure_rate: rate(failure, total),
    avg_duration_ms: average(episodes.map((e) => toNumber(e.duration_ms, 0))),
    avg_cost_estimate: average(episodes.map((e) => toNumber(e.cost_estimate, 0))),
    avg_score: average(episodes.map((e) => toNumber(e.score, 0))),
  };
}

function isRecommendationApplied(value: unknown): boolean {
  return value === true || value === 1 || value === '1';
}

interface RecommendationRow {
  id?: string | null;
  agent_id?: string | null;
  action_type?: string | null;
  active?: unknown;
  confidence?: unknown;
  sample_size?: unknown;
  [key: string]: unknown;
}

interface RecommendationEventRow {
  recommendation_id?: string | null;
  event_type?: string | null;
  [key: string]: unknown;
}

interface MetricsOptions {
  recommendations?: RecommendationRow[];
  episodes?: EpisodeRow[];
  agentId?: string;
  actionType?: string;
  lookbackDays?: number;
}

export async function getLearningRecommendationMetrics(sql: Sql, orgId: string, options: MetricsOptions = {}) {
  const {
    recommendations = [],
    episodes = [],
    agentId,
    actionType,
    lookbackDays = 30,
  } = options;

  const events = await listLearningRecommendationEvents(sql, orgId, {
    agentId,
    actionType,
    lookbackDays,
    recommendationIds: recommendations.map((r) => r.id),
  }) as unknown as RecommendationEventRow[];

  const metrics = recommendations.map((rec) => {
    const recEvents = events.filter((event) => event.recommendation_id === rec.id);
    const fetchedCount = recEvents.filter((e) => e.event_type === 'fetched').length;
    const appliedCount = recEvents.filter((e) => e.event_type === 'applied').length;
    const overriddenCount = recEvents.filter((e) => e.event_type === 'overridden').length;
    const outcomeEventsCount = recEvents.filter((e) => e.event_type === 'outcome').length;

    const appliedEpisodes = episodes.filter(
      (episode) =>
        episode.recommendation_id === rec.id &&
        isRecommendationApplied(episode.recommendation_applied)
    );
    const baselineEpisodes = episodes.filter(
      (episode) =>
        episode.agent_id === rec.agent_id &&
        episode.action_type === rec.action_type &&
        !isRecommendationApplied(episode.recommendation_applied)
    );

    const appliedSummary = summarizeOutcomes(appliedEpisodes);
    const baselineSummary = summarizeOutcomes(baselineEpisodes);

    const adoptionRate = fetchedCount > 0
      ? rate(appliedCount, fetchedCount)
      : rate(appliedCount, appliedCount + overriddenCount);

    const successLift = appliedSummary.success_rate - baselineSummary.success_rate;
    const failureReduction = baselineSummary.failure_rate - appliedSummary.failure_rate;
    const latencyDeltaMs = appliedSummary.avg_duration_ms - baselineSummary.avg_duration_ms;
    const costDeltaEstimate = appliedSummary.avg_cost_estimate - baselineSummary.avg_cost_estimate;

    return {
      recommendation_id: rec.id,
      agent_id: rec.agent_id,
      action_type: rec.action_type,
      active: rec.active,
      confidence: rec.confidence,
      sample_size: rec.sample_size,
      telemetry: {
        fetched: fetchedCount,
        applied: appliedCount,
        overridden: overriddenCount,
        outcomes: outcomeEventsCount,
        adoption_rate: Number(adoptionRate.toFixed(4)),
      },
      outcomes: {
        applied: {
          total: appliedSummary.total,
          success_rate: Number(appliedSummary.success_rate.toFixed(4)),
          failure_rate: Number(appliedSummary.failure_rate.toFixed(4)),
          avg_score: Number(appliedSummary.avg_score.toFixed(2)),
          avg_duration_ms: Math.round(appliedSummary.avg_duration_ms),
          avg_cost_estimate: Number(appliedSummary.avg_cost_estimate.toFixed(4)),
        },
        baseline: {
          total: baselineSummary.total,
          success_rate: Number(baselineSummary.success_rate.toFixed(4)),
          failure_rate: Number(baselineSummary.failure_rate.toFixed(4)),
          avg_score: Number(baselineSummary.avg_score.toFixed(2)),
          avg_duration_ms: Math.round(baselineSummary.avg_duration_ms),
          avg_cost_estimate: Number(baselineSummary.avg_cost_estimate.toFixed(4)),
        },
      },
      deltas: {
        success_lift: Number(successLift.toFixed(4)),
        failure_reduction: Number(failureReduction.toFixed(4)),
        latency_delta_ms: Math.round(latencyDeltaMs),
        cost_delta_estimate: Number(costDeltaEstimate.toFixed(4)),
      },
    };
  });

  return {
    metrics,
    summary: {
      total_recommendations: metrics.length,
      active_recommendations: metrics.filter((m) => m.active).length,
      avg_adoption_rate: Number(
        average(metrics.map((m) => toNumber(m.telemetry.adoption_rate, 0))).toFixed(4)
      ),
      avg_success_lift: Number(
        average(metrics.map((m) => toNumber(m.deltas.success_lift, 0))).toFixed(4)
      ),
    },
  };
}
