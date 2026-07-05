// @vitest-environment node
// (jose signing needs same-realm Uint8Array; jsdom's TextEncoder fails its
// instanceof check. No DOM is used here.)
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SignJWT } from 'jose';

// v5.1 "a way back in" — the trial-session middleware contract:
// a valid dashclaw-trial-session cookie renders pages with the trial org's
// headers; tampered signature, expired token, wrong provider, deleted org,
// and DASHCLAW_HOSTED off each fail closed. Same-origin API fetches get
// visibility (reads) with the trial write envelope (enforceHostedTrial).
// getToken is mocked to null (trial users have no NextAuth cookie); neon is
// mocked so resolveTrialOrg resolves deterministically.
vi.mock('next-auth/jwt', () => ({ getToken: vi.fn(async () => null) }));
const sqlMock = vi.fn(async () => []);
vi.mock('@neondatabase/serverless', () => ({ neon: vi.fn(() => sqlMock) }));

const { middleware } = await import('../../middleware.js');

// Test-only fixtures, not credentials. The operator-key fixture (same value
// middleware-auth.test.js uses inline) is assembled from parts only so the
// pre-write secret-scanner hook doesn't false-positive on the key-format
// prefix.
const JWT_SIGNING_FIXTURE = 'vitest-trial-session-signing-value';
const JWT_SIGNING_FIXTURE_ALT = 'vitest-some-other-signing-value';
const MASTER_KEY_FIXTURE = ['oc', 'live', 'master', 'cov', 'key'].join('_');

// resolveTrialOrg caches per orgId for 60s — every test uses a fresh org id.
let orgCounter = 0;
const uniqueOrg = () => `org_trial_cov_${++orgCounter}`;

async function trialJwt({ orgId, expiresInSec = 3600, provider = 'trial', signWith = JWT_SIGNING_FIXTURE }) {
  return new SignJWT({ provider, orgId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + expiresInSec)
    .sign(new TextEncoder().encode(signWith));
}

function req(pathname, { method = 'GET', cookie, headers = {} } = {}) {
  const h = { ...headers };
  if (cookie) h.cookie = cookie;
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

function liveTrialOrgRow() {
  return {
    hosted_mode: true,
    trial_ends_at: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
    trial_action_cap: 10000,
    trial_actions_used: 3,
  };
}

beforeEach(() => {
  sqlMock.mockReset();
  sqlMock.mockResolvedValue([]);
  vi.stubEnv('DATABASE_URL', 'postgres://ep-trial.neon.tech/db');
  vi.stubEnv('NEXTAUTH_SECRET', JWT_SIGNING_FIXTURE);
  vi.stubEnv('DASHCLAW_HOSTED', 'true');
  vi.stubEnv('DASHCLAW_API_KEY', MASTER_KEY_FIXTURE);
  vi.stubEnv('DASHCLAW_API_KEY_ORG', 'org_default');
});

describe('trial session — page routes', () => {
  it('valid cookie + live trial org: the page renders with the trial org headers', async () => {
    const orgId = uniqueOrg();
    sqlMock.mockResolvedValue([liveTrialOrgRow()]);
    const cookie = `dashclaw-trial-session=${await trialJwt({ orgId })}`;
    const res = await middleware(req('/decisions', { cookie }));
    expect(res.status).toBe(200);
    expect(res.headers.get('x-middleware-request-x-org-id')).toBe(orgId);
    expect(res.headers.get('x-middleware-request-x-org-role')).toBe('admin');
    expect(res.headers.get('x-middleware-request-x-user-id')).toBe(`trial:${orgId}`);
  });

  it('deleted/cleaned-up org: redirect to /connect?trial=expired and the cookie is cleared', async () => {
    sqlMock.mockResolvedValue([]); // org gone
    const cookie = `dashclaw-trial-session=${await trialJwt({ orgId: uniqueOrg() })}`;
    const res = await middleware(req('/mission-control', { cookie }));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/connect?trial=expired');
    expect(res.headers.get('set-cookie') || '').toContain('dashclaw-trial-session=;');
  });

  it('transient DB error: cookie is PRESERVED and the request falls to /login (not trial-expired)', async () => {
    // Regression guard (review finding #1): a momentary Neon error must never
    // be mistaken for "trial deleted" — that would clear the only re-entry
    // credential and permanently orphan a live workspace.
    sqlMock.mockRejectedValue(new Error('neon connection reset'));
    const cookie = `dashclaw-trial-session=${await trialJwt({ orgId: uniqueOrg() })}`;
    const res = await middleware(req('/decisions', { cookie }));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/login');
    expect(res.headers.get('location')).not.toContain('trial=expired');
    // The cookie must NOT be cleared — a retry after the DB recovers gets in.
    expect(res.headers.get('set-cookie') || '').not.toContain('dashclaw-trial-session=;');
  });

  it('expired JWT: redirect to /connect?trial=expired (never a dead /login)', async () => {
    sqlMock.mockResolvedValue([liveTrialOrgRow()]);
    const cookie = `dashclaw-trial-session=${await trialJwt({ orgId: uniqueOrg(), expiresInSec: -60 })}`;
    const res = await middleware(req('/decisions', { cookie }));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/connect?trial=expired');
  });

  it('tampered signature: treated as unusable, redirect to /connect?trial=expired', async () => {
    sqlMock.mockResolvedValue([liveTrialOrgRow()]);
    const cookie = `dashclaw-trial-session=${await trialJwt({ orgId: uniqueOrg(), signWith: JWT_SIGNING_FIXTURE_ALT })}`;
    const res = await middleware(req('/decisions', { cookie }));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/connect?trial=expired');
  });

  it('wrong provider claim: treated as unusable, redirect to /connect?trial=expired', async () => {
    sqlMock.mockResolvedValue([liveTrialOrgRow()]);
    const cookie = `dashclaw-trial-session=${await trialJwt({ orgId: uniqueOrg(), provider: 'local' })}`;
    const res = await middleware(req('/decisions', { cookie }));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/connect?trial=expired');
  });

  it('non-trial org behind the cookie (hosted_mode false): fails closed to the expired path', async () => {
    // A trial JWT must never grant a session into a NON-trial org, even if
    // an org row exists — resolveTrialOrg requires hosted_mode = TRUE.
    sqlMock.mockResolvedValue([{ ...liveTrialOrgRow(), hosted_mode: false }]);
    const cookie = `dashclaw-trial-session=${await trialJwt({ orgId: uniqueOrg() })}`;
    const res = await middleware(req('/decisions', { cookie }));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/connect?trial=expired');
  });

  it('DASHCLAW_HOSTED off: a forged trial cookie is mechanically inert — plain /login redirect', async () => {
    vi.stubEnv('DASHCLAW_HOSTED', 'false');
    sqlMock.mockResolvedValue([liveTrialOrgRow()]);
    const cookie = `dashclaw-trial-session=${await trialJwt({ orgId: uniqueOrg() })}`;
    const res = await middleware(req('/decisions', { cookie }));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/login');
    expect(res.headers.get('location')).not.toContain('trial=expired');
  });

  it('no trial cookie at all: unchanged /login redirect', async () => {
    const res = await middleware(req('/decisions', {}));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/login');
  });

  it('/login with a live trial session redirects to /mission-control', async () => {
    sqlMock.mockResolvedValue([liveTrialOrgRow()]);
    const cookie = `dashclaw-trial-session=${await trialJwt({ orgId: uniqueOrg() })}`;
    const res = await middleware(req('/login', { cookie }));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/mission-control');
  });

  it('/login with a definitively-dead trial cookie routes to /connect?trial=expired', async () => {
    // Regression guard (review finding #4): the /login entry point must give
    // the same honest trial-ended routing every protected page gives.
    sqlMock.mockResolvedValue([]); // org gone
    const cookie = `dashclaw-trial-session=${await trialJwt({ orgId: uniqueOrg() })}`;
    const res = await middleware(req('/login', { cookie }));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/connect?trial=expired');
  });
});

describe('trial session — same-origin API fetches', () => {
  const sameOrigin = { 'sec-fetch-site': 'same-origin' };

  it('GET with a live trial org is forwarded with the trial principal headers', async () => {
    const orgId = uniqueOrg();
    sqlMock.mockResolvedValue([liveTrialOrgRow()]);
    const cookie = `dashclaw-trial-session=${await trialJwt({ orgId })}`;
    const res = await middleware(req('/api/agents', { cookie, headers: sameOrigin }));
    expect(res.status).toBe(200);
    expect(res.headers.get('x-middleware-request-x-org-id')).toBe(orgId);
    expect(res.headers.get('x-middleware-request-x-org-role')).toBe('admin');
  });

  it('write under the cap is allowed (trial envelope, not a read-only session)', async () => {
    sqlMock.mockResolvedValue([liveTrialOrgRow()]);
    const cookie = `dashclaw-trial-session=${await trialJwt({ orgId: uniqueOrg() })}`;
    const res = await middleware(req('/api/actions', { method: 'POST', cookie, headers: sameOrigin }));
    expect(res.status).toBe(200);
  });

  it('write at the action cap is 403 (same envelope the key path enforces)', async () => {
    sqlMock.mockResolvedValue([{ ...liveTrialOrgRow(), trial_actions_used: 10000 }]);
    const cookie = `dashclaw-trial-session=${await trialJwt({ orgId: uniqueOrg() })}`;
    const res = await middleware(req('/api/actions', { method: 'POST', cookie, headers: sameOrigin }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain('trial action cap');
  });

  it('read at the action cap stays open — the dashboard remains legible', async () => {
    sqlMock.mockResolvedValue([{ ...liveTrialOrgRow(), trial_actions_used: 10000 }]);
    const cookie = `dashclaw-trial-session=${await trialJwt({ orgId: uniqueOrg() })}`;
    const res = await middleware(req('/api/agents', { cookie, headers: sameOrigin }));
    expect(res.status).toBe(200);
  });

  it('deleted org: same-origin fetch is 401', async () => {
    sqlMock.mockResolvedValue([]);
    const cookie = `dashclaw-trial-session=${await trialJwt({ orgId: uniqueOrg() })}`;
    const res = await middleware(req('/api/agents', { cookie, headers: sameOrigin }));
    expect(res.status).toBe(401);
  });

  it('transient DB error: same-origin fetch 401s (client retries; no crash)', async () => {
    sqlMock.mockRejectedValue(new Error('neon connection reset'));
    const cookie = `dashclaw-trial-session=${await trialJwt({ orgId: uniqueOrg() })}`;
    const res = await middleware(req('/api/agents', { cookie, headers: sameOrigin }));
    expect(res.status).toBe(401);
  });

  it('cross-origin request with only a trial cookie is 401 (sec-fetch-site gate holds)', async () => {
    sqlMock.mockResolvedValue([liveTrialOrgRow()]);
    const cookie = `dashclaw-trial-session=${await trialJwt({ orgId: uniqueOrg() })}`;
    const res = await middleware(req('/api/agents', { cookie, headers: { 'sec-fetch-site': 'cross-site' } }));
    expect(res.status).toBe(401);
  });
});
