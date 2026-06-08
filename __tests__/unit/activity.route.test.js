import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRequest } from '../helpers.js';

// app/api/activity/route.ts reads org via getOrgId(request) and runs two raw
// sql.query() calls directly through getSql() — no repository. The first call
// returns the activity-log rows (`events`), the second returns the stats row.
const { mockSqlQuery } = vi.hoisted(() => ({
  mockSqlQuery: vi.fn(),
}));

const mockSql = { query: mockSqlQuery };

vi.mock('@/lib/db.js', () => ({ getSql: () => mockSql }));
vi.mock('@/lib/org.js', () => ({ getOrgId: () => 'org_test' }));

import { GET } from '@/api/activity/route.js';

const defaultLogs = [
  { id: 'al_1', org_id: 'org_test', action: 'login', actor_id: 'u_1', actor_name: 'Ada' },
];
const defaultStats = [{ total: '1', today: '1', unique_actors: '1' }];

beforeEach(() => {
  vi.clearAllMocks();
  // First .query() -> logs, second .query() -> stats.
  mockSqlQuery
    .mockResolvedValueOnce(defaultLogs)
    .mockResolvedValueOnce(defaultStats);
});

function req(qs = '') {
  return makeRequest(`http://localhost/api/activity${qs}`, {
    headers: { 'x-org-id': 'org_test' },
  });
}

describe('GET /api/activity', () => {
  it('returns 200 with events, stats, and pagination', async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty('events');
    expect(body.events).toEqual(defaultLogs);
    expect(body).toHaveProperty('stats');
    expect(body.stats).toEqual(defaultStats[0]);
    expect(body).toHaveProperty('pagination');
  });

  it('defaults pagination to limit 50 / offset 0', async () => {
    const res = await GET(req());
    const body = await res.json();
    expect(body.pagination).toEqual({ limit: 50, offset: 0 });
  });

  it('honors limit/offset query params and clamps limit to 200', async () => {
    const res = await GET(req('?limit=999&offset=20'));
    const body = await res.json();
    expect(body.pagination).toEqual({ limit: 200, offset: 20 });
  });

  it('applies the action filter as a parameterized WHERE condition', async () => {
    await GET(req('?action=login'));
    // First call builds the logs query; org_id is always $1.
    const [logsText, logsParams] = mockSqlQuery.mock.calls[0];
    expect(logsText).toContain('al.action =');
    expect(logsParams[0]).toBe('org_test');
    expect(logsParams).toContain('login');
  });

  it('casts created_at to timestamptz for before/after and binds canonical ISO', async () => {
    await GET(req('?before=2026-01-01T00:00:00Z&after=2025-01-01T00:00:00Z'));
    const [logsText, logsParams] = mockSqlQuery.mock.calls[0];
    expect(logsText).toContain('al.created_at::timestamptz < ');
    expect(logsText).toContain('al.created_at::timestamptz > ');
    expect(logsParams).toContain('2026-01-01T00:00:00.000Z');
    expect(logsParams).toContain('2025-01-01T00:00:00.000Z');
  });

  it('returns 400 (not 500) for a malformed before/after timestamp', async () => {
    const res = await GET(req('?before=not-a-date'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('before');
    // No SQL should run when validation fails.
    expect(mockSqlQuery).not.toHaveBeenCalled();
  });

  it('falls back to default stats when the stats query returns no rows', async () => {
    mockSqlQuery.mockReset();
    mockSqlQuery
      .mockResolvedValueOnce(defaultLogs)
      .mockResolvedValueOnce([]); // empty stats result
    const res = await GET(req());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.stats).toEqual({ total: 0, today: 0, unique_actors: 0 });
  });

  it('returns 500 when the query throws', async () => {
    mockSqlQuery.mockReset();
    mockSqlQuery.mockRejectedValueOnce(new Error('DB down'));
    const res = await GET(req());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ error: 'Failed to fetch activity logs' });
  });
});
