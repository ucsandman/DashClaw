import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Coverage for three middleware auth invariants that the API-key suite does not
// reach:
//   1. Bearer-vs-x-api-key PRECEDENCE. Both SDKs send `x-api-key` AND
//      `Authorization: Bearer <jwt>` on every request once an agent authToken is
//      configured (sdk/dashclaw.js `_authHeaders`). The bearer there is an agent
//      IDENTITY claim, not an OAuth credential, so an unresolved one must not
//      401 the request before the valid key on the same request is examined.
//   2. The api-key cache must not outlive a revoke by minutes.
//   3. The org/trial caches must stay bounded like their neighbours.
const sqlMock = vi.fn();
vi.mock('@neondatabase/serverless', () => ({ neon: vi.fn(() => sqlMock) }));

// The cache-bound test drives thousands of requests from one IP; middleware
// reads the rate-limit config once at module load, so it has to be off BEFORE
// the import. Restored immediately after so no later test file inherits it.
const previousRateLimitFlag = process.env.DASHCLAW_DISABLE_RATE_LIMIT;
process.env.DASHCLAW_DISABLE_RATE_LIMIT = '1';
const { middleware, invalidateApiKeyCache, __cacheStatsForTesting } = await import('../../middleware.js');
if (previousRateLimitFlag === undefined) delete process.env.DASHCLAW_DISABLE_RATE_LIMIT;
else process.env.DASHCLAW_DISABLE_RATE_LIMIT = previousRateLimitFlag;

// Built, not pasted: three base64url segments shaped like a JWT, and NOT a live
// oauth_access_tokens row.
const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
const JWT_BEARER = [
  b64url({ alg: 'EdDSA', kid: 'k1' }),
  b64url({ iss: 'https://id.example', sub: 'agent_1' }),
  b64url('not-a-real-signature'),
].join('.');

let keyCounter = 0;
const uniqueKey = () => `oc_live_prec_${++keyCounter}`;

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function req(pathname, { apiKey, bearer, method = 'GET', headers = {} } = {}) {
  const h = { ...headers };
  if (apiKey) h['x-api-key'] = apiKey;
  if (bearer) h['authorization'] = `Bearer ${bearer}`;
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

const liveKeyRow = { org_id: 'org_prec', role: 'admin', revoked_at: null, hosted_mode: false };

// The operator fast-path key. Stubbed per-suite so no ambient env leaks in.
const OPERATOR_KEY = 'oc_live_master_prec_key';

describe('middleware bearer-vs-api-key precedence', () => {
  beforeEach(() => {
    sqlMock.mockReset();
    sqlMock.mockResolvedValue([]);
    // Neon URL keeps resolveApiKey on the inline HTTP-driver path (no internal hop).
    vi.stubEnv('DATABASE_URL', 'postgres://ep-prec.neon.tech/db');
    vi.stubEnv('DASHCLAW_API_KEY', OPERATOR_KEY);
    vi.stubEnv('DASHCLAW_API_KEY_ORG', 'org_default');
  });

  it('a valid x-api-key still authenticates when a JWT identity bearer rides along', async () => {
    // The documented Phase-2 setup (DASHCLAW_ALLOWED_ISSUER + authToken) sends
    // both headers on every request. Before the fix this 401'd every one of them.
    sqlMock.mockResolvedValue([liveKeyRow]);
    const res = await middleware(req('/api/actions', { apiKey: uniqueKey(), bearer: JWT_BEARER }));
    expect(res.status).toBe(200);
  });

  it('a garbage OPAQUE bearer still 401s even with a valid x-api-key', async () => {
    // Not a blanket bypass: an opaque bearer is a CREDENTIAL, and a credential
    // that resolves to nothing is a rejected credential.
    sqlMock.mockResolvedValue([liveKeyRow]);
    const res = await middleware(req('/api/actions', { apiKey: uniqueKey(), bearer: 'oat_not_a_live_token' }));
    expect(res.status).toBe(401);
  });

  it('an opaque bearer alone (no api key) that is not a live token still 401s', async () => {
    sqlMock.mockResolvedValue([]);
    const res = await middleware(req('/api/actions', {
      bearer: 'oat_dead', headers: { origin: 'https://other.example' },
    }));
    expect(res.status).toBe(401);
  });

  it('a JWT bearer alone (no api key, cross-origin) is still 401 — it is identity, not a credential', async () => {
    const res = await middleware(req('/api/actions', {
      bearer: JWT_BEARER, headers: { origin: 'https://other.example' },
    }));
    expect(res.status).toBe(401);
  });

  it('a live OAuth bearer is still honored (the opaque path is unchanged)', async () => {
    const future = new Date(Date.now() + 3600_000).toISOString();
    sqlMock.mockResolvedValue([{
      org_id: 'org_oauth',
      client_id: 'ocl_prec',
      user_id: 'usr_prec',
      expires_at: future,
      revoked_at: null,
    }]);
    const res = await middleware(req('/api/mcp', {
      method: 'POST', bearer: 'oat_live_prec', headers: { host: 'x.dashclaw.app' },
    }));
    expect(res.status).not.toBe(401);
  });
});

describe('middleware api-key cache revocation', () => {
  let clockOffset = 0;
  let nowSpy;

  beforeEach(() => {
    sqlMock.mockReset();
    sqlMock.mockResolvedValue([]);
    vi.stubEnv('DATABASE_URL', 'postgres://ep-prec.neon.tech/db');
    vi.stubEnv('DASHCLAW_API_KEY', OPERATOR_KEY);
    vi.stubEnv('DASHCLAW_API_KEY_ORG', 'org_default');
    clockOffset = 0;
    const realNow = Date.now.bind(Date);
    nowSpy = vi.spyOn(Date, 'now').mockImplementation(() => realNow() + clockOffset);
  });

  afterEach(() => {
    nowSpy.mockRestore();
  });

  it('invalidateApiKeyCache(keyHash) drops the entry so the next request re-reads the row', async () => {
    const key = uniqueKey();
    sqlMock.mockResolvedValue([liveKeyRow]);
    expect((await middleware(req('/api/actions', { apiKey: key }))).status).toBe(200);

    // Key revoked in the DB. Without invalidation the warm entry keeps serving.
    sqlMock.mockResolvedValue([{ ...liveKeyRow, revoked_at: '2026-01-01T00:00:00Z' }]);
    expect((await middleware(req('/api/actions', { apiKey: key }))).status).toBe(200);

    invalidateApiKeyCache(await sha256Hex(key));
    expect((await middleware(req('/api/actions', { apiKey: key }))).status).toBe(401);
  });

  it('a revoked key stops working within seconds even with no invalidation call', async () => {
    // Cross-instance defence: the revoke route can only reach the Map in ITS
    // process, so the positive TTL is the only bound on every other warm
    // instance. 30s here is the ceiling this test enforces.
    const key = uniqueKey();
    sqlMock.mockResolvedValue([liveKeyRow]);
    expect((await middleware(req('/api/actions', { apiKey: key }))).status).toBe(200);

    sqlMock.mockResolvedValue([{ ...liveKeyRow, revoked_at: '2026-01-01T00:00:00Z' }]);
    clockOffset = 30_000;
    expect((await middleware(req('/api/actions', { apiKey: key }))).status).toBe(401);
  });

  it('the positive TTL is still a cache: a second request inside it serves without a re-read', async () => {
    const key = uniqueKey();
    sqlMock.mockResolvedValue([liveKeyRow]);
    expect((await middleware(req('/api/actions', { apiKey: key }))).status).toBe(200);
    const callsAfterFirst = sqlMock.mock.calls.length;
    expect((await middleware(req('/api/actions', { apiKey: key }))).status).toBe(200);
    expect(sqlMock.mock.calls.length).toBe(callsAfterFirst);
  });

  it('invalidateApiKeyCache() with no argument clears every entry', async () => {
    const key = uniqueKey();
    sqlMock.mockResolvedValue([liveKeyRow]);
    expect((await middleware(req('/api/actions', { apiKey: key }))).status).toBe(200);
    expect(__cacheStatsForTesting().apiKey.size).toBeGreaterThan(0);
    invalidateApiKeyCache();
    expect(__cacheStatsForTesting().apiKey.size).toBe(0);
  });
});

describe('middleware org/trial cache bounds', () => {
  beforeEach(() => {
    sqlMock.mockReset();
    sqlMock.mockResolvedValue([]);
    vi.stubEnv('DATABASE_URL', 'postgres://ep-prec.neon.tech/db');
    vi.stubEnv('DASHCLAW_API_KEY', OPERATOR_KEY);
  });

  it('orgExistsCache stops growing past its cap', async () => {
    // verifyOrgExists is keyed by DASHCLAW_API_KEY_ORG, so a per-request org id
    // grows the Map unboundedly. Every neighbouring cache here is capped.
    // Prune runs on function ENTRY (the pruneApiKeyCache idiom), so the steady
    // state is cap + the one entry written after the last prune.
    const cap = __cacheStatsForTesting().orgExists.max;
    sqlMock.mockResolvedValue([{ '1': 1 }]);
    for (let i = 0; i < cap + 25; i++) {
      vi.stubEnv('DASHCLAW_API_KEY_ORG', `org_bound_${i}`);
      await middleware(req('/api/actions', { apiKey: OPERATOR_KEY }));
    }
    expect(__cacheStatsForTesting().orgExists.size).toBeLessThanOrEqual(cap + 1);
  }, 60_000);

  it('trialOrgCache is capped the same way', () => {
    const { trialOrg } = __cacheStatsForTesting();
    expect(trialOrg.max).toBeGreaterThan(0);
    expect(trialOrg.size).toBeLessThanOrEqual(trialOrg.max);
  });
});
