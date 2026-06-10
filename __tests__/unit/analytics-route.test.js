import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRequest } from '../helpers.js';

const mockGetOrgId = vi.fn(() => 'org_test');
const mockSqlInstance = vi.fn();
const mockGetAnalytics = vi.fn();

vi.mock('../../app/lib/db.js', () => ({ getSql: () => mockSqlInstance }));
vi.mock('../../app/lib/org.js', () => ({ getOrgId: (...a) => mockGetOrgId(...a) }));
vi.mock('../../app/lib/repositories/analytics.repository.js', () => ({
  getAnalytics: (...a) => mockGetAnalytics(...a),
}));

const { GET } = await import('../../app/api/analytics/route.js');

function getReq(params = '') {
  return makeRequest(`http://localhost:3000/api/analytics${params}`, {
    headers: { 'x-api-key': 'oc_live_test' },
  });
}

describe('GET /api/analytics', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns analytics data with default 30 days', async () => {
    const mockData = {
      period: { start: '2026-03-10', end: '2026-04-09', days: 30 },
      hero: { total_cost: 14.82, total_actions: 4231, active_agents: 23, avg_latency_ms: 2100, prev_cost: 13.20, prev_actions: 3920, prev_agents: 21, prev_latency_ms: 2470 },
      daily: [],
      by_agent: [],
      by_action_type: [],
      policy_enforcement: { blocked: 0, require_approval: 0, warn: 0, total: 0 },
      tokens: { total_in: 0, total_out: 0, total: 0, cost_per_million: 0, top_consumers: [] },
    };
    mockGetAnalytics.mockResolvedValueOnce(mockData);

    const res = await GET(getReq());
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.hero.total_cost).toBe(14.82);
    expect(data.hero.total_actions).toBe(4231);
    expect(mockGetAnalytics).toHaveBeenCalledWith(expect.anything(), 'org_test', 30, null);
  });

  it('passes custom days parameter', async () => {
    mockGetAnalytics.mockResolvedValueOnce({ period: {}, hero: {}, daily: [], by_agent: [], by_action_type: [], policy_enforcement: {}, tokens: {} });

    await GET(getReq('?days=7'));

    expect(mockGetAnalytics).toHaveBeenCalledWith(expect.anything(), 'org_test', 7, null);
  });

  it('clamps days to 1-365', async () => {
    mockGetAnalytics.mockResolvedValueOnce({ period: {}, hero: {}, daily: [], by_agent: [], by_action_type: [], policy_enforcement: {}, tokens: {} });

    await GET(getReq('?days=999'));

    expect(mockGetAnalytics).toHaveBeenCalledWith(expect.anything(), 'org_test', 365, null);
  });

  it('forwards agent_id to the repository (global agent picker)', async () => {
    mockGetAnalytics.mockResolvedValueOnce({ period: {}, hero: {}, daily: [], by_agent: [], by_action_type: [], policy_enforcement: {}, tokens: {} });

    await GET(getReq('?days=7&agent_id=agent-1'));

    expect(mockGetAnalytics).toHaveBeenCalledWith(expect.anything(), 'org_test', 7, 'agent-1');
  });

  it('falls back to 30 days when days is non-numeric (no NaN reaches the repository)', async () => {
    mockGetAnalytics.mockResolvedValueOnce({ period: {}, hero: {}, daily: [], by_agent: [], by_action_type: [], policy_enforcement: {}, tokens: {} });

    const res = await GET(getReq('?days=abc'));

    expect(res.status).toBe(200);
    expect(mockGetAnalytics).toHaveBeenCalledWith(expect.anything(), 'org_test', 30, null);
  });

  it('returns 500 on error', async () => {
    mockGetAnalytics.mockRejectedValueOnce(new Error('DB down'));

    const res = await GET(getReq());
    expect(res.status).toBe(500);
  });
});
