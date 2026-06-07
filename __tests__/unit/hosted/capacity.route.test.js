import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { GET } = await import('../../../app/api/hosted/capacity/route.js');

describe('GET /api/hosted/capacity', () => {
  const originalEnv = { ...process.env };
  const mockSql = vi.fn();

  beforeEach(() => {
    process.env = { ...originalEnv };
    mockSql.mockReset();
    globalThis.__dashclaw_sql = mockSql;
  });

  afterEach(() => {
    delete globalThis.__dashclaw_sql;
    process.env = { ...originalEnv };
  });

  it('returns 404 when hosted mode is off', async () => {
    delete process.env.DASHCLAW_HOSTED;
    const res = await GET();
    expect(res.status).toBe(404);
  });

  it('returns 200 with full:false when under cap', async () => {
    process.env.DASHCLAW_HOSTED = 'true';
    mockSql.mockResolvedValueOnce([{ count: 3 }]);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ full: false, active: 3, max: 500 });
  });

  it('returns 200 with full:true when at cap', async () => {
    process.env.DASHCLAW_HOSTED = 'true';
    process.env.HOSTED_MAX_ACTIVE_TRIALS = '1';
    mockSql.mockResolvedValueOnce([{ count: 1 }]);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ full: true, active: 1, max: 1 });
  });
});
