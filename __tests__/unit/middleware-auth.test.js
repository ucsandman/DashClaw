import { describe, it, expect, vi, beforeEach } from 'vitest';

// Coverage for the middleware API-key auth contract (the security surface):
// the DASHCLAW_API_KEY fast path, the api_keys slow path, readonly enforcement,
// cross-origin missing-key rejection, and public-route pass-through. neon is
// mocked so verifyOrgExists / resolveApiKey resolve deterministically.
const sqlMock = vi.fn();
vi.mock('@neondatabase/serverless', () => ({ neon: vi.fn(() => sqlMock) }));

const { middleware } = await import('../../middleware.js');

let keyCounter = 0;
const uniqueKey = () => `oc_live_auth_cov_${++keyCounter}`;

function req(pathname, { apiKey, method = 'GET', headers = {} } = {}) {
  const h = { ...headers };
  if (apiKey) h['x-api-key'] = apiKey;
  const url = `http://localhost:3000${pathname}`;
  return {
    url,
    method,
    nextUrl: new URL(url),
    headers: new Headers(h),
    cookies: { get: () => undefined },
    ip: '127.0.0.1',
  };
}

describe('middleware API-key auth', () => {
  beforeEach(() => {
    sqlMock.mockReset();
    sqlMock.mockResolvedValue([]);
    vi.stubEnv('DATABASE_URL', 'postgres://fake');
    vi.stubEnv('DASHCLAW_API_KEY', 'oc_live_master_cov_key');
    vi.stubEnv('DASHCLAW_API_KEY_ORG', 'org_default');
  });

  it('fast path: the configured DASHCLAW_API_KEY is accepted when the org exists', async () => {
    sqlMock.mockResolvedValue([{ '1': 1 }]); // verifyOrgExists -> rows.length > 0
    const res = await middleware(req('/api/actions', { apiKey: 'oc_live_master_cov_key' }));
    expect(res.status).toBe(200);
  });

  it('fast path: 503 when the configured org does not exist (Neon-backed)', async () => {
    sqlMock.mockResolvedValue([]); // verifyOrgExists -> not found
    // A Neon URL bypasses the self-host bootstrap-trust early return, so the
    // existence query runs. Unique org so the 1h verifyOrgExists cache misses.
    vi.stubEnv('DATABASE_URL', 'postgres://ep-cov.neon.tech/db');
    vi.stubEnv('DASHCLAW_API_KEY_ORG', `org_missing_${++keyCounter}`);
    const res = await middleware(req('/api/actions', { apiKey: 'oc_live_master_cov_key' }));
    expect(res.status).toBe(503);
  });

  // These slow-path cases exercise the inline Neon HTTP-driver resolution, so
  // pin a Neon DATABASE_URL (the self-host/non-Neon path is covered separately
  // in the "self-host TCP Postgres" block below, which delegates to a route).
  it('slow path: an unknown api key is rejected with 401', async () => {
    vi.stubEnv('DATABASE_URL', 'postgres://ep-auth.neon.tech/db');
    sqlMock.mockResolvedValue([]); // resolveApiKey -> no row
    const res = await middleware(req('/api/actions', { apiKey: uniqueKey() }));
    expect(res.status).toBe(401);
  });

  it('readonly key: a write method is forbidden with 403', async () => {
    vi.stubEnv('DATABASE_URL', 'postgres://ep-auth.neon.tech/db');
    sqlMock.mockResolvedValue([{ org_id: 'org_ro', role: 'readonly', revoked_at: null, hosted_mode: false }]);
    const res = await middleware(req('/api/actions', { apiKey: uniqueKey(), method: 'POST' }));
    expect(res.status).toBe(403);
  });

  it('readonly key: a GET is allowed', async () => {
    vi.stubEnv('DATABASE_URL', 'postgres://ep-auth.neon.tech/db');
    sqlMock.mockResolvedValue([{ org_id: 'org_ro', role: 'readonly', revoked_at: null, hosted_mode: false }]);
    const res = await middleware(req('/api/actions', { apiKey: uniqueKey(), method: 'GET' }));
    expect(res.status).toBe(200);
  });

  it('revoked key is rejected with 401', async () => {
    vi.stubEnv('DATABASE_URL', 'postgres://ep-auth.neon.tech/db');
    sqlMock.mockResolvedValue([{ org_id: 'org_x', role: 'admin', revoked_at: '2026-01-01T00:00:00Z', hosted_mode: false }]);
    const res = await middleware(req('/api/actions', { apiKey: uniqueKey() }));
    expect(res.status).toBe(401);
  });

  // Self-host on TCP-only Postgres: the edge middleware can't reach the DB with
  // the Neon HTTP driver, so DB-minted keys are resolved by delegating to the
  // internal /api/internal/resolve-key Node route (fetch). These assert the
  // delegation contract: the operator key is attached, and the route's answer
  // drives allow / 401.
  describe('self-host TCP Postgres (internal resolve-key delegation)', () => {
    let fetchMock;
    beforeEach(() => {
      vi.stubEnv('DATABASE_URL', 'postgres://localhost:5432/dashclaw'); // non-Neon
      vi.stubEnv('DASHCLAW_MODE', 'self_host');
      fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
    });

    const routeReply = (resolved, ok = true, status = 200) => ({
      ok,
      status,
      json: async () => ({ resolved }),
    });

    it('resolves a DB-minted key via the internal route and allows the request', async () => {
      fetchMock.mockResolvedValue(routeReply({ orgId: 'org_self', role: 'admin', hostedMode: false }));
      const res = await middleware(req('/api/actions', { apiKey: uniqueKey() }));
      expect(res.status).toBe(200);
      // The internal hop targets the resolve-key route and carries the operator key.
      const [url, init] = fetchMock.mock.calls[0];
      expect(String(url)).toContain('/api/internal/resolve-key');
      expect(init.headers['x-internal-auth']).toBe('oc_live_master_cov_key');
    });

    it('rejects an unknown key (route returns resolved: null) with 401', async () => {
      fetchMock.mockResolvedValue(routeReply(null));
      const res = await middleware(req('/api/actions', { apiKey: uniqueKey() }));
      expect(res.status).toBe(401);
    });

    it('fails closed with 401 when the internal route errors (non-2xx)', async () => {
      fetchMock.mockResolvedValue(routeReply(null, false, 500));
      const res = await middleware(req('/api/actions', { apiKey: uniqueKey() }));
      expect(res.status).toBe(401);
    });

    // SSRF guard: the internal hop carries the operator key, so a spoofed Host
    // header must never choose its destination. With an untrusted host and no
    // PORT/DASHCLAW_INTERNAL_BASE_URL/allowlist match, the request fails closed
    // and NO fetch leaves the middleware.
    it('never sends the operator key to a spoofed Host (fails closed, no fetch)', async () => {
      vi.stubEnv('PORT', '');
      vi.stubEnv('ALLOWED_ORIGIN', '');
      vi.stubEnv('NEXTAUTH_URL', '');
      fetchMock.mockResolvedValue(routeReply({ orgId: 'org_self', role: 'admin', hostedMode: false }));
      // Simulate a Host-header spoof: the request URL claims an attacker origin.
      const spoofed = req('/api/actions', { apiKey: uniqueKey() });
      spoofed.url = 'https://evil.example.com/api/actions';
      spoofed.nextUrl = new URL(spoofed.url);
      const res = await middleware(spoofed);
      expect(res.status).toBe(401);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('uses DASHCLAW_INTERNAL_BASE_URL over the request origin when set', async () => {
      vi.stubEnv('DASHCLAW_INTERNAL_BASE_URL', 'http://127.0.0.1:4242');
      fetchMock.mockResolvedValue(routeReply({ orgId: 'org_self', role: 'admin', hostedMode: false }));
      const res = await middleware(req('/api/actions', { apiKey: uniqueKey() }));
      expect(res.status).toBe(200);
      const [url] = fetchMock.mock.calls[0];
      expect(String(url)).toBe('http://127.0.0.1:4242/api/internal/resolve-key');
    });
  });

  it('cross-origin request with no api key is rejected with 401', async () => {
    const res = await middleware(req('/api/actions', { headers: { origin: 'https://other.example' } }));
    expect(res.status).toBe(401);
  });

  it('public route is reachable without an api key', async () => {
    const res = await middleware(req('/api/health'));
    expect(res.status).toBe(200);
  });

  it('prompts CRUD surface requires auth: /api/prompts/templates without a key is 401', async () => {
    // Regression: a bare '/api/prompts' in PUBLIC_ROUTES used to expose the whole
    // prompts API (templates/render/runs/stats/versions) with no API key. Only the
    // static-markdown /raw endpoints should be public.
    const res = await middleware(req('/api/prompts/templates', { headers: { origin: 'https://other.example' } }));
    expect(res.status).toBe(401);
  });

  it('prompts static markdown stays public: /api/prompts/server-setup/raw needs no key', async () => {
    const res = await middleware(req('/api/prompts/server-setup/raw'));
    expect(res.status).toBe(200);
  });

  it('stripe webhook is reachable without an api key (Stripe signs, route verifies)', async () => {
    // Regression: /api/webhooks/stripe was missing from PUBLIC_ROUTES, so
    // Stripe's unauthenticated POST got 401'd by default-deny middleware
    // before the handler's signature verification ever ran. Dormant until
    // STRIPE_SECRET_KEY is set, then billing desyncs silently.
    const res = await middleware(req('/api/webhooks/stripe', { method: 'POST' }));
    expect(res.status).toBe(200);
  });

  it('other webhook subpaths stay default-deny: /api/webhooks/whatever is 401', async () => {
    const res = await middleware(req('/api/webhooks/whatever', {
      method: 'POST', headers: { origin: 'https://other.example' },
    }));
    expect(res.status).toBe(401);
  });

  it('public-route matching is boundary-aware: /api/cron-report sibling is 401', async () => {
    // Regression guard: PUBLIC_ROUTES used bare startsWith, so any future
    // sibling sharing a public prefix (/api/cron -> /api/cron-report) would
    // ship unauthenticated. Same foot-gun previously hit /api/prompts.
    const res = await middleware(req('/api/cron-report', { headers: { origin: 'https://other.example' } }));
    expect(res.status).toBe(401);
  });

  it('public prefixes still cover their subpaths: /api/auth/local needs no key', async () => {
    const res = await middleware(req('/api/auth/local', { method: 'POST' }));
    expect(res.status).not.toBe(401);
  });

  it('session probe is public: /api/session/effective needs no key', async () => {
    // Regression: the probe route itself answers {authenticated:false} for
    // anonymous callers, but default-deny middleware 401'd it first — so every
    // anonymous visitor to a marketing page that gates client fetches on the
    // probe (AgentFilterProvider, useEffectiveRole consumers) got a console 401.
    const res = await middleware(req('/api/session/effective'));
    expect(res.status).toBe(200);
  });

  // OAuth connector path (Leg 2): /api/mcp answers an unauthenticated request with
  // 401 + WWW-Authenticate so Claude starts OAuth discovery; a live Bearer token
  // resolves to an org and passes through. Inherits the beforeEach env + sqlMock.
  it('returns 401 + WWW-Authenticate on /api/mcp with no credentials', async () => {
    const res = await middleware(req('/api/mcp', {
      method: 'POST', headers: { host: 'x.dashclaw.app', 'sec-fetch-site': 'cross-site' },
    }));
    expect(res.status).toBe(401);
    expect(res.headers.get('WWW-Authenticate')).toContain('resource_metadata=');
    expect(res.headers.get('WWW-Authenticate')).toContain('/.well-known/oauth-protected-resource');
  });

  it('accepts a valid OAuth Bearer token (passes through, not 401)', async () => {
    const future = new Date(Date.now() + 3600_000).toISOString();
    // resolveOAuthToken SELECT (and the fire-and-forget last_used_at UPDATE) hit sqlMock.
    sqlMock.mockResolvedValue([{ org_id: 'org_1', expires_at: future, revoked_at: null }]);
    const res = await middleware(req('/api/mcp', {
      method: 'POST', headers: { host: 'x.dashclaw.app', authorization: 'Bearer oat_valid' },
    }));
    expect(res.status).not.toBe(401);
  });

  // Hosted-trial public surface. Regression: these routes were default-denied
  // (401) by middleware on the first real hosted deployment (2026-06-10), which
  // broke anonymous trial minting, the capacity check, and the GH Actions
  // cleanup call. Each route self-protects (Turnstile/per-IP cap/cron secret),
  // so middleware must forward exactly these path+method pairs and nothing else.
  describe('hosted public surface', () => {
    it('GET /api/hosted/capacity needs no key', async () => {
      const res = await middleware(req('/api/hosted/capacity'));
      expect(res.status).toBe(200);
    });

    it('POST /api/hosted/workspaces (anonymous mint) needs no key', async () => {
      const res = await middleware(req('/api/hosted/workspaces', { method: 'POST' }));
      expect(res.status).toBe(200);
    });

    it('POST /api/hosted/cleanup is forwarded (the route enforces the cron secret)', async () => {
      const res = await middleware(req('/api/hosted/cleanup', { method: 'POST' }));
      expect(res.status).toBe(200);
    });

    it('method gate holds: GET /api/hosted/workspaces without a key is 401', async () => {
      const res = await middleware(req('/api/hosted/workspaces', { headers: { origin: 'https://other.example' } }));
      expect(res.status).toBe(401);
    });

    it('admin subpath stays protected: DELETE /api/hosted/workspaces/:id without a key is 401', async () => {
      const res = await middleware(req('/api/hosted/workspaces/org_trial_1', {
        method: 'DELETE', headers: { origin: 'https://other.example' },
      }));
      expect(res.status).toBe(401);
    });
  });
});
