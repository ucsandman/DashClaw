import { describe, it, expect, vi, beforeEach } from 'vitest';

// Page-gating coverage for config.matcher: the authenticated dashboards must be
// matched (so middleware's session gate runs and unauthenticated visitors are
// redirected to /login), and matcher entries for deleted pages must be gone.
// getToken is mocked to null so a matched page route deterministically
// redirects; neon is mocked so no real DB is needed.
vi.mock('next-auth/jwt', () => ({ getToken: vi.fn(async () => null) }));
const sqlMock = vi.fn(async () => []);
vi.mock('@neondatabase/serverless', () => ({ neon: vi.fn(() => sqlMock) }));

const { middleware, config } = await import('../../middleware.js');

function pageReq(pathname) {
  const url = `http://localhost:3000${pathname}`;
  return {
    url,
    method: 'GET',
    nextUrl: new URL(url),
    headers: new Headers(),
    cookies: { get: () => undefined },
    ip: '127.0.0.1',
  };
}

// Real authenticated dashboards that were missing from the matcher.
const NEWLY_GATED = ['/assumptions', '/scoring', '/policy-coach'];
// Deleted pages whose stale matcher entries were removed.
// (/labs retired in the studio consolidation — /labs/branch-finish now
// permanently redirects to /decisions before middleware runs.)
// (mission-control/dashboard/analytics/security/team/activity removed in the v5 cull.)
// (swarm removed in the v5 cull; /workflows/:path* survives for model strategies.)
const REMOVED_DEAD = ['/goals', '/content', '/relationships', '/calendar', '/tokens', '/labs',
  '/mission-control', '/dashboard', '/analytics', '/security', '/team', '/activity', '/swarm'];

describe('middleware page-route gating', () => {
  beforeEach(() => {
    vi.stubEnv('DATABASE_URL', 'postgres://fake');
    vi.stubEnv('NEXTAUTH_SECRET', 'test-secret-1234567890');
  });

  it('matches each real authenticated dashboard (exact + wildcard)', () => {
    for (const p of NEWLY_GATED) {
      expect(config.matcher, `${p} should be matched`).toContain(p);
      expect(config.matcher, `${p}/:path* should be matched`).toContain(`${p}/:path*`);
    }
  });

  it('no longer matches deleted pages', () => {
    for (const p of REMOVED_DEAD) {
      expect(config.matcher, `${p} should be gone`).not.toContain(p);
      expect(config.matcher, `${p}/:path* should be gone`).not.toContain(`${p}/:path*`);
    }
  });

  it('redirects an unauthenticated request to a newly-gated page to /login', async () => {
    const res = await middleware(pageReq('/analytics'));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/login');
  });
});
