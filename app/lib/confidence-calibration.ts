/**
 * Predicted vs actual — scoring an agent's own stated confidence against what
 * actually completed.
 *
 * Every governed action already carries the prediction (`action_records.confidence`,
 * 0-100) and the actual (`action_records.outcome_status`). This module is the join,
 * kept pure so the arithmetic is unit-testable without a database.
 *
 * The one rule that shapes everything here: **50 is the column default, not a
 * statement.** Hooks never send a confidence; only MCP `dashclaw_record` and SDK
 * callers do. Scoring a defaulted row would manufacture a verdict out of a value
 * no agent ever chose, so rows at exactly 50 are excluded upstream (the repository
 * query) and reported instead as coverage: how many closed actions actually carried
 * a stated confidence. A check must carry the volume it processed.
 */

type Row = Record<string, unknown>;

export type CalibrationVerdict = 'overconfident' | 'underconfident' | 'calibrated' | 'insufficient';

export type CalibrationBucketKey = 'lt50' | 'b50_69' | 'b70_89' | 'b90_plus';

export interface CalibrationBucket {
  bucket: CalibrationBucketKey;
  label: string;
  n: number;
  stated_avg: number;
  observed_rate: number;
  gap: number;
}

export interface CalibrationSummary {
  n: number;
  stated_avg: number;
  observed_rate: number;
  gap: number;
  verdict: CalibrationVerdict;
}

export interface CalibrationCoverage {
  closed: number;
  stated: number;
}

export interface AgentCalibration extends CalibrationSummary {
  agent_id: string;
  agent_name: string | null;
  buckets: CalibrationBucket[];
  coverage: CalibrationCoverage;
}

export interface ConfidenceCalibration {
  window_days: number;
  coverage: CalibrationCoverage;
  overall: CalibrationSummary;
  agents: AgentCalibration[];
}

/** Below this many scored actions a verdict would be noise, so we decline to give one. */
export const MIN_SCORED = 10;
/** Stated-minus-observed points that separate "calibrated" from a real bias. */
export const GAP_THRESHOLD = 20;

const BUCKET_ORDER: CalibrationBucketKey[] = ['lt50', 'b50_69', 'b70_89', 'b90_plus'];

const BUCKET_LABELS: Record<CalibrationBucketKey, string> = {
  lt50: 'Under 50',
  b50_69: '50 to 69',
  b70_89: '70 to 89',
  b90_plus: '90 and up',
};

/** Postgres numerics arrive as strings over some drivers; null/undefined mean zero. */
function num(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Raw running totals. Rounding happens once, at the end, from these — averaging
 * already-rounded bucket percentages would drift from the true weighted mean.
 */
interface Aggregate {
  n: number;
  completed: number;
  /** Σ(avg_confidence × n) — the numerator of the weighted stated mean. */
  weighted: number;
}

function emptyAggregate(): Aggregate {
  return { n: 0, completed: 0, weighted: 0 };
}

function verdictFor(n: number, gap: number): CalibrationVerdict {
  // Volume gate first: nine wildly overconfident actions are still nine actions.
  if (n < MIN_SCORED) return 'insufficient';
  if (gap >= GAP_THRESHOLD) return 'overconfident';
  if (gap <= -GAP_THRESHOLD) return 'underconfident';
  return 'calibrated';
}

function summarize(agg: Aggregate): CalibrationSummary {
  const stated_avg = agg.n > 0 ? Math.round(agg.weighted / agg.n) : 0;
  const observed_rate = agg.n > 0 ? Math.round((agg.completed / agg.n) * 100) : 0;
  const gap = stated_avg - observed_rate;
  return { n: agg.n, stated_avg, observed_rate, gap, verdict: verdictFor(agg.n, gap) };
}

interface AgentAccumulator {
  agent_id: string;
  agent_name: string | null;
  totals: Aggregate;
  buckets: Map<CalibrationBucketKey, Aggregate>;
}

function isBucketKey(value: unknown): value is CalibrationBucketKey {
  return BUCKET_ORDER.includes(value as CalibrationBucketKey);
}

/**
 * Fold the two repository result sets into the shape `/decisions` renders.
 *
 * `bucketRows` are the scored actions (confidence <> 50), grouped by agent and
 * confidence bucket. `coverageRows` are every closed action per agent with a
 * count of how many of them stated a confidence — that is the honest denominator,
 * and it is reported whether or not there is enough to score.
 *
 * Agents come from `bucketRows` only: an agent that closed actions but stated no
 * confidence has nothing to score, and a row of dashes per silent agent would be
 * noise. Their volume still lands in `coverage`.
 */
export function buildConfidenceCalibration(
  bucketRows: Row[],
  coverageRows: Row[],
  windowDays: number,
): ConfidenceCalibration {
  const coverage: CalibrationCoverage = { closed: 0, stated: 0 };
  const coverageByAgent = new Map<string, CalibrationCoverage>();

  for (const row of Array.isArray(coverageRows) ? coverageRows : []) {
    const agentId = String(row?.agent_id ?? '');
    const closed = num(row?.closed);
    const stated = num(row?.stated);
    coverage.closed += closed;
    coverage.stated += stated;
    const existing = coverageByAgent.get(agentId);
    if (existing) {
      existing.closed += closed;
      existing.stated += stated;
    } else {
      coverageByAgent.set(agentId, { closed, stated });
    }
  }

  const overall = emptyAggregate();
  const byAgent = new Map<string, AgentAccumulator>();

  for (const row of Array.isArray(bucketRows) ? bucketRows : []) {
    const n = num(row?.n);
    if (n <= 0) continue;
    const bucket = row?.bucket;
    if (!isBucketKey(bucket)) continue;

    const agentId = String(row?.agent_id ?? '');
    const completed = num(row?.completed);
    const weighted = num(row?.avg_confidence) * n;

    let agent = byAgent.get(agentId);
    if (!agent) {
      agent = { agent_id: agentId, agent_name: null, totals: emptyAggregate(), buckets: new Map() };
      byAgent.set(agentId, agent);
    }
    // MAX(agent_name) over an all-NULL group is null; the UI falls back to the id.
    if (agent.agent_name === null && row?.agent_name != null) agent.agent_name = String(row.agent_name);

    const bucketAgg = agent.buckets.get(bucket) ?? emptyAggregate();
    bucketAgg.n += n;
    bucketAgg.completed += completed;
    bucketAgg.weighted += weighted;
    agent.buckets.set(bucket, bucketAgg);

    agent.totals.n += n;
    agent.totals.completed += completed;
    agent.totals.weighted += weighted;

    overall.n += n;
    overall.completed += completed;
    overall.weighted += weighted;
  }

  const agents: AgentCalibration[] = [...byAgent.values()].map((agent) => ({
    agent_id: agent.agent_id,
    agent_name: agent.agent_name,
    ...summarize(agent.totals),
    buckets: BUCKET_ORDER.flatMap((key) => {
      const agg = agent.buckets.get(key);
      if (!agg || agg.n <= 0) return [];
      const { stated_avg, observed_rate, gap } = summarize(agg);
      return [{ bucket: key, label: BUCKET_LABELS[key], n: agg.n, stated_avg, observed_rate, gap }];
    }),
    coverage: coverageByAgent.get(agent.agent_id) ?? { closed: 0, stated: 0 },
  }));

  // The agents worth looking at first are the ones claiming more than they deliver.
  agents.sort(
    (a, b) =>
      (b.verdict === 'overconfident' ? 1 : 0) - (a.verdict === 'overconfident' ? 1 : 0) ||
      b.n - a.n,
  );

  return { window_days: windowDays, coverage, overall: summarize(overall), agents };
}
