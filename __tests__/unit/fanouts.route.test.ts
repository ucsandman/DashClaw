/**
 * v4.3 fleet attribution — GET /api/agents/fanouts route.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRequest as rawRequest } from '../helpers.js';

const { mockSql, mockGetRecentFanouts } = vi.hoisted(() => ({
  mockSql: Object.assign(vi.fn(async () => []), { query: vi.fn(async () => []) }),
  mockGetRecentFanouts: vi.fn(),
}));

vi.mock('@/lib/db.js', () => ({ getSql: () => mockSql }));
vi.mock('@/lib/repositories/fanouts.repository.js', () => ({
  getRecentFanouts: mockGetRecentFanouts,
}));

import { GET } from '@/api/agents/fanouts/route.js';

const req = (url = 'http://localhost/api/agents/fanouts') =>
  rawRequest(url, { headers: { 'x-org-id': 'org_1' } }) as unknown as Request;

beforeEach(() => {
  vi.clearAllMocks();
  mockGetRecentFanouts.mockResolvedValue([]);
});

describe('GET /api/agents/fanouts', () => {
  it('returns the fan-out list with default 24h window and 20 limit', async () => {
    mockGetRecentFanouts.mockResolvedValue([
      {
        harness_session_id: 'hs_1',
        parent_agent_id: 'orchestrator',
        agents: ['orchestrator', 'orchestrator:reviewer'],
        agent_count: 2,
        spawn_count: 1,
        action_count: 7,
        linked_leaf_count: 3,
        first_at: '2026-07-04T00:00:00.000Z',
        last_at: '2026-07-04T01:00:00.000Z',
      },
    ]);
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.window_hours).toBe(24);
    expect((body.fanouts as unknown[]).length).toBe(1);
    expect(typeof body.lastUpdated).toBe('string');
    expect(mockGetRecentFanouts).toHaveBeenCalledWith(mockSql, 'org_1', { windowHours: 24, limit: 20, includeSynthetic: false });
  });

  it('clamps ?window_hours to 1..168', async () => {
    await GET(req('http://localhost/api/agents/fanouts?window_hours=9999'));
    expect(mockGetRecentFanouts).toHaveBeenCalledWith(mockSql, 'org_1', { windowHours: 168, limit: 20, includeSynthetic: false });
    await GET(req('http://localhost/api/agents/fanouts?window_hours=0'));
    expect(mockGetRecentFanouts).toHaveBeenCalledWith(mockSql, 'org_1', { windowHours: 1, limit: 20, includeSynthetic: false });
  });

  it('clamps ?limit to 1..100', async () => {
    await GET(req('http://localhost/api/agents/fanouts?limit=9999'));
    expect(mockGetRecentFanouts).toHaveBeenCalledWith(mockSql, 'org_1', { windowHours: 24, limit: 100, includeSynthetic: false });
    await GET(req('http://localhost/api/agents/fanouts?limit=0'));
    expect(mockGetRecentFanouts).toHaveBeenCalledWith(mockSql, 'org_1', { windowHours: 24, limit: 1, includeSynthetic: false });
  });

  it('?include_synthetic=1 is an ephemeral diagnostic view (flagged in response, passed to repository)', async () => {
    mockGetRecentFanouts.mockResolvedValue([]);
    const res = await GET(req('http://localhost/api/agents/fanouts?include_synthetic=1'));
    expect(mockGetRecentFanouts).toHaveBeenCalledWith(mockSql, 'org_1', { windowHours: 24, limit: 20, includeSynthetic: true });
    const body = await res.json() as Record<string, unknown>;
    expect(body.synthetic_included).toBe(true);
  });
});
