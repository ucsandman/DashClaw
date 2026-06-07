import { describe, it, expect, vi, beforeEach } from 'vitest';

// Task 8 (Instant Hosted Trial): an authenticated principal carrying a stale
// `dashclaw_demo` cookie on a marketing host must NOT be served demo fixtures —
// they get the real runtime (their trial workspace). Anonymous tire-kickers and
// the env-forced DASHCLAW_MODE=demo path are unchanged.
//
// getToken is mocked so each test controls whether a NextAuth principal exists.
// neon is mocked so no real DB is touched (the bypass path falls through to the
// real /api/* flow, which may hit SQL).
vi.mock('next-auth/jwt', () => ({ getToken: vi.fn() }));
const sqlMock = vi.fn(async () => []);
vi.mock('@neondatabase/serverless', () => ({ neon: vi.fn(() => sqlMock) }));

const { getToken } = await import('next-auth/jwt');
const { middleware } = await import('../../middleware.js');

// Build a request carrying the demo cookie + marketing host, like a browser
// that hit /demo then signed in. `cookieValue` lets a test drop the cookie.
function req(pathname, { method = 'GET', host = 'dashclaw.io', demoCookie = true } = {}) {
  const url = `http://localhost:3000${pathname}`;
  return {
    url,
    method,
    nextUrl: new URL(url),
    headers: new Headers({ host }),
    cookies: {
      get: (n) => (n === 'dashclaw_demo' && demoCookie ? { value: '1' } : undefined),
    },
    ip: '127.0.0.1',
  };
}

describe('middleware demo auth bypass', () => {
  beforeEach(() => {
    sqlMock.mockReset();
    sqlMock.mockResolvedValue([]);
    getToken.mockReset();
    vi.stubEnv('DATABASE_URL', 'postgres://fake');
    vi.stubEnv('NEXTAUTH_SECRET', 'test-secret-1234567890');
    // Default master key so the real /api/* flow doesn't 503 on the bypass path.
    vi.stubEnv('DASHCLAW_API_KEY', 'oc_live_sentinel_master_key_not_used_in_tests');
    // Ensure the cookie path is exercised, not the env-forced demo path.
    vi.stubEnv('DASHCLAW_MODE', 'self_host');
  });

  it('anonymous + demo cookie + dashclaw.io → serves DEMO fixtures', async () => {
    getToken.mockResolvedValue(null); // no NextAuth principal, no local-admin cookie
    const res = await middleware(req('/api/health'));
    const body = await res.json();
    expect(body.mode).toBe('demo');
  });

  it('authenticated (NextAuth) + demo cookie + dashclaw.io → does NOT serve demo', async () => {
    getToken.mockResolvedValue({ orgId: 'org_x', role: 'admin', sub: 'usr_1' });
    const res = await middleware(req('/api/health'));
    // Bypass falls through to the real /api/health flow, which is a public route
    // served as a NextResponse.next() passthrough — no demo JSON body.
    const ct = res.headers.get('content-type') || '';
    expect(ct).not.toContain('application/json');
    // And there is no demo body to read.
    let body = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    expect(body?.mode).not.toBe('demo');
  });

  it('DASHCLAW_MODE=demo (env) + authenticated → STILL serves demo for everyone', async () => {
    vi.stubEnv('DASHCLAW_MODE', 'demo');
    getToken.mockResolvedValue({ orgId: 'org_x', role: 'admin', sub: 'usr_1' });
    const res = await middleware(req('/api/health'));
    const body = await res.json();
    expect(body.mode).toBe('demo');
  });

  it('authenticated + demo cookie → page route deletes the stale dashclaw_demo cookie', async () => {
    getToken.mockResolvedValue({ orgId: 'org_x', role: 'admin', sub: 'usr_1' });
    const res = await middleware(req('/mission-control'));
    // The authenticated page exit clears the stale cookie. NextResponse exposes
    // deletions via Set-Cookie with Max-Age=0 / an empty value.
    const setCookie = res.headers.get('set-cookie') || '';
    expect(setCookie).toMatch(/dashclaw_demo=/);
    expect(setCookie).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/i);
  });
});
