import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
global.fetch = mockFetch;

const { DashClaw } = await import('../../sdk/dashclaw.js');

function lastCall() {
  const [url, opts] = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
  return { url, method: opts.method, body: opts.body ? JSON.parse(opts.body) : undefined };
}

describe('DashClaw — Drift Detection SDK wrappers', () => {
  let claw;
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    claw = new DashClaw({ baseUrl: 'http://localhost:3000', apiKey: 'k', agentId: 'agent-1' });
  });

  it('detectDrift POSTs to /api/drift/alerts with action=detect and defaults', async () => {
    await claw.detectDrift();
    const c = lastCall();
    expect(c.method).toBe('POST');
    expect(c.url).toBe('http://localhost:3000/api/drift/alerts');
    expect(c.body.action).toBe('detect');
    expect(c.body.agent_id).toBeNull();
    expect(c.body.window_days).toBe(7);
  });

  it('detectDrift passes agentId and windowDays overrides', async () => {
    await claw.detectDrift({ agentId: 'agent-9', windowDays: 14 });
    const c = lastCall();
    expect(c.body.agent_id).toBe('agent-9');
    expect(c.body.window_days).toBe(14);
  });

  it('computeDriftBaselines POSTs to /api/drift/alerts with action=compute_baselines and defaults', async () => {
    await claw.computeDriftBaselines();
    const c = lastCall();
    expect(c.method).toBe('POST');
    expect(c.url).toBe('http://localhost:3000/api/drift/alerts');
    expect(c.body.action).toBe('compute_baselines');
    expect(c.body.agent_id).toBeNull();
    expect(c.body.lookback_days).toBe(30);
  });

  it('computeDriftBaselines passes agentId and lookbackDays overrides', async () => {
    await claw.computeDriftBaselines({ agentId: 'agent-3', lookbackDays: 60 });
    const c = lastCall();
    expect(c.body.agent_id).toBe('agent-3');
    expect(c.body.lookback_days).toBe(60);
  });

  it('recordDriftSnapshots POSTs to /api/drift/alerts with action=record_snapshots', async () => {
    await claw.recordDriftSnapshots();
    const c = lastCall();
    expect(c.method).toBe('POST');
    expect(c.url).toBe('http://localhost:3000/api/drift/alerts');
    expect(c.body).toEqual({ action: 'record_snapshots' });
  });

  it('listDriftAlerts GETs /api/drift/alerts with limit defaulting to 50 when called empty', async () => {
    await claw.listDriftAlerts();
    const c = lastCall();
    expect(c.method).toBe('GET');
    expect(c.url).toBe('http://localhost:3000/api/drift/alerts?limit=50');
  });

  it('listDriftAlerts serializes agentId, severity, acknowledged, and limit', async () => {
    await claw.listDriftAlerts({ agentId: 'agent-1', severity: 'high', acknowledged: false, limit: 10 });
    const c = lastCall();
    expect(c.method).toBe('GET');
    expect(c.url).toBe('http://localhost:3000/api/drift/alerts?agent_id=agent-1&severity=high&acknowledged=false&limit=10');
  });

  it('acknowledgeDriftAlert sends PATCH to /api/drift/alerts/:alertId', async () => {
    await claw.acknowledgeDriftAlert('alert_abc');
    const c = lastCall();
    expect(c.method).toBe('PATCH');
    expect(c.url).toBe('http://localhost:3000/api/drift/alerts/alert_abc');
  });

  it('deleteDriftAlert sends DELETE to /api/drift/alerts/:alertId', async () => {
    await claw.deleteDriftAlert('alert_xyz');
    const c = lastCall();
    expect(c.method).toBe('DELETE');
    expect(c.url).toBe('http://localhost:3000/api/drift/alerts/alert_xyz');
  });

  it('getDriftStats GETs /api/drift/stats with agent_id when provided', async () => {
    await claw.getDriftStats({ agentId: 'agent-2' });
    const c = lastCall();
    expect(c.method).toBe('GET');
    expect(c.url).toBe('http://localhost:3000/api/drift/stats?agent_id=agent-2');
  });

  it('getDriftStats GETs /api/drift/stats with no params when called empty', async () => {
    await claw.getDriftStats();
    const c = lastCall();
    expect(c.method).toBe('GET');
    expect(c.url).toBe('http://localhost:3000/api/drift/stats');
  });

  it('getDriftSnapshots GETs /api/drift/snapshots with limit defaulting to 30', async () => {
    await claw.getDriftSnapshots();
    const c = lastCall();
    expect(c.method).toBe('GET');
    expect(c.url).toBe('http://localhost:3000/api/drift/snapshots?limit=30');
  });

  it('getDriftSnapshots serializes agentId, metric, and limit', async () => {
    await claw.getDriftSnapshots({ agentId: 'agent-1', metric: 'block_rate', limit: 7 });
    const c = lastCall();
    expect(c.url).toBe('http://localhost:3000/api/drift/snapshots?agent_id=agent-1&metric=block_rate&limit=7');
  });

  it('getDriftMetrics GETs /api/drift/metrics', async () => {
    await claw.getDriftMetrics();
    const c = lastCall();
    expect(c.method).toBe('GET');
    expect(c.url).toBe('http://localhost:3000/api/drift/metrics');
  });

  it('getDriftReport GETs /api/actions/assumptions with drift=true', async () => {
    await claw.getDriftReport();
    const c = lastCall();
    expect(c.method).toBe('GET');
    expect(c.url).toBe('http://localhost:3000/api/actions/assumptions?drift=true');
  });

  it('getDriftReport merges extra filters with drift=true', async () => {
    await claw.getDriftReport({ agent_id: 'agent-1', limit: 25 });
    const c = lastCall();
    expect(c.url).toBe('http://localhost:3000/api/actions/assumptions?agent_id=agent-1&limit=25&drift=true');
  });
});
