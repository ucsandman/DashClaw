import { describe, it, expect, vi, beforeEach } from 'vitest';

const sqlMock = vi.fn();
vi.mock('@neondatabase/serverless', () => ({ neon: vi.fn(() => sqlMock) }));

const { middleware } = await import('../../../middleware.js');

// Each test uses a unique API key so the module-level cache in middleware
// (apiKeyCache, 5-minute TTL) doesn't hand back a prior test's result.
let keyCounter = 0;
function uniqueKey() {
  keyCounter += 1;
  return `oc_live_trial_enf_${keyCounter}`;
}

function req(pathname, apiKey) {
  const url = `http://localhost:3000${pathname}`;
  const parsed = new URL(url);
  return {
    url,
    method: 'GET',
    nextUrl: parsed,
    headers: new Headers({ 'x-api-key': apiKey }),
    cookies: { get: () => undefined },
    ip: '127.0.0.1',
  };
}

describe('middleware hosted-trial enforcement', () => {
  beforeEach(() => {
    sqlMock.mockReset();
    // Default: any unmocked sql call returns empty. The fire-and-forget
    // UPDATE api_keys SET last_used_at... will return undefined otherwise,
    // and its .catch() chain would throw. Providing a default rejected-safe
    // resolution keeps the middleware path clean.
    sqlMock.mockResolvedValue([]);
    // Neon URL keeps resolveApiKey on the inline (mocked-neon) path; a non-Neon
    // URL in self_host mode delegates to the internal resolve-key route instead
    // (covered by middleware-auth.test.js).
    process.env.DATABASE_URL = 'postgres://ep-trial.neon.tech/db';
    // Set a sentinel master key that won't match any test key, so the
    // middleware skips the 503 "not configured" guard and falls through
    // to the slow-path SQL lookup for each unique test key.
    process.env.DASHCLAW_API_KEY = 'oc_live_sentinel_master_key_not_used_in_tests';
  });

  it('returns 403 when hosted org trial has expired', async () => {
    const apiKey = uniqueKey();
    // Single JOIN row with all fields
    sqlMock.mockResolvedValueOnce([{
      org_id: 'org_x',
      role: 'admin',
      revoked_at: null,
      hosted_mode: true,
      trial_ends_at: '2026-01-01T00:00:00Z',
      trial_action_cap: 10000,
      trial_actions_used: 5,
    }]);
    const res = await middleware(req('/api/actions', apiKey));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/trial.*expired/i);
  });

  it('returns 403 when hosted org action cap reached', async () => {
    const apiKey = uniqueKey();
    sqlMock.mockResolvedValueOnce([{
      org_id: 'org_x',
      role: 'admin',
      revoked_at: null,
      hosted_mode: true,
      trial_ends_at: '2099-01-01T00:00:00Z',
      trial_action_cap: 10,
      trial_actions_used: 10,
    }]);
    const res = await middleware(req('/api/actions', apiKey));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/action cap/i);
  });

  it('key auth stamps first_used_at once alongside last_used_at (v5.3)', async () => {
    const apiKey = uniqueKey();
    sqlMock.mockResolvedValueOnce([{
      org_id: 'org_x',
      role: 'admin',
      revoked_at: null,
      hosted_mode: true,
      trial_ends_at: '2099-01-01T00:00:00Z',
      trial_action_cap: 10000,
      trial_actions_used: 5,
    }]);
    await middleware(req('/api/actions', apiKey));
    const touch = sqlMock.mock.calls
      .map((c) => (Array.isArray(c[0]) ? c[0].join(' ') : String(c[0])))
      .find((t) => t.includes('SET last_used_at'));
    expect(touch).toBeTruthy();
    expect(touch).toContain('first_used_at = COALESCE(first_used_at, CURRENT_TIMESTAMP)');
  });

  it('passes through when hosted org is within limits', async () => {
    const apiKey = uniqueKey();
    sqlMock.mockResolvedValueOnce([{
      org_id: 'org_x',
      role: 'admin',
      revoked_at: null,
      hosted_mode: true,
      trial_ends_at: '2099-01-01T00:00:00Z',
      trial_action_cap: 10000,
      trial_actions_used: 42,
    }]);
    const res = await middleware(req('/api/actions', apiKey));
    expect(res.status).not.toBe(403);
  });

  it('skips hosted check entirely for non-hosted orgs', async () => {
    const apiKey = uniqueKey();
    sqlMock.mockResolvedValueOnce([{
      org_id: 'org_real',
      role: 'admin',
      revoked_at: null,
      hosted_mode: false,
      trial_ends_at: null,
      trial_action_cap: null,
      trial_actions_used: 0,
    }]);
    const res = await middleware(req('/api/actions', apiKey));
    expect(res.status).not.toBe(403);
  });
});
