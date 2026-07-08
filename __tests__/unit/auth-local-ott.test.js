import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// `npx dashclaw up` mints DASHCLAW_LOGIN_OTT (<token>.<expiryEpochMs>) into
// .env.local and opens /login?ott=<token> so the browser lands signed in.
// The route must treat the token like a password: timing-safe, lockout-guarded,
// expiring, and single-use per server process.
const { mockSql, mockGetLockState, mockRecordFailure, mockClearFailures } = vi.hoisted(() => ({
  mockSql: Object.assign(vi.fn(async () => []), { query: vi.fn(async () => []) }),
  mockGetLockState: vi.fn(),
  mockRecordFailure: vi.fn(),
  mockClearFailures: vi.fn(),
}));

vi.mock('@/lib/db.js', () => ({ getSql: () => mockSql }));
// JWT minting is not under test (and jose's dual-build trips vitest).
vi.mock('jose', () => ({
  SignJWT: class {
    setProtectedHeader() { return this; }
    setIssuedAt() { return this; }
    setExpirationTime() { return this; }
    async sign() { return 'test.jwt.token'; }
  },
}));
vi.mock('@/lib/repositories/login-guard.repository.ts', () => ({
  getLoginLockState: mockGetLockState,
  recordLoginFailure: mockRecordFailure,
  clearLoginFailures: mockClearFailures,
}));

const { POST } = await import('@/api/auth/local/route.ts');

const TEST_PASSWORD = 'test-admin-password'; // placeholder only — unit test fixture
const TEST_TOKEN = 'test-ott-token-fixture';

function req(body) {
  return new Request('http://localhost:3000/api/auth/local', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('one-time login token (DASHCLAW_LOGIN_OTT)', () => {
  beforeEach(() => {
    vi.stubEnv('DASHCLAW_LOCAL_ADMIN_PASSWORD', TEST_PASSWORD);
    vi.stubEnv('NEXTAUTH_SECRET', 'test-nextauth-secret-placeholder');
    vi.stubEnv('DASHCLAW_LOGIN_OTT', `${TEST_TOKEN}.${Date.now() + 60_000}`);
    mockGetLockState.mockReset().mockResolvedValue({ locked: false });
    mockRecordFailure.mockReset().mockResolvedValue(undefined);
    mockClearFailures.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => vi.unstubAllEnvs());

  it('valid token signs in, sets the session cookie, and is consumed', async () => {
    const res = await POST(req({ ott: TEST_TOKEN }));
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toContain('dashclaw-local-session');
    expect(process.env.DASHCLAW_LOGIN_OTT).toBeUndefined();
    expect(mockClearFailures).toHaveBeenCalledTimes(1);
  });

  it('is single-use: the second exchange fails and records a failure', async () => {
    expect((await POST(req({ ott: TEST_TOKEN }))).status).toBe(200);
    const res = await POST(req({ ott: TEST_TOKEN }));
    expect(res.status).toBe(401);
    expect(mockRecordFailure).toHaveBeenCalledTimes(1);
  });

  it('expired token is rejected', async () => {
    vi.stubEnv('DASHCLAW_LOGIN_OTT', `${TEST_TOKEN}.${Date.now() - 1}`);
    const res = await POST(req({ ott: TEST_TOKEN }));
    expect(res.status).toBe(401);
    expect(mockRecordFailure).toHaveBeenCalledTimes(1);
  });

  it('wrong token is rejected and does not consume the real one', async () => {
    const res = await POST(req({ ott: 'not-the-token' }));
    expect(res.status).toBe(401);
    expect(process.env.DASHCLAW_LOGIN_OTT).toContain(TEST_TOKEN);
  });

  it('no token configured: exchange is rejected', async () => {
    vi.stubEnv('DASHCLAW_LOGIN_OTT', '');
    const res = await POST(req({ ott: TEST_TOKEN }));
    expect(res.status).toBe(401);
  });

  it('lockout applies to token exchange too', async () => {
    mockGetLockState.mockResolvedValue({ locked: true, retryAfterSeconds: 600 });
    const res = await POST(req({ ott: TEST_TOKEN }));
    expect(res.status).toBe(429);
  });

  it('password sign-in still works alongside the token path', async () => {
    const res = await POST(req({ password: TEST_PASSWORD }));
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toContain('dashclaw-local-session');
  });
});
