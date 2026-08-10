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

// POST variant for the monthly-action-ceiling tests below: the ceiling only
// gates governed-action *creation* (POST /api/actions, POST
// /api/guard?record=true), never reads.
function postReq(pathname, apiKey) {
  const url = `http://localhost:3000${pathname}`;
  const parsed = new URL(url);
  return {
    url,
    method: 'POST',
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

  // Monthly governed-action ceiling (hosted paid tier, G4). Mirrors the
  // trial cap tests above, but scoped to governed-action creation
  // (POST /api/actions, POST /api/guard?record=true) per
  // app/lib/entitlements.ts + middleware.js's enforceActionCeiling. Nested
  // under the same describe so it inherits the outer beforeEach (DB URL +
  // sentinel key). Each mock queues 3 sql() resolutions in call order: the
  // auth SELECT, the fire-and-forget last_used_at UPDATE, then the
  // usage_rollups ceiling read.
  describe('monthly action ceiling (hosted paid plans)', () => {
    it('blocks POST /api/actions at the indie ceiling (50,000)', async () => {
      const apiKey = uniqueKey();
      sqlMock.mockResolvedValueOnce([{
        org_id: 'org_indie', role: 'admin', revoked_at: null,
        hosted_mode: true, trial_ends_at: '2099-01-01T00:00:00Z',
        trial_action_cap: null, trial_actions_used: 0, plan: 'indie',
      }]);
      sqlMock.mockResolvedValueOnce([]); // last_used_at UPDATE
      sqlMock.mockResolvedValueOnce([{ governed_actions: 50_000 }]); // usage_rollups
      const res = await middleware(postReq('/api/actions', apiKey));
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.code).toBe('ACTION_CEILING_REACHED');
      expect(body.monthly_action_ceiling).toBe(50_000);
    });

    it('does not block at 49,999 governed actions for indie', async () => {
      const apiKey = uniqueKey();
      sqlMock.mockResolvedValueOnce([{
        org_id: 'org_indie', role: 'admin', revoked_at: null,
        hosted_mode: true, trial_ends_at: '2099-01-01T00:00:00Z',
        trial_action_cap: null, trial_actions_used: 0, plan: 'indie',
      }]);
      sqlMock.mockResolvedValueOnce([]);
      sqlMock.mockResolvedValueOnce([{ governed_actions: 49_999 }]);
      const res = await middleware(postReq('/api/actions', apiKey));
      expect(res.status).not.toBe(403);
    });

    it('blocks POST /api/guard?record=true the same way as POST /api/actions', async () => {
      const apiKey = uniqueKey();
      sqlMock.mockResolvedValueOnce([{
        org_id: 'org_team', role: 'admin', revoked_at: null,
        hosted_mode: true, trial_ends_at: '2099-01-01T00:00:00Z',
        trial_action_cap: null, trial_actions_used: 0, plan: 'team',
      }]);
      sqlMock.mockResolvedValueOnce([]);
      sqlMock.mockResolvedValueOnce([{ governed_actions: 250_000 }]);
      const res = await middleware(postReq('/api/guard?record=true', apiKey));
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.code).toBe('ACTION_CEILING_REACHED');
    });

    it('never blocks a plain POST /api/guard without record=true', async () => {
      const apiKey = uniqueKey();
      sqlMock.mockResolvedValueOnce([{
        org_id: 'org_team', role: 'admin', revoked_at: null,
        hosted_mode: true, trial_ends_at: '2099-01-01T00:00:00Z',
        trial_action_cap: null, trial_actions_used: 0, plan: 'team',
      }]);
      // No usage_rollups mock queued: isGovernedActionCreationRequest is
      // false for a bare POST /api/guard, so enforceActionCeiling never
      // reads it.
      const res = await middleware(postReq('/api/guard', apiKey));
      expect(res.status).not.toBe(403);
    });

    it('never blocks reads even when the org is over its ceiling', async () => {
      const apiKey = uniqueKey();
      sqlMock.mockResolvedValueOnce([{
        org_id: 'org_indie', role: 'admin', revoked_at: null,
        hosted_mode: true, trial_ends_at: '2099-01-01T00:00:00Z',
        trial_action_cap: null, trial_actions_used: 0, plan: 'indie',
      }]);
      // GET is not governed-action creation, so the ceiling read never fires.
      const res = await middleware(req('/api/actions', apiKey));
      expect(res.status).not.toBe(403);
    });

    it('free hosted plan has no monthly ceiling — governed by the lifetime trial cap instead', async () => {
      const apiKey = uniqueKey();
      sqlMock.mockResolvedValueOnce([{
        org_id: 'org_free', role: 'admin', revoked_at: null,
        hosted_mode: true, trial_ends_at: '2099-01-01T00:00:00Z',
        trial_action_cap: 10_000, trial_actions_used: 5, plan: 'free',
      }]);
      // actionCeilingExceeded short-circuits on a null ceiling, so no
      // usage_rollups read happens; nothing else needs to be queued.
      const res = await middleware(postReq('/api/actions', apiKey));
      expect(res.status).not.toBe(403);
    });

    it('self-hosted (hosted_mode false) never blocks, even for the trial-cap-shaped fields', async () => {
      const apiKey = uniqueKey();
      sqlMock.mockResolvedValueOnce([{
        org_id: 'org_self', role: 'admin', revoked_at: null,
        hosted_mode: false, trial_ends_at: null,
        trial_action_cap: null, trial_actions_used: 0, plan: 'indie',
      }]);
      const res = await middleware(postReq('/api/actions', apiKey));
      expect(res.status).not.toBe(403);
    });
  });
});
