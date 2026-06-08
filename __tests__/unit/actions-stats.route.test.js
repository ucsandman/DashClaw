import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRequest } from '../helpers.js';

const { mockSql, mockGetActionStats } = vi.hoisted(() => ({
  mockSql: vi.fn(async () => []),
  mockGetActionStats: vi.fn(),
}));

vi.mock('@/lib/db.js', () => ({ getSql: () => mockSql }));
vi.mock('@/lib/org.js', () => ({ getOrgId: () => 'org_test' }));
vi.mock('@/lib/repositories/actions.repository.js', () => ({
  getActionStats: mockGetActionStats,
}));

import { GET } from '@/api/actions/stats/route.js';

const defaultStats = {
  current: {
    total: 10,
    completed: 6,
    failed: 2,
    blocked: 1,
    cancelled: 0,
    approval: 1,
  },
  previousTotal: 5,
};

describe('GET /api/actions/stats', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetActionStats.mockResolvedValue(defaultStats);
  });

  it('returns 200 with current stats spread plus change_percent and lastUpdated', async () => {
    const req = makeRequest('http://localhost/api/actions/stats', {
      headers: { 'x-org-id': 'org_test' },
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    // current stats are spread onto the body
    expect(body).toHaveProperty('total', 10);
    expect(body).toHaveProperty('completed', 6);
    // (10 - 5) / 5 * 100 = 100
    expect(body.change_percent).toBe(100);
    expect(body).toHaveProperty('lastUpdated');
  });

  it('passes the agent_id query param through to getActionStats', async () => {
    const req = makeRequest(
      'http://localhost/api/actions/stats?agent_id=agent_42',
      { headers: { 'x-org-id': 'org_test' } },
    );
    const res = await GET(req);
    expect(res.status).toBe(200);
    // signature: (sql, orgId, agentId)
    expect(mockGetActionStats).toHaveBeenCalledWith(mockSql, 'org_test', 'agent_42');
  });

  it('defaults agent_id to null when the query param is absent', async () => {
    const req = makeRequest('http://localhost/api/actions/stats', {
      headers: { 'x-org-id': 'org_test' },
    });
    await GET(req);
    expect(mockGetActionStats).toHaveBeenCalledWith(mockSql, 'org_test', null);
  });

  it('reports change_percent of 0 when there is no current or previous activity', async () => {
    mockGetActionStats.mockResolvedValue({
      current: { total: 0, completed: 0, failed: 0, blocked: 0, cancelled: 0, approval: 0 },
      previousTotal: 0,
    });
    const req = makeRequest('http://localhost/api/actions/stats', {
      headers: { 'x-org-id': 'org_test' },
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.change_percent).toBe(0);
    expect(body.total).toBe(0);
  });

  it('returns 500 with a safe zeroed payload when the repository throws', async () => {
    mockGetActionStats.mockRejectedValue(new Error('db down'));
    const req = makeRequest('http://localhost/api/actions/stats', {
      headers: { 'x-org-id': 'org_test' },
    });
    const res = await GET(req);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toHaveProperty('error');
    expect(body.total).toBe(0);
    expect(body.change_percent).toBe(0);
  });
});
