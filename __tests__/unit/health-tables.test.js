import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRequest } from '../helpers.js';

const {
  mockSql,
  mockGetRealtimeHealth,
} = vi.hoisted(() => ({
  mockSql: Object.assign(vi.fn(async () => []), { query: vi.fn(async () => []) }),
  mockGetRealtimeHealth: vi.fn(),
}));

vi.mock('@/lib/db.js', () => ({ getSql: () => mockSql }));
vi.mock('@/lib/events.js', () => ({ getRealtimeHealth: mockGetRealtimeHealth }));
vi.mock('../../package.json', () => ({ version: '1.0.0-test' }), { virtual: true });

import { GET } from '@/api/health/route.js';

beforeEach(() => {
  vi.clearAllMocks();
  process.env.DATABASE_URL = 'postgres://unit-test';
  process.env.NEXTAUTH_SECRET = 'test-secret';
  mockGetRealtimeHealth.mockResolvedValue({ status: 'healthy', backend: 'memory' });
});

describe('/api/health core table checks', () => {
  it('returns healthy when all core tables exist', async () => {
    mockSql.mockResolvedValue([
      { table_name: 'action_records' },
      { table_name: 'guard_decisions' },
      { table_name: 'api_keys' },
      { table_name: 'users' },
      { table_name: 'settings' },
      { table_name: 'guard_policies' },
    ]);

    const res = await GET(makeRequest('http://localhost/api/health'));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.checks.database.status).toBe('healthy');
  });

  it('returns degraded when some core tables are missing', async () => {
    mockSql.mockResolvedValue([
      { table_name: 'action_records' },
      // guard_decisions, api_keys, org_members, settings, policies missing
    ]);

    const res = await GET(makeRequest('http://localhost/api/health'));
    expect(res.status).toBe(503);
    const data = await res.json();
    expect(data.status).toBe('degraded');
    expect(data.checks.database.status).toBe('degraded');
    expect(data.checks.database.missing_tables).toBe(5);
  });

  it('returns degraded when no core tables exist (fresh DB)', async () => {
    mockSql.mockResolvedValue([]);

    const res = await GET(makeRequest('http://localhost/api/health'));
    expect(res.status).toBe(503);
    const data = await res.json();
    expect(data.checks.database.status).toBe('degraded');
    expect(data.checks.database.missing_tables).toBe(6);
  });

  it('returns unhealthy when DB query throws', async () => {
    mockSql.mockRejectedValue(new Error('connection refused'));

    const res = await GET(makeRequest('http://localhost/api/health'));
    expect(res.status).toBe(503);
    const data = await res.json();
    expect(data.checks.database.status).toBe('unhealthy');
    // Should not leak error details
    expect(JSON.stringify(data.checks.database)).not.toContain('connection refused');
  });
});
