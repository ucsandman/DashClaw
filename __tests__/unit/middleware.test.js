import { describe, it, expect, vi, beforeEach } from 'vitest';

// Characterization tests for middleware.js demo-mode dispatch ORDER.
// The demo /api/* cascade has order-dependent quirks that any structural
// refactor must preserve exactly. Each test pins one of them against the
// env-forced DASHCLAW_MODE=demo path (no cookie/host gymnastics needed).
//
// getToken + neon are mocked so no real session/DB is touched.
vi.mock('next-auth/jwt', () => ({ getToken: vi.fn() }));
const sqlMock = vi.fn(async () => []);
vi.mock('@neondatabase/serverless', () => ({ neon: vi.fn(() => sqlMock) }));

const { getToken } = await import('next-auth/jwt');
const { middleware } = await import('../../middleware.js');

function req(pathname, { method = 'GET', body, ip = '10.9.8.7' } = {}) {
  const url = `http://localhost:3000${pathname}`;
  return {
    url,
    method,
    nextUrl: new URL(url),
    headers: new Headers({ host: 'localhost:3000' }),
    cookies: { get: () => undefined },
    ip,
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  };
}

describe('middleware demo-mode dispatch order (characterization)', () => {
  beforeEach(() => {
    sqlMock.mockReset();
    sqlMock.mockResolvedValue([]);
    getToken.mockReset();
    getToken.mockResolvedValue(null);
    vi.stubEnv('DATABASE_URL', 'postgres://fake');
    vi.stubEnv('NEXTAUTH_SECRET', 'test-secret-1234567890');
    vi.stubEnv('DASHCLAW_MODE', 'demo');
  });

  it('OPTIONS preflight short-circuits to 204 before any dispatch', async () => {
    const res = await middleware(req('/api/actions', { method: 'OPTIONS' }));
    expect(res.status).toBe(204);
  });

  it('QUIRK: POST /api/halt hits the write-block BEFORE the halt handler → 403', async () => {
    // The halt handler has a POST branch, but the demo write-block runs
    // first and only exempts guard/actions/assumptions simulations.
    const res = await middleware(req('/api/halt', { method: 'POST', body: {} }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('Demo mode: write APIs are disabled.');
  });

  it('POST /api/policies/modes/import is mocked BEFORE the write-block → 201 (ProfileBand demo-safe)', async () => {
    const res = await middleware(req('/api/policies/modes/import', { method: 'POST', body: { mode_id: 'soc2' } }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.demo).toBe(true);
    expect(body.imported).toBeGreaterThan(0);
  });

  it('POST /api/actions is an allowed simulation → 201', async () => {
    const res = await middleware(req('/api/actions', { method: 'POST', body: { action_type: 'demo' } }));
    expect(res.status).toBe(201);
  });

  it('exact /api/actions/stats wins over the 3-segment action-detail catch-all', async () => {
    const res = await middleware(req('/api/actions/stats'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.error).toBeUndefined();
  });

  it('unknown 3-segment /api/actions/:id falls to the action-detail catch-all → 404', async () => {
    const res = await middleware(req('/api/actions/act_does_not_exist'));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Action not found');
  });

  it('unknown endpoint falls through the whole table → 403 endpoint disabled', async () => {
    const res = await middleware(req('/api/definitely-not-a-route'));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('Demo mode: endpoint disabled.');
  });

  it('/api/marketing/* passes through to the real handler (no demo JSON)', async () => {
    const res = await middleware(req('/api/marketing/track', { method: 'POST', body: {} }));
    expect((res.headers.get('content-type') || '')).not.toContain('application/json');
  });

  it('/api/prompts/server-setup/raw passes through (static markdown endpoints work in demo)', async () => {
    const res = await middleware(req('/api/prompts/server-setup/raw'));
    expect((res.headers.get('content-type') || '')).not.toContain('application/json');
  });

  it('GET /api/webhooks/:id/deliveries matches the segment pattern', async () => {
    const res = await middleware(req('/api/webhooks/wh_demo_001/deliveries'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('deliveries');
  });

  it('GET /api/context/threads/:id (unknown) → 404 Thread not found', async () => {
    const res = await middleware(req('/api/context/threads/ct_does_not_exist'));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Thread not found');
  });

  it('non-API page routes in demo mode pass through without auth redirect', async () => {
    const res = await middleware(req('/approvals'));
    expect(res.headers.get('location')).toBeNull();
  });

  it('/.well-known/jwks.json passes through with security headers in demo mode too', async () => {
    const res = await middleware(req('/.well-known/jwks.json'));
    expect(res.headers.get('location')).toBeNull();
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });
});
