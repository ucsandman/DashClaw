/**
 * Phase 2 JWKS verification tests.
 *
 * Uses a local in-memory JWKS fixture — no real HTTP calls, no AgentLair
 * dependency. The test JWT is signed with an Ed25519 key generated once at
 * the top of the file so every assertion uses real cryptography.
 *
 * AgentLair is mentioned only in comments as a docs example of a compatible
 * issuer (it publishes JWKS at agentlair.dev/.well-known/jwks.json).
 */
import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';

// ─── Route-level mocks (must be top-level for vi.hoisted/vi.mock hoisting) ──

const { mockSql, mockValidateGuardInput, mockEvaluateGuard } = vi.hoisted(() => ({
  mockSql: Object.assign(vi.fn(async () => []), { query: vi.fn(async () => []) }),
  mockValidateGuardInput: vi.fn(),
  mockEvaluateGuard: vi.fn(),
}));

vi.mock('@/lib/db.js', () => ({ getSql: () => mockSql }));
vi.mock('@/lib/validate', () => ({ validateGuardInput: mockValidateGuardInput, boundedIdField: (v) => (typeof v === 'string' && v.length > 0 && v.length <= 200 ? v : null), enforcementModeField: (v) => (typeof v === 'string' && ['enforce', 'observe', 'warn', 'off'].includes(v.trim().toLowerCase()) ? v.trim().toLowerCase() : null) }));
vi.mock('@/lib/guard', () => ({ evaluateGuard: mockEvaluateGuard }));
vi.mock('@/lib/repositories/guard.repository.js', () => ({ listGuardDecisions: vi.fn() }));
// Phase 2b: stub the replay store so verified-token tests don't silently
// hit real checkAndRecord against mockSql (which would return 'replayed'
// for every call because [] from mock SQL == ON CONFLICT path).
vi.mock('@/lib/repositories/jti-replay.repository.js', () => ({
  checkAndRecord: vi.fn(async () => 'unique'),
  sweep: vi.fn(async () => 0),
}));

// ─── Generate Ed25519 key pair for tests ────────────────────────────────────

const subtle = globalThis.crypto.subtle;

async function generateKeyPair() {
  return subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
}

async function sign(privateKey, payload) {
  const header = { alg: 'EdDSA', kid: 'test-key-1' };
  const encode = (obj) =>
    Buffer.from(JSON.stringify(obj)).toString('base64url');
  const signingInput = `${encode(header)}.${encode(payload)}`;
  const sig = await subtle.sign('Ed25519', privateKey, Buffer.from(signingInput));
  const sigB64 = Buffer.from(sig).toString('base64url');
  return `${signingInput}.${sigB64}`;
}

async function exportJwk(publicKey) {
  return subtle.exportKey('jwk', publicKey);
}

// ─── JWKS verifier module ────────────────────────────────────────────────────

// Stub global fetch before importing verifier — lets each test control JWKS responses
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Stub dns.lookup so the SSRF check in fetchJwks doesn't try to resolve
// `idp.example.com` (which would NXDOMAIN and fail-soft to 'unverified',
// breaking happy-path tests). Returns a public IP for any hostname.
vi.mock('node:dns/promises', () => ({
  default: {
    lookup: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]),
  },
  lookup: vi.fn(async () => [{ address: '93.184.216.34', family: 4 }]),
}));

import { verifyJwt, extractBearerToken, looksLikeJwt, _resetStateForTesting } from '@/lib/jwks-verifier.js';
import { ACT_BINDING_CLAIM } from '@/lib/act-binding.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const ISSUER = 'https://idp.example.com';

function validPayload(overrides = {}) {
  return {
    iss: ISSUER,
    sub: 'agt_abc123',
    agent_name: 'test-worker',
    aud: 'dashclaw.example.com',
    iat: Math.floor(Date.now() / 1000) - 10,
    exp: Math.floor(Date.now() / 1000) + 300,
    jti: 'txn_test_001',
    ...overrides,
  };
}

function mockJwksResponse(jwk, issuerUrl = ISSUER) {
  mockFetch.mockImplementation(async (url) => {
    const expected = `${issuerUrl}/.well-known/jwks.json`;
    if (url === expected) {
      return {
        ok: true,
        json: async () => ({ keys: [{ ...jwk, kid: 'test-key-1', use: 'sig', alg: 'EdDSA' }] }),
      };
    }
    throw new Error(`Unexpected JWKS URL: ${url}`);
  });
}

// ─── Tests: verifyJwt ────────────────────────────────────────────────────────

describe('verifyJwt — JWKS verification (Phase 2)', () => {
  let keyPair;
  let pubJwk;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Reset module-level JWKS cache + circuit breakers between tests
    _resetStateForTesting();
    // v3.7 fail-closed flip: verification requires a configured issuer, so the
    // test baseline configures one. The dedicated unconfigured-issuer test
    // deletes it to pin the fail-closed path.
    process.env.DASHCLAW_ALLOWED_ISSUER = ISSUER;
    delete process.env.DASHCLAW_JWT_AUDIENCE;
    keyPair = await generateKeyPair();
    pubJwk = await exportJwk(keyPair.publicKey);
  });

  afterEach(() => {
    delete process.env.DASHCLAW_ALLOWED_ISSUER;
    delete process.env.DASHCLAW_JWT_AUDIENCE;
  });

  it('returns verified for a valid Ed25519 JWT', async () => {
    mockJwksResponse(pubJwk);
    const token = await sign(keyPair.privateKey, validPayload());
    const result = await verifyJwt(token);

    expect(result.verification_status).toBe('verified');
    expect(result.agent_id).toBe('agt_abc123');
    expect(result.agent_name).toBe('test-worker');
    expect(result.issuer).toBe(ISSUER);
  });

  it('surfaces the Phase 2c action-binding claim on a verified token', async () => {
    mockJwksResponse(pubJwk);
    const token = await sign(keyPair.privateKey, validPayload({
      [ACT_BINDING_CLAIM]: { typ: 'action-binding/v1', hash: 'sha256:abc123' },
    }));
    const result = await verifyJwt(token);

    expect(result.verification_status).toBe('verified');
    expect(result.act).toEqual({ typ: 'action-binding/v1', hash: 'sha256:abc123' });
    expect(result.act_typ_supported).toBe(true);
  });

  it('reports act=null and act_typ_supported=false when a verified token has no binding', async () => {
    mockJwksResponse(pubJwk);
    const token = await sign(keyPair.privateKey, validPayload());
    const result = await verifyJwt(token);

    expect(result.verification_status).toBe('verified');
    expect(result.act).toBeNull();
    expect(result.act_typ_supported).toBe(false);
  });

  it('returns expired for a JWT whose exp is in the past', async () => {
    // Expiry check is a fast path — no JWKS fetch needed
    const token = await sign(keyPair.privateKey, validPayload({
      exp: Math.floor(Date.now() / 1000) - 60,
    }));
    const result = await verifyJwt(token);

    expect(result.verification_status).toBe('expired');
    expect(result.agent_id).toBe('agt_abc123');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns failed for a JWT with a bad signature', async () => {
    // Sign with the real key, then tamper with the payload b64url
    const goodToken = await sign(keyPair.privateKey, validPayload());
    const parts = goodToken.split('.');
    const tamperedPayload = parts[1].slice(0, -1) + (parts[1].at(-1) === 'A' ? 'B' : 'A');
    const tamperedToken = `${parts[0]}.${tamperedPayload}.${parts[2]}`;

    mockJwksResponse(pubJwk);
    const result = await verifyJwt(tamperedToken);
    expect(result.verification_status).toBe('failed');
  });

  it('returns unverified (never verified) when DASHCLAW_ALLOWED_ISSUER is not configured — v3.7 fail-closed', async () => {
    delete process.env.DASHCLAW_ALLOWED_ISSUER;
    mockJwksResponse(pubJwk);

    const token = await sign(keyPair.privateKey, validPayload());
    const result = await verifyJwt(token);

    expect(result.verification_status).toBe('unverified');
    // Fail-closed means no trust anchor → the JWKS is never even fetched.
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns unknown_issuer when DASHCLAW_ALLOWED_ISSUER is set and issuer does not match', async () => {
    process.env.DASHCLAW_ALLOWED_ISSUER = 'https://allowed-idp.example.com';

    const token = await sign(keyPair.privateKey, validPayload({
      iss: 'https://untrusted-idp.example.com',
    }));
    const result = await verifyJwt(token);

    expect(result.verification_status).toBe('unknown_issuer');
    expect(mockFetch).not.toHaveBeenCalled(); // Rejected before JWKS fetch
  });

  it('returns verified when DASHCLAW_ALLOWED_ISSUER matches', async () => {
    process.env.DASHCLAW_ALLOWED_ISSUER = ISSUER;
    mockJwksResponse(pubJwk);

    const token = await sign(keyPair.privateKey, validPayload());
    const result = await verifyJwt(token);

    expect(result.verification_status).toBe('verified');
  });

  it('returns failed when aud does not match DASHCLAW_JWT_AUDIENCE', async () => {
    process.env.DASHCLAW_JWT_AUDIENCE = 'dashclaw.production.example.com';
    mockJwksResponse(pubJwk);

    const token = await sign(keyPair.privateKey, validPayload({
      aud: 'dashclaw.staging.example.com',
    }));
    const result = await verifyJwt(token);

    expect(result.verification_status).toBe('failed');
  });

  it('returns verified when aud matches DASHCLAW_JWT_AUDIENCE', async () => {
    process.env.DASHCLAW_JWT_AUDIENCE = 'dashclaw.example.com';
    mockJwksResponse(pubJwk);

    const token = await sign(keyPair.privateKey, validPayload({
      aud: 'dashclaw.example.com',
    }));
    const result = await verifyJwt(token);

    expect(result.verification_status).toBe('verified');
  });

  it('returns unverified (fail-soft) when JWKS fetch fails with network error', async () => {
    mockFetch.mockRejectedValue(
      Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })
    );

    const token = await sign(keyPair.privateKey, validPayload());
    const result = await verifyJwt(token);

    expect(result.verification_status).toBe('unverified');
  });

  it('returns unverified (fail-soft) when JWKS endpoint is slow and AbortController fires', async () => {
    mockFetch.mockRejectedValue(
      Object.assign(new Error('aborted'), { name: 'AbortError' })
    );

    const token = await sign(keyPair.privateKey, validPayload());
    const result = await verifyJwt(token);

    expect(result.verification_status).toBe('unverified');
  });

  it('returns failed for a structurally invalid token string', async () => {
    const result = await verifyJwt('not.a.real.jwt.with.too.many.dots');
    expect(result.verification_status).toBe('failed');
  });
});

// ─── Tests: extractBearerToken ───────────────────────────────────────────────

describe('extractBearerToken', () => {
  it('extracts the token from a valid Bearer header', () => {
    expect(extractBearerToken('Bearer eyJhbGciOiJFZERTQSJ9.x.y')).toBe('eyJhbGciOiJFZERTQSJ9.x.y');
  });

  it('is case-insensitive on the Bearer prefix', () => {
    expect(extractBearerToken('bearer mytoken')).toBe('mytoken');
  });

  it('returns null for a non-Bearer scheme', () => {
    expect(extractBearerToken('Basic dXNlcjpwYXNz')).toBeNull();
  });

  it('returns null for a null input', () => {
    expect(extractBearerToken(null)).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(extractBearerToken('')).toBeNull();
  });
});

// ─── Tests: route-level verification_status ──────────────────────────────────

describe('/api/guard — Phase 2 verification_status on no-token path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATABASE_URL = 'postgres://unit-test';
    process.env.DASHCLAW_MODE = 'cloud';
    delete process.env.DASHCLAW_ALLOWED_ISSUER;
    delete process.env.DASHCLAW_JWT_AUDIENCE;
    mockSql.mockImplementation(async () => []);
    mockSql.query.mockImplementation(async () => []);
    mockEvaluateGuard.mockResolvedValue({
      decision: 'allow',
      reasons: [],
      warnings: [],
      matched_policies: [],
      verification_status: 'unverified',
    });
  });

  it('passes verification_status=unverified to evaluateGuard when no Authorization header is provided', async () => {
    mockValidateGuardInput.mockImplementation((b) => ({ valid: true, data: { ...b }, errors: [] }));

    const { makeRequest } = await import('../helpers.js');
    const { POST } = await import('@/api/guard/route.js');

    const req = makeRequest('http://localhost/api/guard', {
      headers: { 'x-org-id': 'org_1' },
      body: { action_type: 'read' },
    });
    const res = await POST(req);

    expect(res.status).toBe(200);
    expect(mockEvaluateGuard).toHaveBeenCalledWith(
      'org_1',
      expect.objectContaining({ verification_status: 'unverified' }),
      mockSql,
      expect.any(Object)
    );
  });

  it('body agent_id is preserved when there is no JWT token', async () => {
    mockValidateGuardInput.mockImplementation((b) => ({ valid: true, data: { ...b }, errors: [] }));

    const { makeRequest } = await import('../helpers.js');
    const { POST } = await import('@/api/guard/route.js');

    const req = makeRequest('http://localhost/api/guard', {
      headers: { 'x-org-id': 'org_1' },
      body: { action_type: 'deploy', agent_id: 'agt_body_id', agent_name: 'body-worker' },
    });
    await POST(req);

    expect(mockEvaluateGuard).toHaveBeenCalledWith(
      'org_1',
      expect.objectContaining({ agent_id: 'agt_body_id', agent_name: 'body-worker' }),
      mockSql,
      expect.any(Object)
    );
  });
});

describe('looksLikeJwt — is this bearer an identity claim at all?', () => {
  it('accepts a JWT-shaped token, including alg:none (empty signature)', () => {
    expect(looksLikeJwt('eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJhZ3RfMSJ9.c2ln')).toBe(true);
    expect(looksLikeJwt('eyJhbGciOiJub25lIn0.eyJzdWIiOiJhZ3RfMSJ9.')).toBe(true);
  });

  it('rejects opaque credentials — the OAuth AS token and API keys', () => {
    expect(looksLikeJwt('oat_ZmFrZW9hdXRodG9rZW4')).toBe(false);
    expect(looksLikeJwt('dc_live_abc123')).toBe(false);
    expect(looksLikeJwt('not.a.real.jwt.with.too.many.dots')).toBe(false);
    expect(looksLikeJwt('.eyJzdWIiOiJhIn0.c2ln')).toBe(false);
    expect(looksLikeJwt(null)).toBe(false);
    expect(looksLikeJwt('')).toBe(false);
  });
});
