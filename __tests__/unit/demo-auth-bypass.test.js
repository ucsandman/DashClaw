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

  it('/demo redirects to the public live demo anchor without setting a demo cookie', async () => {
    getToken.mockResolvedValue(null);
    const res = await middleware(req('/demo', { demoCookie: false }));

    expect(res.headers.get('location')).toBe('http://localhost:3000/#live-demo');
    expect(res.headers.get('set-cookie') || '').not.toMatch(/dashclaw_demo=1/);
  });

  it('/demo?sandbox=1 mints the demo cookie and forwards into /decisions', async () => {
    getToken.mockResolvedValue(null);
    const res = await middleware(req('/demo?sandbox=1', { demoCookie: false }));

    expect(res.headers.get('location')).toBe('http://localhost:3000/decisions');
    const setCookie = res.headers.get('set-cookie') || '';
    expect(setCookie).toMatch(/dashclaw_demo=1/);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=lax/i);
  });

  it('/demo?sandbox=1&leave=1 — leave wins; cookie cleared, no sandbox entry', async () => {
    getToken.mockResolvedValue(null);
    const res = await middleware(req('/demo?sandbox=1&leave=1'));

    expect(res.headers.get('location')).toBe('http://localhost:3000/#live-demo');
    const setCookie = res.headers.get('set-cookie') || '';
    expect(setCookie).toMatch(/dashclaw_demo=/);
    expect(setCookie).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/i);
    expect(setCookie).not.toMatch(/dashclaw_demo=1/);
  });

  it('/demo?leave=1 clears a stale demo cookie and redirects public', async () => {
    getToken.mockResolvedValue(null);
    const res = await middleware(req('/demo?leave=1'));

    expect(res.headers.get('location')).toBe('http://localhost:3000/#live-demo');
    const setCookie = res.headers.get('set-cookie') || '';
    expect(setCookie).toMatch(/dashclaw_demo=/);
    expect(setCookie).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/i);
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
    const res = await middleware(req('/approvals'));
    // The authenticated page exit clears the stale cookie. NextResponse exposes
    // deletions via Set-Cookie with Max-Age=0 / an empty value.
    const setCookie = res.headers.get('set-cookie') || '';
    expect(setCookie).toMatch(/dashclaw_demo=/);
    expect(setCookie).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/i);
  });

  it('hosted-trial instance (DASHCLAW_HOSTED=true) NEVER honors the demo cookie, even on *.dashclaw.io', async () => {
    // Regression: hosted.dashclaw.io ends with .dashclaw.io, so a visitor who
    // clicked Mission Control (cookie minted on that host) had every write —
    // including the trial mint — demo-blocked. A trial instance is a real
    // runtime, never a marketing sandbox.
    vi.stubEnv('DASHCLAW_HOSTED', 'true');
    getToken.mockResolvedValue(null); // anonymous, cookie present
    const res = await middleware(req('/api/health', { host: 'hosted.dashclaw.io' }));
    let body = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    expect(body?.mode).not.toBe('demo');
  });

  it('env demo mode: /api/hosted writes pass through (the passthrough must beat the write block)', async () => {
    // Regression: the passthrough list ran BELOW the demo write block, so it
    // only ever exempted reads — a no-op for the POSTs it exists to protect
    // (NextAuth sign-in, the hosted mint).
    vi.stubEnv('DASHCLAW_MODE', 'demo');
    getToken.mockResolvedValue(null);
    const res = await middleware(req('/api/hosted/workspaces', { method: 'POST', demoCookie: false }));
    let body = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    expect(body?.error).not.toBe('Demo mode: write APIs are disabled.');
  });
});
