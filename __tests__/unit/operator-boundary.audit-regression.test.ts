// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetToken, mockSql } = vi.hoisted(() => ({
  mockGetToken: vi.fn(),
  mockSql: vi.fn(),
}));

vi.mock('next-auth/jwt', () => ({ getToken: mockGetToken }));
vi.mock('@neondatabase/serverless', () => ({ neon: vi.fn(() => mockSql) }));
vi.mock('@/lib/db.js', () => ({ getSql: () => mockSql }));
vi.mock('@/lib/authConfig.mjs', () => ({
  getAuthConfig: () => ({ hasGitHub: true, hasGoogle: true, hasOIDC: false }),
}));
vi.mock('@/lib/hosted/flag', () => ({
  isHostedMode: () => false,
  hostedConfig: () => ({ trialDays: 30, trialActionCap: 10000, maxActiveTrials: 500 }),
}));
vi.mock('@/lib/repositories/hosted-workspace.repository.js', () => ({
  applyHostedTrial: vi.fn(),
  markTrialFull: vi.fn(),
  countActiveTrials: vi.fn(async () => 0),
  getHostedWorkspace: vi.fn(),
}));
vi.mock('@/lib/repositories/invites.repository.js', () => ({
  findPendingInviteByEmail: vi.fn(async () => null),
  acceptInvite: vi.fn(),
}));

const { middleware } = await import('../../middleware.js');
const { GET: revealKey } = await import('../../app/api/keys/reveal/route.js');
const { authOptions } = await import('../../app/lib/auth.js');

const jwt = authOptions.callbacks.jwt;
const session = authOptions.callbacks.session;
const originalEnv = { ...process.env };

function middlewareRequest(
  pathname: string,
  headers: Record<string, string> = {},
  method = 'GET',
) {
  const url = `http://localhost:3000${pathname}`;
  return {
    url,
    method,
    nextUrl: new URL(url),
    headers: new Headers(headers),
    cookies: { get: () => undefined },
    ip: '127.0.0.1',
  };
}

function revealRequestFromMiddleware(response: Response) {
  const headers = new Headers();
  for (const name of ['x-org-id', 'x-org-role', 'x-user-id', 'x-auth-kind']) {
    const value = response.headers.get(`x-middleware-request-${name}`);
    if (value) headers.set(name, value);
  }
  return new Request('http://localhost:3000/api/keys/reveal', { headers });
}

function directRevealHeaders(overrides: Record<string, string> = {}) {
  return {
    'x-org-id': 'org_operator',
    'x-org-role': 'admin',
    'x-user-id': 'usr_operator',
    'x-auth-kind': 'session',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env = { ...originalEnv };
  process.env.DATABASE_URL = 'postgres://test';
  process.env.DASHCLAW_API_KEY = 'test-bootstrap-key-not-a-secret';
  process.env.DASHCLAW_API_KEY_ORG = 'org_operator';
  mockSql.mockResolvedValue([]);
  mockGetToken.mockResolvedValue(null);
});

afterEach(() => {
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
});

describe('F01: deployment operator key reveal boundary', () => {
  it('allows the resolved human operator session in the configured operator org', async () => {
    mockGetToken.mockResolvedValue({
      orgId: 'org_operator', role: 'admin', userId: 'usr_operator', sub: 'oauth-subject',
    });
    const forwarded = await middleware(middlewareRequest('/api/keys/reveal', {
      'sec-fetch-site': 'same-origin',
    }));

    expect(forwarded.status).toBe(200);
    expect(forwarded.headers.get('x-middleware-request-x-auth-kind')).toBe('session');

    const response = await revealKey(revealRequestFromMiddleware(forwarded));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect((await response.json()).key).toBe('test-bootstrap-key-not-a-secret');
  });

  it('rejects an unrelated tenant admin session after real middleware attestation', async () => {
    mockGetToken.mockResolvedValue({
      orgId: 'org_unrelated', role: 'admin', userId: 'usr_unrelated', sub: 'oauth-subject',
    });
    const forwarded = await middleware(middlewareRequest('/api/keys/reveal', {
      'sec-fetch-site': 'same-origin',
    }));
    const response = await revealKey(revealRequestFromMiddleware(forwarded));
    expect(response.status).toBe(403);
  });

  it('rejects the operator API key even though middleware attributes it as admin', async () => {
    const forwarded = await middleware(middlewareRequest('/api/keys/reveal', {
      'x-api-key': 'test-bootstrap-key-not-a-secret',
    }));
    expect(forwarded.status).toBe(200);
    expect(forwarded.headers.get('x-middleware-request-x-auth-kind')).toBe('operator-key');

    const response = await revealKey(revealRequestFromMiddleware(forwarded));
    expect(response.status).toBe(403);
  });

  it('preserves the explicitly attested local-admin human session', async () => {
    const response = await revealKey(new Request('http://localhost:3000/api/keys/reveal', {
      headers: directRevealHeaders({
        'x-user-id': 'usr_local_admin',
        'x-auth-kind': 'local-admin',
      }),
    }));
    expect(response.status).toBe(200);
  });

  it('rejects missing auth-kind attestation and an unauthenticated request', async () => {
    const missingKind = await revealKey(new Request('http://localhost:3000/api/keys/reveal', {
      headers: directRevealHeaders({ 'x-auth-kind': '' }),
    }));
    expect(missingKind.status).toBe(403);

    const anonymous = await revealKey(new Request('http://localhost:3000/api/keys/reveal'));
    expect(anonymous.status).toBe(401);
  });

  it('strips a forged inbound auth kind instead of upgrading an anonymous caller', async () => {
    const response = await middleware(middlewareRequest('/api/keys/reveal', {
      'sec-fetch-site': 'same-origin',
      'x-auth-kind': 'session',
      'x-org-id': 'org_operator',
      'x-org-role': 'admin',
      'x-user-id': 'usr_forged',
    }));
    expect(response.status).toBe(401);
    expect(response.headers.get('x-middleware-request-x-auth-kind')).toBeNull();
  });
});

describe('F02: initial membership resolution fails closed', () => {
  it('rejects initial JWT issuance when no authoritative membership exists', async () => {
    mockSql.mockResolvedValueOnce([]);
    await expect(jwt({
      token: { sub: 'oauth-subject' },
      account: { provider: 'google', providerAccountId: 'missing-user' },
    })).rejects.toThrow(/membership/i);
  });

  it('rejects initial JWT issuance when membership lookup throws', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mockSql.mockRejectedValueOnce(new Error('membership database unavailable'));
    await expect(jwt({
      token: { sub: 'oauth-subject' },
      account: { provider: 'google', providerAccountId: 'lookup-error' },
    })).rejects.toThrow('membership database unavailable');
  });

  it('does not compose a default-org session from unresolved claims', async () => {
    await expect(session({
      session: { user: {} },
      token: { sub: 'oauth-subject' },
    })).rejects.toThrow(/membership/i);
  });

  it('middleware rejects a signed session that lacks resolved identity claims', async () => {
    mockGetToken.mockResolvedValue({ orgId: 'org_operator', role: 'member', sub: 'oauth-subject' });
    const response = await middleware(middlewareRequest('/api/actions', {
      'sec-fetch-site': 'same-origin',
    }));
    expect(response.status).toBe(401);
    expect(response.headers.get('x-middleware-request-x-org-id')).toBeNull();
  });

  it('preserves a fully resolved member session', async () => {
    mockGetToken.mockResolvedValue({
      orgId: 'org_member', role: 'member', userId: 'usr_member', sub: 'oauth-subject',
    });
    const response = await middleware(middlewareRequest('/api/actions', {
      'sec-fetch-site': 'same-origin',
    }));
    expect(response.status).toBe(200);
    expect(response.headers.get('x-middleware-request-x-org-id')).toBe('org_member');
    expect(response.headers.get('x-middleware-request-x-auth-kind')).toBe('session');
  });
});
