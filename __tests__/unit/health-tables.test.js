import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRequest } from '../helpers.js';
import { CORE_TABLES } from '@/lib/schemaCheck';
import { REQUIRED_SETUP_COLUMNS, REQUIRED_SETUP_INDEXES } from '@/lib/setup/runtime-prerequisites.mjs';

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

const requiredColumns = REQUIRED_SETUP_COLUMNS.map((column) => `${column.table}.${column.name}`);
const requiredIndexes = REQUIRED_SETUP_INDEXES.map((index) => index.name);

function schemaResult({ tables = CORE_TABLES, indexes = requiredIndexes, columns = requiredColumns } = {}) {
  return [{ present_tables: tables, present_indexes: indexes, present_columns: columns }];
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.DATABASE_URL = 'postgres://unit-test';
  process.env.NEXTAUTH_SECRET = 'test-secret';
  mockGetRealtimeHealth.mockResolvedValue({ status: 'healthy', backend: 'memory' });
});

describe('/api/health core table checks', () => {
  it('returns healthy when all core tables exist', async () => {
    mockSql.mockResolvedValue(schemaResult());

    const res = await GET(makeRequest('http://localhost/api/health'));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.checks.database.status).toBe('healthy');
  });

  it('returns degraded when some core tables are missing', async () => {
    mockSql.mockResolvedValue(schemaResult({ tables: ['action_records'] }));

    const res = await GET(makeRequest('http://localhost/api/health'));
    expect(res.status).toBe(503);
    const data = await res.json();
    expect(data.status).toBe('degraded');
    expect(data.checks.database.status).toBe('degraded');
    expect(data.checks.database.missing_tables).toBe(CORE_TABLES.length - 1);
  });

  it('returns degraded when no core tables exist (fresh DB)', async () => {
    mockSql.mockResolvedValue(schemaResult({ tables: [], indexes: [], columns: [] }));

    const res = await GET(makeRequest('http://localhost/api/health'));
    expect(res.status).toBe(503);
    const data = await res.json();
    expect(data.checks.database.status).toBe('degraded');
    expect(data.checks.database.missing_tables).toBe(CORE_TABLES.length);
  });

  it('returns degraded and reports a missing required index when tables exist', async () => {
    mockSql.mockResolvedValue(schemaResult({ indexes: [] }));

    const res = await GET(makeRequest('http://localhost/api/health'));
    expect(res.status).toBe(503);
    const data = await res.json();
    expect(data.checks.database).toMatchObject({
      status: 'degraded',
      missing_tables: 0,
      missing_indexes: requiredIndexes.length,
      missing_columns: 0,
    });
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
