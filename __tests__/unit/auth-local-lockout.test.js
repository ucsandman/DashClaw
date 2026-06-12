import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The local admin login must be brute-force resistant: the only throttle used
// to be the per-instance in-memory rate limiter, so a distributed guesser
// could grind DASHCLAW_LOCAL_ADMIN_PASSWORD into a 7-day admin JWT. The route
// now consults a DB-backed failure counter (login-guard repository) and locks
// the target after repeated failures.
const { mockSql, mockGetLockState, mockRecordFailure, mockClearFailures } = vi.hoisted(() => ({
  mockSql: Object.assign(vi.fn(async () => []), { query: vi.fn(async () => []) }),
  mockGetLockState: vi.fn(),
  mockRecordFailure: vi.fn(),
  mockClearFailures: vi.fn(),
}));

vi.mock('@/lib/db.js', () => ({ getSql: () => mockSql }));
// JWT minting is not under test (and jose's dual-build trips vitest);
// the subject here is the lockout wiring around it.
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

function req(body) {
  return new Request('http://localhost:3000/api/auth/local', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('local admin login lockout', () => {
  beforeEach(() => {
    vi.stubEnv('DASHCLAW_LOCAL_ADMIN_PASSWORD', TEST_PASSWORD);
    vi.stubEnv('NEXTAUTH_SECRET', 'test-nextauth-secret-placeholder');
    mockGetLockState.mockReset().mockResolvedValue({ locked: false });
    mockRecordFailure.mockReset().mockResolvedValue(undefined);
    mockClearFailures.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => vi.unstubAllEnvs());

  it('locked target: 429 with Retry-After even for the correct password', async () => {
    mockGetLockState.mockResolvedValue({ locked: true, retryAfterSeconds: 600 });
    const res = await POST(req({ password: TEST_PASSWORD }));
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('600');
  });

  it('wrong password records a failure', async () => {
    const res = await POST(req({ password: 'wrong' }));
    expect(res.status).toBe(401);
    expect(mockRecordFailure).toHaveBeenCalledTimes(1);
  });

  it('correct password clears the failure counter and sets the session cookie', async () => {
    const res = await POST(req({ password: TEST_PASSWORD }));
    expect(res.status).toBe(200);
    expect(mockClearFailures).toHaveBeenCalledTimes(1);
    expect(res.headers.get('set-cookie')).toContain('dashclaw-local-session');
  });

  it('fails open when the guard store is unavailable (env password still required)', async () => {
    mockGetLockState.mockRejectedValue(new Error('db down'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await POST(req({ password: TEST_PASSWORD }));
    expect(res.status).toBe(200);
    expect(warn).toHaveBeenCalled();
  });
});
