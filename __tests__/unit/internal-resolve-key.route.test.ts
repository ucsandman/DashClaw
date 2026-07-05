import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeRequest as rawRequest } from '../helpers.js';

/** helpers.js returns a duck-typed request object; the route handler expects Request. */
function makeRequest(url: string, opts: { headers?: Record<string, string>; body?: unknown } = {}): Request {
  return rawRequest(url, opts) as unknown as Request;
}

// Coverage for the internal DB-key resolution bridge (app/api/internal/resolve-key/route.ts):
// the self-host-only gate (never a public hash->org oracle on Neon/hosted), the
// operator-key auth (timingSafeCompare, not bypassable with an empty presented
// value), and the resolved/revoked/unknown-key response shapes the middleware
// delegation contract (__tests__/unit/middleware-auth.test.js) depends on.

const { mockResolveKeyForAuth, mockTouchKeyLastUsed } = vi.hoisted(() => ({
  mockResolveKeyForAuth: vi.fn(),
  mockTouchKeyLastUsed: vi.fn(async () => {}),
}));
vi.mock('../../app/lib/db', () => ({ getSql: () => ({ __marker: 'sql' }) }));
vi.mock('../../app/lib/repositories/apiKeys.repository', () => ({
  resolveKeyForAuth: mockResolveKeyForAuth,
  touchKeyLastUsed: mockTouchKeyLastUsed,
}));

import { POST } from '../../app/api/internal/resolve-key/route';

const OPERATOR_KEY = 'oc_live_operator_cov_key';

function req({ auth, body = { keyHash: 'hash_abc' } }: { auth?: string; body?: unknown } = {}) {
  return makeRequest('http://x/api/internal/resolve-key', {
    headers: auth !== undefined ? { 'x-internal-auth': auth } : {},
    body,
  });
}

function selfHostNonNeon() {
  vi.stubEnv('DASHCLAW_MODE', 'self_host');
  vi.stubEnv('DATABASE_URL', 'postgres://localhost:5432/dashclaw');
  vi.stubEnv('DASHCLAW_API_KEY', OPERATOR_KEY);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveKeyForAuth.mockResolvedValue([]);
});

describe('POST /api/internal/resolve-key', () => {
  describe('self-host/Neon gate', () => {
    it('404s when DATABASE_URL is a Neon URL (never a public oracle on hosted)', async () => {
      vi.stubEnv('DASHCLAW_MODE', 'self_host');
      vi.stubEnv('DATABASE_URL', 'postgres://ep-abc.neon.tech/db');
      vi.stubEnv('DASHCLAW_API_KEY', OPERATOR_KEY);
      const res = await POST(req({ auth: OPERATOR_KEY }));
      expect(res.status).toBe(404);
      expect(mockResolveKeyForAuth).not.toHaveBeenCalled();
    });

    it('404s when DASHCLAW_MODE is not self_host, even on a non-Neon DB URL', async () => {
      vi.stubEnv('DASHCLAW_MODE', 'hosted');
      vi.stubEnv('DATABASE_URL', 'postgres://localhost:5432/dashclaw');
      vi.stubEnv('DASHCLAW_API_KEY', OPERATOR_KEY);
      const res = await POST(req({ auth: OPERATOR_KEY }));
      expect(res.status).toBe(404);
    });

    it('does not require the operator key to be present to 404 (gate runs before auth)', async () => {
      vi.stubEnv('DASHCLAW_MODE', 'self_host');
      vi.stubEnv('DATABASE_URL', 'postgres://ep-abc.neon.tech/db');
      vi.stubEnv('DASHCLAW_API_KEY', OPERATOR_KEY);
      const res = await POST(req({ auth: undefined }));
      expect(res.status).toBe(404);
    });
  });

  describe('operator-key auth', () => {
    beforeEach(() => selfHostNonNeon());

    it('401s when no x-internal-auth header is presented', async () => {
      const res = await POST(req({ auth: undefined }));
      expect(res.status).toBe(401);
      expect((await res.json()).error).toBe('Unauthorized');
    });

    it('401s on a wrong operator key', async () => {
      const res = await POST(req({ auth: 'wrong_key' }));
      expect(res.status).toBe(401);
    });

    it('401s when the presented key is an empty string (not a comparison bypass)', async () => {
      const res = await POST(req({ auth: '' }));
      expect(res.status).toBe(401);
    });

    it('401s when DASHCLAW_API_KEY itself is unset/empty (no empty==empty bypass)', async () => {
      vi.stubEnv('DASHCLAW_API_KEY', '');
      const res = await POST(req({ auth: '' }));
      expect(res.status).toBe(401);
    });

    it('does not resolve the key when auth fails', async () => {
      await POST(req({ auth: 'wrong_key' }));
      expect(mockResolveKeyForAuth).not.toHaveBeenCalled();
    });
  });

  describe('key resolution', () => {
    beforeEach(() => selfHostNonNeon());

    it('missing keyHash in the body -> 400', async () => {
      const res = await POST(req({ auth: OPERATOR_KEY, body: {} }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('keyHash required');
    });

    it('returns the resolved principal payload shape for a known, active key', async () => {
      mockResolveKeyForAuth.mockResolvedValue([{
        id: 'key_1',
        org_id: 'org_1',
        role: 'admin',
        revoked_at: null,
        hosted_mode: true,
        trial_ends_at: '2026-08-01T00:00:00Z',
        trial_action_cap: 100,
        trial_actions_used: 5,
      }]);
      const res = await POST(req({ auth: OPERATOR_KEY, body: { keyHash: 'hash_abc' } }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.resolved).toEqual({
        keyId: 'key_1',
        orgId: 'org_1',
        role: 'admin',
        hostedMode: true,
        trialEndsAt: '2026-08-01T00:00:00Z',
        trialActionCap: 100,
        trialActionsUsed: 5,
      });
      expect(mockResolveKeyForAuth).toHaveBeenCalledWith(expect.anything(), 'hash_abc');
    });

    it('fires touchKeyLastUsed for a resolved key (fire-and-forget last_used_at)', async () => {
      mockResolveKeyForAuth.mockResolvedValue([{ id: 'key_1', org_id: 'org_1', role: 'admin', revoked_at: null }]);
      await POST(req({ auth: OPERATOR_KEY, body: { keyHash: 'hash_abc' } }));
      expect(mockTouchKeyLastUsed).toHaveBeenCalledWith(expect.anything(), 'hash_abc');
    });

    it('a revoked key resolves to { resolved: null } (definitive no-valid-key, cacheable)', async () => {
      mockResolveKeyForAuth.mockResolvedValue([{ id: 'key_1', org_id: 'org_1', role: 'admin', revoked_at: '2026-01-01T00:00:00Z' }]);
      const res = await POST(req({ auth: OPERATOR_KEY, body: { keyHash: 'hash_abc' } }));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ resolved: null });
      expect(mockTouchKeyLastUsed).not.toHaveBeenCalled();
    });

    it('an unknown key (no matching row) resolves to { resolved: null }, same as revoked', async () => {
      mockResolveKeyForAuth.mockResolvedValue([]);
      const res = await POST(req({ auth: OPERATOR_KEY, body: { keyHash: 'hash_nope' } }));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ resolved: null });
      expect(mockTouchKeyLastUsed).not.toHaveBeenCalled();
    });

    it('a transient DB failure answers 500 with the Postgres error code (fail-closed, no caching)', async () => {
      const dbErr = Object.assign(new Error('relation "api_keys" does not exist'), { code: '42P01' });
      mockResolveKeyForAuth.mockRejectedValue(dbErr);
      const res = await POST(req({ auth: OPERATOR_KEY, body: { keyHash: 'hash_abc' } }));
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.resolved).toBe(null);
      expect(body.code).toBe('42P01');
    });
  });
});
