import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRequest } from '../helpers.js';

const { mockSql, mockGetUsageSummary, mockGetUsageHistory } = vi.hoisted(() => ({
  mockSql: vi.fn(async () => []),
  mockGetUsageSummary: vi.fn(),
  mockGetUsageHistory: vi.fn(),
}));

vi.mock('@/lib/db.js', () => ({ getSql: () => mockSql }));
vi.mock('@/lib/org.js', () => ({ getOrgId: () => 'org_test' }));
vi.mock('@/lib/repositories/usage.repository.js', () => ({
  getUsageSummary: mockGetUsageSummary,
  getUsageHistory: mockGetUsageHistory,
}));

import { GET } from '@/api/usage/route.js';

const defaultSummary = {
  period: '2026-08',
  governed_actions: 42,
  blocked_actions: 3,
  seats: { users: 2, active_api_keys: 4 },
  plan: 'free',
  hosted_mode: true,
  trial: { action_cap: 10000, actions_used: 42 },
};

const defaultHistory = [
  { period: '2026-08', governed_actions: 42, blocked_actions: 3 },
  { period: '2026-07', governed_actions: 10, blocked_actions: 0 },
];

describe('GET /api/usage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetUsageSummary.mockResolvedValue(defaultSummary);
    mockGetUsageHistory.mockResolvedValue(defaultHistory);
  });

  it('returns the caller org usage summary with history and lastUpdated', async () => {
    const req = makeRequest('http://localhost/api/usage', {
      headers: { 'x-org-id': 'org_test' },
    });
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.org_id).toBe('org_test');
    expect(body.period).toBe('2026-08');
    expect(body.governed_actions).toBe(42);
    expect(body.blocked_actions).toBe(3);
    expect(body.seats).toEqual({ users: 2, active_api_keys: 4 });
    expect(body.trial).toEqual({ action_cap: 10000, actions_used: 42 });
    expect(body.history).toHaveLength(2);
    expect(body).toHaveProperty('lastUpdated');
  });

  it('scopes both repository calls to the resolved org', async () => {
    const req = makeRequest('http://localhost/api/usage', {
      headers: { 'x-org-id': 'org_test' },
    });
    await GET(req);
    expect(mockGetUsageSummary).toHaveBeenCalledWith(mockSql, 'org_test');
    expect(mockGetUsageHistory).toHaveBeenCalledWith(mockSql, 'org_test', 12);
  });

  it('returns 500 with an error body when the repository throws', async () => {
    mockGetUsageSummary.mockRejectedValue(new Error('db down'));
    const req = makeRequest('http://localhost/api/usage', {
      headers: { 'x-org-id': 'org_test' },
    });
    const res = await GET(req);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toHaveProperty('error');
  });
});
