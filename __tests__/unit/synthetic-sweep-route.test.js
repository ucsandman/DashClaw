/**
 * Cron route — retention GC for synthetic-agent test traffic. Mirrors the
 * jti-sweep / outcome-sweep auth pattern (CRON_SECRET bearer gate).
 */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { makeRequest } from '../helpers.js';

// timingSafeCompare is mocked below, so the actual token value is never
// compared — this just needs to be a truthy env var.
const FIXTURE_TOKEN = 'test-token';

const { mockSql, mockTimingSafeCompare, mockListActionIdsByFilter, mockDeleteActionsByIds } = vi.hoisted(() => ({
  mockSql: Object.assign(vi.fn(async () => []), { query: vi.fn(async () => []) }),
  mockTimingSafeCompare: vi.fn(),
  mockListActionIdsByFilter: vi.fn(),
  mockDeleteActionsByIds: vi.fn(),
}));

vi.mock('@/lib/db.js', () => ({ getSql: () => mockSql }));
vi.mock('@/lib/timing-safe.js', () => ({ timingSafeCompare: mockTimingSafeCompare }));
vi.mock('@/lib/repositories/actions.repository.js', () => ({
  listActionIdsByFilter: mockListActionIdsByFilter,
  deleteActionsByIds: mockDeleteActionsByIds,
}));

import { GET } from '@/api/cron/synthetic-sweep/route.js';

function req(headers = {}) {
  return makeRequest('http://localhost/api/cron/synthetic-sweep', { headers });
}

describe('/api/cron/synthetic-sweep', () => {
  const savedSecret = process.env.CRON_SECRET;
  const savedDays = process.env.DASHCLAW_SYNTHETIC_RETENTION_DAYS;
  const savedOrg = process.env.DASHCLAW_SYNTHETIC_SWEEP_ORG;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATABASE_URL = 'postgres://unit-test';
    process.env.CRON_SECRET = FIXTURE_TOKEN;
    delete process.env.DASHCLAW_SYNTHETIC_RETENTION_DAYS;
    delete process.env.DASHCLAW_SYNTHETIC_SWEEP_ORG;
    mockTimingSafeCompare.mockReturnValue(false);
    mockListActionIdsByFilter.mockResolvedValue([]);
    mockDeleteActionsByIds.mockResolvedValue([]);
  });

  afterEach(() => {
    if (savedSecret === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = savedSecret;
    if (savedDays === undefined) delete process.env.DASHCLAW_SYNTHETIC_RETENTION_DAYS; else process.env.DASHCLAW_SYNTHETIC_RETENTION_DAYS = savedDays;
    if (savedOrg === undefined) delete process.env.DASHCLAW_SYNTHETIC_SWEEP_ORG; else process.env.DASHCLAW_SYNTHETIC_SWEEP_ORG = savedOrg;
  });

  it('returns 503 when CRON_SECRET is missing', async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(req({ authorization: 'Bearer anything' }));
    expect(res.status).toBe(503);
  });

  it('returns 401 without a bearer header', async () => {
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(mockListActionIdsByFilter).not.toHaveBeenCalled();
  });

  it('returns 401 when the token does not match', async () => {
    const res = await GET(req({ authorization: 'Bearer wrong' }));
    expect(res.status).toBe(401);
  });

  it('deletes older-than-cutoff synthetic rows and reports the count', async () => {
    mockTimingSafeCompare.mockReturnValue(true);
    mockListActionIdsByFilter.mockResolvedValue(['act_1', 'act_2']);
    mockDeleteActionsByIds.mockResolvedValue([{ action_id: 'act_1' }, { action_id: 'act_2' }]);

    const res = await GET(req({ authorization: `Bearer ${FIXTURE_TOKEN}` }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.deleted).toBe(2);
    expect(data.org).toBe('org_default');
    expect(typeof data.cutoff).toBe('string');
    expect(mockDeleteActionsByIds).toHaveBeenCalledWith(mockSql, 'org_default', ['act_1', 'act_2']);
  });

  it('passes synthetic:true + before=cutoff to the filter, defaulting to a 7-day window and org_default', async () => {
    const now = new Date('2026-08-07T00:00:00.000Z');
    vi.useFakeTimers();
    vi.setSystemTime(now);
    mockTimingSafeCompare.mockReturnValue(true);

    await GET(req({ authorization: `Bearer ${FIXTURE_TOKEN}` }));

    expect(mockListActionIdsByFilter).toHaveBeenCalledWith(
      mockSql,
      'org_default',
      expect.objectContaining({ synthetic: true, before: expect.any(String) })
    );
    const [, , filter] = mockListActionIdsByFilter.mock.calls[0];
    expect(filter.before).toBe(new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString());
    vi.useRealTimers();
  });

  it('honors DASHCLAW_SYNTHETIC_RETENTION_DAYS and DASHCLAW_SYNTHETIC_SWEEP_ORG overrides', async () => {
    process.env.DASHCLAW_SYNTHETIC_RETENTION_DAYS = '3';
    process.env.DASHCLAW_SYNTHETIC_SWEEP_ORG = 'org_acme';
    mockTimingSafeCompare.mockReturnValue(true);

    const res = await GET(req({ authorization: `Bearer ${FIXTURE_TOKEN}` }));
    const data = await res.json();
    expect(data.org).toBe('org_acme');
    expect(mockListActionIdsByFilter).toHaveBeenCalledWith(
      mockSql,
      'org_acme',
      expect.objectContaining({ synthetic: true })
    );
  });
});
