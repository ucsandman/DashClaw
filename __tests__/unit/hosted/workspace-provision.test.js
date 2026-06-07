import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  provisionHostedWorkspace,
  getHostedWorkspace,
  deleteHostedWorkspace,
  findExpiredWorkspaces,
} from '../../../app/lib/repositories/hosted-workspace.repository.js';

function createSqlMock() {
  return vi.fn();
}

describe('hosted-workspace repository', () => {
  let sql;
  beforeEach(() => {
    sql = createSqlMock();
  });

  it('provisionHostedWorkspace creates org + api_key and returns plaintext key once', async () => {
    sql.mockResolvedValueOnce([]); // org insert
    sql.mockResolvedValueOnce([]); // api_key insert
    const res = await provisionHostedWorkspace(sql, {
      trialDays: 30,
      trialActionCap: 10000,
      label: 'trial',
    });
    expect(res.orgId).toMatch(/^org_/);
    expect(res.apiKey).toMatch(/^oc_live_[0-9a-f]{32}$/);
    expect(res.keyPrefix).toMatch(/^oc_live_/);
    expect(res.expiresAt).toBeTypeOf('string');
    expect(sql.mock.calls.length).toBe(2);
  });

  it('provisionHostedWorkspace propagates errors from inserts', async () => {
    sql.mockRejectedValueOnce(new Error('db down'));
    await expect(
      provisionHostedWorkspace(sql, { trialDays: 30, trialActionCap: 10000 }),
    ).rejects.toThrow(/db down/);
  });

  it('provisionHostedWorkspace cleans up org when api_key insert fails (3-call invariant)', async () => {
    sql.mockResolvedValueOnce([]); // org INSERT succeeds
    sql.mockRejectedValueOnce(new Error('key fail')); // api_key INSERT fails
    sql.mockResolvedValueOnce([]); // best-effort DELETE cleanup
    await expect(
      provisionHostedWorkspace(sql, { trialDays: 30, trialActionCap: 10000 }),
    ).rejects.toThrow(/key fail/);
    expect(sql.mock.calls.length).toBe(3);
  });

  it('getHostedWorkspace returns null when not found', async () => {
    sql.mockResolvedValueOnce([]);
    expect(await getHostedWorkspace(sql, 'org_missing')).toBeNull();
  });

  it('getHostedWorkspace returns workspace when found', async () => {
    sql.mockResolvedValueOnce([{
      id: 'org_abc',
      name: 'Trial',
      hosted_mode: true,
      trial_ends_at: '2026-05-18T00:00:00Z',
      trial_action_cap: 10000,
      trial_actions_used: 42,
    }]);
    const res = await getHostedWorkspace(sql, 'org_abc');
    expect(res).toEqual({
      orgId: 'org_abc',
      name: 'Trial',
      hostedMode: true,
      trialEndsAt: '2026-05-18T00:00:00Z',
      trialActionCap: 10000,
      trialActionsUsed: 42,
    });
  });

  it('deleteHostedWorkspace refuses to delete non-hosted orgs', async () => {
    sql.mockResolvedValueOnce([{ hosted_mode: false }]);
    await expect(deleteHostedWorkspace(sql, 'org_real')).rejects.toThrow(/not a hosted/);
  });

  it('findExpiredWorkspaces returns orgs past trialEndsAt', async () => {
    sql.mockResolvedValueOnce([{ id: 'org_old' }, { id: 'org_older' }]);
    const res = await findExpiredWorkspaces(sql, { now: new Date('2026-06-01T00:00:00Z') });
    expect(res).toEqual(['org_old', 'org_older']);
  });
});

// Route-level tests — use globalThis.__dashclaw_sql to intercept getSql() calls.
// getSql() checks globalThis.__dashclaw_sql first (db.js line 35), so we inject
// the mock there rather than mocking the neon module (which would affect the
// entire file and risk breaking the repo tests above).

const { POST, _resetLimiterForTests } = await import('../../../app/api/hosted/workspaces/route.js');

function makeRequest({ body = {}, ip = '1.1.1.1' } = {}) {
  return new Request('http://localhost:3000/api/hosted/workspaces', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': ip,
    },
    body: JSON.stringify(body),
  });
}

describe('POST /api/hosted/workspaces', () => {
  const originalEnv = { ...process.env };
  const routeSqlMock = vi.fn();

  beforeEach(() => {
    process.env = { ...originalEnv };
    routeSqlMock.mockReset();
    // Reset module-level rate-limiter singleton so prior tests' counters
    // and max-setting don't leak across cases.
    _resetLimiterForTests();
    // Inject mock into getSql() via the globalThis cache (db.js line 35)
    globalThis.__dashclaw_sql = routeSqlMock;
  });

  afterEach(() => {
    delete globalThis.__dashclaw_sql;
  });

  it('returns 404 when DASHCLAW_HOSTED is unset', async () => {
    delete process.env.DASHCLAW_HOSTED;
    const res = await POST(makeRequest());
    expect(res.status).toBe(404);
  });

  it('returns 400 when turnstile token missing in production', async () => {
    process.env.DASHCLAW_HOSTED = 'true';
    process.env.TURNSTILE_SECRET_KEY = 'secret';
    const res = await POST(makeRequest({ body: {} }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/turnstile/i);
  });

  it('returns 200 + api key when happy path (turnstile bypassed in dev)', async () => {
    process.env.DASHCLAW_HOSTED = 'true';
    delete process.env.TURNSTILE_SECRET_KEY;
    // Provision calls: org insert + key insert
    routeSqlMock.mockResolvedValueOnce([]);
    routeSqlMock.mockResolvedValueOnce([]);
    const res = await POST(makeRequest({ body: {} }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      workspace_id: expect.stringMatching(/^org_/),
      api_key: expect.stringMatching(/^oc_live_/),
      endpoint: expect.any(String),
      expires_at: expect.any(String),
    });
  });

  it('returns 429 when IP rate-limited', async () => {
    process.env.DASHCLAW_HOSTED = 'true';
    process.env.HOSTED_PROVISION_MAX_PER_IP_PER_DAY = '1';
    // The route's clientIp helper now requires TRUST_PROXY to honor
    // x-forwarded-for (matches middleware.js — prevents IP spoofing on
    // self-host without a controlled reverse proxy). Production sets this
    // implicitly via the VERCEL env var; tests have to set it explicitly.
    process.env.TRUST_PROXY = 'true';
    delete process.env.TURNSTILE_SECRET_KEY;
    routeSqlMock.mockResolvedValueOnce([]);
    routeSqlMock.mockResolvedValueOnce([]);
    await POST(makeRequest({ ip: '9.9.9.9' })); // first — ok
    routeSqlMock.mockResolvedValueOnce([]);
    routeSqlMock.mockResolvedValueOnce([]);
    const res = await POST(makeRequest({ ip: '9.9.9.9' })); // second — blocked
    expect(res.status).toBe(429);
  });
});
