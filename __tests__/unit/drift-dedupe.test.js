/**
 * P14: re-running drift detection must UPDATE the open alert for the same
 * agent×metric×direction instead of inserting a duplicate (clicking
 * "Run detection" twice used to double every rail count). Snapshots dedupe
 * per agent×metric×day, baselines update-in-place per agent×metric, and the
 * zero-variance sentinel (z=±999) gets an honest description.
 *
 * The fake sql routes by query text and keeps in-memory tables, so the test
 * exercises the REAL detectDrift/recordSnapshots/acknowledgeAlert SQL flow.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { state, mockSql } = vi.hoisted(() => {
  const state = {
    baseline: null, // single drift_baselines row
    alerts: [],     // drift_alerts rows
    snapshots: [],  // drift_snapshots rows
    windowValues: [], // current-window values returned for action_records
    captured: [],   // [text, values] of tagged calls (for assertions)
  };
  const tagged = (strings, ...values) => {
    const text = strings.join(' ');
    state.captured.push([text, values]);
    if (text.includes('FROM drift_baselines')) {
      return Promise.resolve(state.baseline ? [state.baseline] : []);
    }
    if (text.includes('SELECT id FROM drift_alerts')) {
      // dedupe lookup: org, agent, metric, direction binds (acknowledged is inline)
      const [, agentId, metricId, direction] = values;
      const hit = state.alerts.find(
        (a) => a.agent_id === agentId && a.metric === metricId && a.direction === direction && !a.acknowledged
      );
      return Promise.resolve(hit ? [{ id: hit.id }] : []);
    }
    if (text.includes('INSERT INTO drift_alerts')) {
      const [id, orgId, agentId, metricId, severity, , bMean, bStd, cMean, cStd, z, pct, samples, direction, description] = values;
      state.alerts.push({ id, org_id: orgId, agent_id: agentId, metric: metricId, severity, baseline_mean: bMean, baseline_stddev: bStd, current_mean: cMean, current_stddev: cStd, z_score: z, pct_change: pct, sample_count: samples, direction, description, acknowledged: false });
      return Promise.resolve([]);
    }
    if (text.includes('UPDATE drift_alerts SET') && text.includes('severity =')) {
      const [severity, bMean, bStd, cMean, cStd, z, pct, samples, description, , id] = values;
      const row = state.alerts.find((a) => a.id === id);
      if (row) Object.assign(row, { severity, baseline_mean: bMean, baseline_stddev: bStd, current_mean: cMean, current_stddev: cStd, z_score: z, pct_change: pct, sample_count: samples, description });
      return Promise.resolve([]);
    }
    if (text.includes('UPDATE drift_alerts SET acknowledged')) {
      return Promise.resolve([]);
    }
    if (text.includes('SELECT * FROM drift_alerts')) {
      return Promise.resolve(state.alerts.slice(0, 1));
    }
    if (text.includes('SELECT id FROM drift_snapshots')) {
      const [, agentId, metricId] = values;
      const hit = state.snapshots.find((s) => s.agent_id === agentId && s.metric === metricId);
      return Promise.resolve(hit ? [{ id: hit.id }] : []);
    }
    if (text.includes('INSERT INTO drift_snapshots')) {
      const [id, orgId, agentId, metricId, period, periodStart, mean, stddev, samples] = values;
      state.snapshots.push({ id, org_id: orgId, agent_id: agentId, metric: metricId, period, period_start: periodStart, mean, stddev, sample_count: samples });
      return Promise.resolve([]);
    }
    if (text.includes('UPDATE drift_snapshots SET')) {
      const [mean, stddev, samples, , id] = values;
      const row = state.snapshots.find((s) => s.id === id);
      if (row) Object.assign(row, { mean, stddev, sample_count: samples });
      return Promise.resolve([]);
    }
    return Promise.resolve([]);
  };
  tagged.query = vi.fn(async (text) => {
    if (text.includes('FROM action_records')) return state.windowValues.map((v) => ({ val: v }));
    return [];
  });
  return { state, mockSql: tagged };
});

vi.mock('@/lib/db.js', () => ({ getSql: () => mockSql }));
vi.mock('@/lib/org.js', () => ({ getOrgId: () => 'org_test' }));

const { detectDrift, recordSnapshots, acknowledgeAlert } = await import('@/lib/drift.js');

const req = new Request('http://test/api/drift/alerts', { method: 'POST' });

beforeEach(() => {
  state.baseline = { id: 'bl_1', mean: 50, stddev: 10, sample_count: 10 };
  state.alerts.length = 0;
  state.snapshots.length = 0;
  state.windowValues = [78, 80, 82]; // mean 80 → z = (80-50)/10 = 3 → critical
  state.captured.length = 0;
  mockSql.query.mockClear();
});

describe('detectDrift dedupe', () => {
  it('first run inserts ONE open alert for the drifting agent×metric', async () => {
    const result = await detectDrift(req, { agent_id: 'a1' });
    // risk_score drifts; the other 5 metrics reuse the same baseline+window
    // fixture, so every metric alerts — what matters is COUNT PER METRIC.
    const riskAlerts = state.alerts.filter((a) => a.metric === 'risk_score');
    expect(riskAlerts).toHaveLength(1);
    expect(riskAlerts[0].severity).toBe('critical');
    expect(result.alerts.find((a) => a.metric === 'risk_score').updated).toBe(false);
  });

  it('re-running detection UPDATES the open alert instead of duplicating it', async () => {
    await detectDrift(req, { agent_id: 'a1' });
    const countAfterFirst = state.alerts.length;

    state.windowValues = [88, 90, 92]; // shift further: mean 90 → z 4
    const second = await detectDrift(req, { agent_id: 'a1' });

    expect(state.alerts.length).toBe(countAfterFirst); // no duplicates
    const risk = state.alerts.find((a) => a.metric === 'risk_score');
    expect(Number(risk.current_mean)).toBe(90); // evidence refreshed
    expect(second.alerts.find((a) => a.metric === 'risk_score').updated).toBe(true);
    // Response shape stays SDK-stable.
    expect(second.alerts_generated).toBe(second.alerts.length);
  });

  it('an acknowledged alert is NOT updated — a fresh open alert is created', async () => {
    await detectDrift(req, { agent_id: 'a1' });
    for (const a of state.alerts) a.acknowledged = true;
    await detectDrift(req, { agent_id: 'a1' });
    const riskAlerts = state.alerts.filter((a) => a.metric === 'risk_score');
    expect(riskAlerts).toHaveLength(2);
    expect(riskAlerts.filter((a) => !a.acknowledged)).toHaveLength(1);
  });

  it('zero-variance baseline (z sentinel) gets an honest description, not "z-score: 999"', async () => {
    state.baseline = { id: 'bl_1', mean: 50, stddev: 0, sample_count: 10 };
    await detectDrift(req, { agent_id: 'a1' });
    const risk = state.alerts.find((a) => a.metric === 'risk_score');
    expect(risk.description).toContain('no variance');
    expect(risk.description).not.toContain('999');
  });
});

describe('recordSnapshots per-day dedupe', () => {
  it('same-day re-run updates the day point instead of inserting another row', async () => {
    await recordSnapshots(req, { agent_id: 'a1' });
    const countAfterFirst = state.snapshots.length;
    expect(countAfterFirst).toBeGreaterThan(0);

    state.windowValues = [10, 20, 30];
    await recordSnapshots(req, { agent_id: 'a1' });
    expect(state.snapshots.length).toBe(countAfterFirst);
  });
});

describe('acknowledgeAlert identity', () => {
  it('stores the caller identity in acknowledged_by', async () => {
    state.alerts.push({ id: 'da_1', agent_id: 'a1', metric: 'risk_score', direction: 'increasing', acknowledged: false });
    await acknowledgeAlert(req, 'da_1', 'wes@example.com');
    const ackCall = state.captured.find(([text]) => text.includes('UPDATE drift_alerts SET acknowledged'));
    expect(ackCall).toBeTruthy();
    expect(ackCall[1]).toContain('wes@example.com');
  });

  it('falls back to a labeled API-key principal, never the meaningless "user"', async () => {
    await acknowledgeAlert(req, 'da_1');
    const ackCall = state.captured.filter(([text]) => text.includes('UPDATE drift_alerts SET acknowledged')).pop();
    expect(ackCall[1]).toContain('admin (api key)');
    expect(ackCall[1]).not.toContain('user');
  });
});
