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

// Health route uses createRequire for package.json — mock the module version
vi.mock('../../package.json', () => ({ version: '1.0.0-test' }), { virtual: true });

import { GET } from '@/api/health/route.js';

beforeEach(() => {
  vi.clearAllMocks();
  process.env.DATABASE_URL = 'postgres://unit-test';
  process.env.NEXTAUTH_SECRET = 'test-secret';
  mockSql.mockImplementation(async () => [
    {
      present_tables: CORE_TABLES,
      present_indexes: REQUIRED_SETUP_INDEXES.map((index) => index.name),
      present_columns: REQUIRED_SETUP_COLUMNS.map((column) => `${column.table}.${column.name}`),
    },
  ]);
  mockGetRealtimeHealth.mockResolvedValue({ status: 'healthy', backend: 'redis' });
});

describe('/api/health GET', () => {
  it('returns 200 and healthy status when all checks pass', async () => {
    const res = await GET(makeRequest('http://localhost/api/health', {}));

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe('healthy');
    expect(data.checks.database.status).toBe('healthy');
    expect(data.checks.environment.status).toBe('healthy');
    expect(data.checks.realtime.status).toBe('healthy');
  });

  it('returns 503 when database is unhealthy', async () => {
    mockSql.mockRejectedValue(new Error('connection refused'));

    const res = await GET(makeRequest('http://localhost/api/health', {}));

    expect(res.status).toBe(503);
    const data = await res.json();
    expect(data.status).toBe('degraded');
    expect(data.checks.database.status).toBe('unhealthy');
    // Should not leak backend error details on a public endpoint
    expect(JSON.stringify(data.checks.database)).not.toContain('connection refused');
  });

  it('returns 503 when realtime backend is unhealthy', async () => {
    mockGetRealtimeHealth.mockResolvedValue({ status: 'unhealthy', backend: 'redis' });

    const res = await GET(makeRequest('http://localhost/api/health', {}));

    expect(res.status).toBe(503);
    const data = await res.json();
    expect(data.status).toBe('degraded');
  });

  it('returns 503 when required env vars are missing', async () => {
    delete process.env.NEXTAUTH_SECRET;

    const res = await GET(makeRequest('http://localhost/api/health', {}));

    expect(res.status).toBe(503);
    const data = await res.json();
    expect(data.checks.environment.status).toBe('unhealthy');
    // Should not list the actual missing variable names in detail
    expect(data.checks.environment.missing).toBeGreaterThan(0);
  });

  it('includes runtime checks', async () => {
    const res = await GET(makeRequest('http://localhost/api/health', {}));
    const data = await res.json();
    expect(data.checks.runtime).toBeDefined();
    expect(data.checks.runtime.node_env).toBeDefined();
  });

  it('includes timestamp and version', async () => {
    const res = await GET(makeRequest('http://localhost/api/health', {}));
    const data = await res.json();
    expect(data.timestamp).toBeDefined();
    expect(data.version).toBeDefined();
  });

  it('reports mode=live when neither demo env var is set', async () => {
    delete process.env.DASHCLAW_MODE;
    delete process.env.NEXT_PUBLIC_DASHCLAW_MODE;

    const res = await GET(makeRequest('http://localhost/api/health', {}));
    const data = await res.json();
    expect(data.mode).toBe('live');
  });

  it('reports mode=demo when DASHCLAW_MODE=demo (server signal)', async () => {
    process.env.DASHCLAW_MODE = 'demo';

    const res = await GET(makeRequest('http://localhost/api/health', {}));
    const data = await res.json();
    expect(data.mode).toBe('demo');

    delete process.env.DASHCLAW_MODE;
  });

  it('reports mode=demo when NEXT_PUBLIC_DASHCLAW_MODE=demo (browser-aligned signal)', async () => {
    process.env.NEXT_PUBLIC_DASHCLAW_MODE = 'demo';

    const res = await GET(makeRequest('http://localhost/api/health', {}));
    const data = await res.json();
    expect(data.mode).toBe('demo');

    delete process.env.NEXT_PUBLIC_DASHCLAW_MODE;
  });

  it('degrades gracefully when realtime health check throws', async () => {
    mockGetRealtimeHealth.mockRejectedValue(new Error('redis timeout'));

    const res = await GET(makeRequest('http://localhost/api/health', {}));

    expect(res.status).toBe(503);
    const data = await res.json();
    expect(data.checks.realtime.status).toBe('unhealthy');
    // Should not leak the redis timeout error message
    expect(JSON.stringify(data.checks.realtime)).not.toContain('redis timeout');
  });
});
