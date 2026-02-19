import crypto from 'crypto';
import { getSql } from './db.js';
import { getOrgId } from './org.js';

// -----------------------------------------------
// Statistical Utilities (no external deps)
// -----------------------------------------------

function calcMean(arr) {
  if (arr.length === 0) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function calcStddev(arr, mean) {
  if (arr.length < 2) return 0;
  const variance = arr.reduce((s, v) => s + (v - mean) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(variance);
}

function calcPercentile(sorted, pct) {
  if (sorted.length === 0) return 0;
  const idx = (pct / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function calcStats(values) {
  if (values.length === 0) return { mean: 0, stddev: 0, median: 0, p5: 0, p25: 0, p75: 0, p95: 0, min_val: 0, max_val: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const mean = calcMean(sorted);
  return {
    mean: round(mean),
    stddev: round(calcStddev(sorted, mean)),
    median: round(calcPercentile(sorted, 50)),
    p5: round(calcPercentile(sorted, 5)),
    p25: round(calcPercentile(sorted, 25)),
    p75: round(calcPercentile(sorted, 75)),
    p95: round(calcPercentile(sorted, 95)),
    min_val: round(sorted[0]),
    max_val: round(sorted[sorted.length - 1]),
  };
}

function round(v) { return Math.round(v * 1000) / 1000; }

// Z-score: how many standard deviations the current mean is from baseline
function zScore(currentMean, baselineMean, baselineStddev) {
  if (baselineStddev === 0) return currentMean === baselineMean ? 0 : 999;
  return (currentMean - baselineMean) / baselineStddev;
}

// -----------------------------------------------
// Metrics we track for drift
// -----------------------------------------------

const DRIFT_METRICS = [
  { id: 'risk_score', label: 'Risk Score', source: 'action_records', column: 'risk_score', filter: 'risk_score IS NOT NULL' },
  { id: 'confidence', label: 'Confidence', source: 'action_records', column: 'confidence', filter: 'confidence IS NOT NULL' },
  { id: 'duration_ms', label: 'Duration (ms)', source: 'action_records', column: 'duration_ms', filter: 'duration_ms IS NOT NULL AND duration_ms > 0' },
  { id: 'cost_estimate', label: 'Cost Estimate', source: 'action_records', column: 'cost_estimate', filter: 'cost_estimate IS NOT NULL AND cost_estimate > 0' },
  { id: 'tokens_total', label: 'Total Tokens', source: 'action_records', column: '(tokens_in + tokens_out)', filter: '(tokens_in + tokens_out) > 0' },
  { id: 'learning_score', label: 'Learning Score', source: 'learning_episodes', column: 'score', filter: 'score IS NOT NULL' },
];

export function listMetrics() {
  return DRIFT_METRICS.map(m => ({ id: m.id, label: m.label }));
}

// -----------------------------------------------
// Severity thresholds (z-score based)
// -----------------------------------------------

const SEVERITY_THRESHOLDS = {
  info: 1.5,      // > 1.5 std devs
  warning: 2.0,   // > 2.0 std devs
  critical: 3.0,  // > 3.0 std devs
};

function classifySeverity(absZ) {
  if (absZ >= SEVERITY_THRESHOLDS.critical) return 'critical';
  if (absZ >= SEVERITY_THRESHOLDS.warning) return 'warning';
  if (absZ >= SEVERITY_THRESHOLDS.info) return 'info';
  return null; // no drift
}

// -----------------------------------------------
// Baseline Computation
// -----------------------------------------------

export async function computeBaselines(request, { agent_id, lookback_days } = {}) {
  const sql = getSql();
  const orgId = getOrgId(request);
  const days = lookback_days || 30;
  const results = [];

  for (const metric of DRIFT_METRICS) {
    const agents = agent_id ? [agent_id] : await getAgentIds(sql, orgId, metric.source);

    for (const agentId of agents) {
      let values;
      if (metric.source === 'action_records') {
        const rows = await sql.query(
          `SELECT ${metric.column} AS val FROM action_records WHERE org_id = $1 AND agent_name = $2 AND ${metric.filter} AND created_at::timestamptz >= NOW() - $3::interval ORDER BY created_at`,
          [orgId, agentId, `${days} days`]
        );
        values = rows.map(r => Number(r.val));
      } else if (metric.source === 'learning_episodes') {
        const rows = await sql.query(
          `SELECT ${metric.column} AS val FROM learning_episodes WHERE org_id = $1 AND agent_id = $2 AND ${metric.filter} AND created_at::timestamptz >= NOW() - $3::interval ORDER BY created_at`,
          [orgId, agentId, `${days} days`]
        );
        values = rows.map(r => Number(r.val));
      } else {
        continue;
      }

      if (values.length < 5) continue; // need minimum sample size

      const stats = calcStats(values);
      const id = 'db_' + crypto.randomBytes(12).toString('hex');

      // Build distribution buckets (10 buckets)
      const bucketCount = 10;
      const range = stats.max_val - stats.min_val || 1;
      const bucketSize = range / bucketCount;
      const distribution = {};
      for (let i = 0; i < bucketCount; i++) {
        const lo = round(stats.min_val + i * bucketSize);
        const hi = round(stats.min_val + (i + 1) * bucketSize);
        const count = values.filter(v => v >= lo && (i === bucketCount - 1 ? v <= hi : v < hi)).length;
        distribution[`${lo}-${hi}`] = count;
      }

      await sql`
        INSERT INTO drift_baselines (id, org_id, agent_id, metric, period_start, period_end, sample_count, mean, stddev, median, p5, p25, p75, p95, min_val, max_val, distribution)
        VALUES (${id}, ${orgId}, ${agentId}, ${metric.id}, ${new Date(Date.now() - days * 86400000).toISOString()}, ${new Date().toISOString()}, ${values.length}, ${stats.mean}, ${stats.stddev}, ${stats.median}, ${stats.p5}, ${stats.p25}, ${stats.p75}, ${stats.p95}, ${stats.min_val}, ${stats.max_val}, ${JSON.stringify(distribution)})
      `;

      results.push({ agent_id: agentId, metric: metric.id, sample_count: values.length, ...stats });
    }
  }

  return { baselines_computed: results.length, results };
}

async function getAgentIds(sql, orgId, source) {
  let rows;
  if (source === 'action_records') {
    rows = await sql`SELECT DISTINCT agent_name AS agent_id FROM action_records WHERE org_id = ${orgId} AND agent_name IS NOT NULL AND agent_name != '' LIMIT 50`;
  } else if (source === 'learning_episodes') {
    rows = await sql`SELECT DISTINCT agent_id FROM learning_episodes WHERE org_id = ${orgId} AND agent_id IS NOT NULL AND agent_id != '' LIMIT 50`;
  } else {
    return [];
  }
  return rows.map(r => r.agent_id);
}

// -----------------------------------------------
// Drift Detection (compare recent window vs baseline)
// -----------------------------------------------

export async function detectDrift(request, { agent_id, window_days, baseline_days } = {}) {
  const sql = getSql();
  const orgId = getOrgId(request);
  const windowDays = window_days || 7;
  const bDays = baseline_days || 30;
  const alerts = [];

  for (const metric of DRIFT_METRICS) {
    const agents = agent_id ? [agent_id] : await getAgentIds(sql, orgId, metric.source);

    for (const agentId of agents) {
      // Get latest baseline
      const baselineRows = await sql`
        SELECT * FROM drift_baselines
        WHERE org_id = ${orgId} AND agent_id = ${agentId} AND metric = ${metric.id}
        ORDER BY created_at DESC LIMIT 1
      `;
      if (baselineRows.length === 0) continue;
      const baseline = baselineRows[0];
      if (baseline.sample_count < 5) continue;

      // Get current window values
      let currentValues;
      if (metric.source === 'action_records') {
        const rows = await sql.query(
          `SELECT ${metric.column} AS val FROM action_records WHERE org_id = $1 AND agent_name = $2 AND ${metric.filter} AND created_at::timestamptz >= NOW() - $3::interval`,
          [orgId, agentId, `${windowDays} days`]
        );
        currentValues = rows.map(r => Number(r.val));
      } else if (metric.source === 'learning_episodes') {
        const rows = await sql.query(
          `SELECT ${metric.column} AS val FROM learning_episodes WHERE org_id = $1 AND agent_id = $2 AND ${metric.filter} AND created_at::timestamptz >= NOW() - $3::interval`,
          [orgId, agentId, `${windowDays} days`]
        );
        currentValues = rows.map(r => Number(r.val));
      } else {
        continue;
      }

      if (currentValues.length < 3) continue;

      const currentMean = round(calcMean(currentValues));
      const currentStddev = round(calcStddev(currentValues, currentMean));
      const z = round(zScore(currentMean, Number(baseline.mean), Number(baseline.stddev)));
      const absZ = Math.abs(z);
      const severity = classifySeverity(absZ);

      if (!severity) continue; // no significant drift

      const direction = z > 0 ? 'increasing' : 'decreasing';
      const pctChange = Number(baseline.mean) !== 0 ? round(((currentMean - Number(baseline.mean)) / Number(baseline.mean)) * 100) : 0;
      const id = 'da_' + crypto.randomBytes(12).toString('hex');

      const metricLabel = metric.label;
      const description = `${metricLabel} for ${agentId} has ${direction === 'increasing' ? 'increased' : 'decreased'} by ${Math.abs(pctChange)}% (z-score: ${z}). Baseline mean: ${baseline.mean}, current mean: ${currentMean}.`;

      await sql`
        INSERT INTO drift_alerts (id, org_id, agent_id, metric, severity, drift_type, baseline_mean, baseline_stddev, current_mean, current_stddev, z_score, pct_change, sample_count, direction, description, baseline_id)
        VALUES (${id}, ${orgId}, ${agentId}, ${metric.id}, ${severity}, ${'shift'}, ${Number(baseline.mean)}, ${Number(baseline.stddev)}, ${currentMean}, ${currentStddev}, ${z}, ${pctChange}, ${currentValues.length}, ${direction}, ${description}, ${baseline.id})
      `;

      alerts.push({ id, agent_id: agentId, metric: metric.id, severity, z_score: z, pct_change: pctChange, direction, description });
    }
  }

  return { alerts_generated: alerts.length, alerts };
}

// -----------------------------------------------
// Snapshot Recording (for trend charts)
// -----------------------------------------------

export async function recordSnapshots(request) {
  const sql = getSql();
  const orgId = getOrgId(request);
  const results = [];

  for (const metric of DRIFT_METRICS) {
    const agents = await getAgentIds(sql, orgId, metric.source);

    for (const agentId of agents) {
      let values;
      if (metric.source === 'action_records') {
        const rows = await sql.query(
          `SELECT ${metric.column} AS val FROM action_records WHERE org_id = $1 AND agent_name = $2 AND ${metric.filter} AND created_at::timestamptz >= NOW() - INTERVAL '1 day'`,
          [orgId, agentId]
        );
        values = rows.map(r => Number(r.val));
      } else if (metric.source === 'learning_episodes') {
        const rows = await sql.query(
          `SELECT ${metric.column} AS val FROM learning_episodes WHERE org_id = $1 AND agent_id = $2 AND ${metric.filter} AND created_at::timestamptz >= NOW() - INTERVAL '1 day'`,
          [orgId, agentId]
        );
        values = rows.map(r => Number(r.val));
      } else {
        continue;
      }

      if (values.length === 0) continue;

      const mean = round(calcMean(values));
      const stddev = round(calcStddev(values, mean));
      const id = 'ds_' + crypto.randomBytes(12).toString('hex');

      await sql`
        INSERT INTO drift_snapshots (id, org_id, agent_id, metric, period, period_start, mean, stddev, sample_count)
        VALUES (${id}, ${orgId}, ${agentId}, ${metric.id}, ${'daily'}, ${new Date(Date.now() - 86400000).toISOString()}, ${mean}, ${stddev}, ${values.length})
      `;

      results.push({ agent_id: agentId, metric: metric.id, mean, stddev, sample_count: values.length });
    }
  }

  return { snapshots_recorded: results.length, results };
}

// -----------------------------------------------
// Alert Management
// -----------------------------------------------

export async function listAlerts(request, { agent_id, severity, acknowledged, metric, limit, offset } = {}) {
  const sql = getSql();
  const orgId = getOrgId(request);
  const lim = Math.min(parseInt(limit || '50', 10), 200);
  const off = parseInt(offset || '0', 10);

  if (agent_id && severity) {
    return sql`SELECT * FROM drift_alerts WHERE org_id = ${orgId} AND agent_id = ${agent_id} AND severity = ${severity} ORDER BY created_at DESC LIMIT ${lim} OFFSET ${off}`;
  }
  if (agent_id) {
    return sql`SELECT * FROM drift_alerts WHERE org_id = ${orgId} AND agent_id = ${agent_id} ORDER BY created_at DESC LIMIT ${lim} OFFSET ${off}`;
  }
  if (severity) {
    return sql`SELECT * FROM drift_alerts WHERE org_id = ${orgId} AND severity = ${severity} ORDER BY created_at DESC LIMIT ${lim} OFFSET ${off}`;
  }
  if (acknowledged !== undefined) {
    const ack = acknowledged === 'true' || acknowledged === true;
    return sql`SELECT * FROM drift_alerts WHERE org_id = ${orgId} AND acknowledged = ${ack} ORDER BY created_at DESC LIMIT ${lim} OFFSET ${off}`;
  }

  return sql`SELECT * FROM drift_alerts WHERE org_id = ${orgId} ORDER BY created_at DESC LIMIT ${lim} OFFSET ${off}`;
}

export async function acknowledgeAlert(request, alertId) {
  const sql = getSql();
  const orgId = getOrgId(request);
  await sql`UPDATE drift_alerts SET acknowledged = TRUE, acknowledged_by = ${'user'}, acknowledged_at = NOW() WHERE id = ${alertId} AND org_id = ${orgId}`;
  const rows = await sql`SELECT * FROM drift_alerts WHERE id = ${alertId} AND org_id = ${orgId} LIMIT 1`;
  return rows[0] || null;
}

export async function deleteAlert(request, alertId) {
  const sql = getSql();
  const orgId = getOrgId(request);
  await sql`DELETE FROM drift_alerts WHERE id = ${alertId} AND org_id = ${orgId}`;
  return { deleted: true };
}

// -----------------------------------------------
// Stats & Analytics
// -----------------------------------------------

export async function getDriftStats(request, { agent_id } = {}) {
  const sql = getSql();
  const orgId = getOrgId(request);

  let overall;
  if (agent_id) {
    overall = await sql`
      SELECT
        COUNT(*) AS total_alerts,
        COUNT(*) FILTER (WHERE severity = 'critical') AS critical_count,
        COUNT(*) FILTER (WHERE severity = 'warning') AS warning_count,
        COUNT(*) FILTER (WHERE severity = 'info') AS info_count,
        COUNT(*) FILTER (WHERE acknowledged = FALSE) AS unacknowledged,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours') AS today_count
      FROM drift_alerts WHERE org_id = ${orgId} AND agent_id = ${agent_id}
    `;
  } else {
    overall = await sql`
      SELECT
        COUNT(*) AS total_alerts,
        COUNT(*) FILTER (WHERE severity = 'critical') AS critical_count,
        COUNT(*) FILTER (WHERE severity = 'warning') AS warning_count,
        COUNT(*) FILTER (WHERE severity = 'info') AS info_count,
        COUNT(*) FILTER (WHERE acknowledged = FALSE) AS unacknowledged,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours') AS today_count
      FROM drift_alerts WHERE org_id = ${orgId}
    `;
  }

  const byMetric = await sql`
    SELECT metric, COUNT(*) AS count, ROUND(AVG(ABS(z_score))::numeric, 2) AS avg_z_score
    FROM drift_alerts WHERE org_id = ${orgId}
    GROUP BY metric ORDER BY count DESC
  `;

  const byAgent = await sql`
    SELECT agent_id, COUNT(*) AS count,
      COUNT(*) FILTER (WHERE severity = 'critical') AS critical,
      COUNT(*) FILTER (WHERE severity = 'warning') AS warning
    FROM drift_alerts WHERE org_id = ${orgId}
    GROUP BY agent_id ORDER BY count DESC LIMIT 10
  `;

  const baselines = await sql`
    SELECT agent_id, metric, mean, stddev, sample_count, created_at
    FROM drift_baselines WHERE org_id = ${orgId}
    ORDER BY created_at DESC LIMIT 20
  `;

  return {
    overall: overall[0] || {},
    by_metric: byMetric,
    by_agent: byAgent,
    recent_baselines: baselines,
  };
}

export async function getSnapshots(request, { agent_id, metric, limit } = {}) {
  const sql = getSql();
  const orgId = getOrgId(request);
  const lim = Math.min(parseInt(limit || '30', 10), 100);

  if (agent_id && metric) {
    return sql`SELECT * FROM drift_snapshots WHERE org_id = ${orgId} AND agent_id = ${agent_id} AND metric = ${metric} ORDER BY period_start DESC LIMIT ${lim}`;
  }
  if (metric) {
    return sql`SELECT * FROM drift_snapshots WHERE org_id = ${orgId} AND metric = ${metric} ORDER BY period_start DESC LIMIT ${lim}`;
  }
  return sql`SELECT * FROM drift_snapshots WHERE org_id = ${orgId} ORDER BY period_start DESC LIMIT ${lim}`;
}
