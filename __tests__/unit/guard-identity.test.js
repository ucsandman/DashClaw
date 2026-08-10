import { describe, expect, it, vi, beforeEach } from 'vitest';

// Only verifyJwt is mocked: extractBearerToken and looksLikeJwt are the real
// implementations, because "is this bearer even an identity claim?" is exactly
// the behavior under test.
vi.mock('../../app/lib/jwks-verifier', async (importOriginal) => ({
  ...(await importOriginal()),
  verifyJwt: vi.fn(),
}));
vi.mock('../../app/lib/repositories/jti-replay.repository', () => ({
  checkAndRecord: vi.fn(),
}));
vi.mock('../../app/lib/act-binding', () => ({
  resolveActStatus: vi.fn(() => 'not_applicable'),
}));
vi.mock('../../app/lib/replay-protection', () => ({
  getJtiReplayMode: vi.fn(() => 'required'),
}));

import { resolveAgentIdentity } from '../../app/lib/guard-identity';
import { verifyJwt } from '../../app/lib/jwks-verifier';
import { checkAndRecord } from '../../app/lib/repositories/jti-replay.repository';
import { resolveActStatus } from '../../app/lib/act-binding';
import { getJtiReplayMode } from '../../app/lib/replay-protection';

const SQL = {};
// JWT-shaped bearer (3 base64url segments) — the only kind that counts as an
// identity claim. Its contents don't matter here: verifyJwt is mocked.
const JWT = 'aaa.bbb.ccc';

function req(authHeader) {
  return new Request('http://localhost/api/guard', {
    method: 'POST',
    headers: authHeader ? { authorization: authHeader } : {},
  });
}

function verified(overrides = {}) {
  return {
    verification_status: 'verified',
    agent_id: 'agent-jwt',
    agent_name: 'JWT Agent',
    jti: 'jti-1',
    exp: 1900000000,
    issuer: 'https://issuer.example',
    act: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getJtiReplayMode.mockReturnValue('required');
  resolveActStatus.mockReturnValue('not_applicable');
});

describe('resolveAgentIdentity — no bearer token', () => {
  it('stamps the Phase 1 defaults and never calls the verifier', async () => {
    const data = { agent_id: 'agent-body' };
    await resolveAgentIdentity(req(null), data, SQL);
    expect(data.verification_status).toBe('unverified');
    expect(data.replay_status).toBe('not_applicable');
    expect(data.jti).toBeNull();
    expect(data.act_status).toBe('not_applicable');
    expect(data.act_hash).toBeNull();
    expect(data.agent_id).toBe('agent-body');
    expect(verifyJwt).not.toHaveBeenCalled();
  });
});

describe('resolveAgentIdentity — opaque credential in the Bearer slot', () => {
  // Regression (2026-08-10): /api/mcp forwards the OAuth AS's opaque `oat_`
  // access token as a Bearer. It is a credential, not an identity claim, so it
  // must take the same path as "no token" — never burn the 'failed' label,
  // which means a REJECTED identity claim.
  it('opaque OAuth access token → unverified, verifier never called', async () => {
    const data = { agent_id: 'claude-desktop' };
    await resolveAgentIdentity(req('Bearer oat_ZmFrZW9hdXRodG9rZW4'), data, SQL);
    expect(data.verification_status).toBe('unverified');
    expect(data.replay_status).toBe('not_applicable');
    expect(data.agent_id).toBe('claude-desktop');
    expect(verifyJwt).not.toHaveBeenCalled();
  });
});

describe('resolveAgentIdentity — identity override', () => {
  it('JWT sub overrides body agent_id; agent_name only fills when absent', async () => {
    verifyJwt.mockResolvedValue(verified());
    checkAndRecord.mockResolvedValue('recorded');
    const data = { agent_id: 'agent-body', agent_name: 'Body Name' };
    await resolveAgentIdentity(req(`Bearer ${JWT}`), data, SQL);
    expect(data.agent_id).toBe('agent-jwt');
    expect(data.agent_name).toBe('Body Name');
  });

  it('fills agent_name from the JWT claim when the body omits it', async () => {
    verifyJwt.mockResolvedValue(verified());
    checkAndRecord.mockResolvedValue('recorded');
    const data = {};
    await resolveAgentIdentity(req(`Bearer ${JWT}`), data, SQL);
    expect(data.agent_name).toBe('JWT Agent');
  });

  it('non-verified statuses never override body identity', async () => {
    verifyJwt.mockResolvedValue(verified({ verification_status: 'failed' }));
    const data = { agent_id: 'agent-body' };
    await resolveAgentIdentity(req(`Bearer ${JWT}`), data, SQL);
    expect(data.agent_id).toBe('agent-body');
    expect(data.verification_status).toBe('failed');
    expect(data.replay_status).toBe('not_applicable');
  });
});

describe('resolveAgentIdentity — replay_status matrix', () => {
  it('verified + jti + exp + issuer → repository result passes through', async () => {
    verifyJwt.mockResolvedValue(verified());
    checkAndRecord.mockResolvedValue('recorded');
    const data = {};
    await resolveAgentIdentity(req(`Bearer ${JWT}`), data, SQL);
    expect(checkAndRecord).toHaveBeenCalledWith(SQL, {
      jti: 'jti-1',
      issuer: 'https://issuer.example',
      expiresAt: 1900000000,
      agentId: 'agent-jwt',
    });
    expect(data.replay_status).toBe('recorded');
  });

  it('exp_too_far flows through verification status without touching the store', async () => {
    verifyJwt.mockResolvedValue(verified({ verification_status: 'exp_too_far' }));
    const data = {};
    await resolveAgentIdentity(req(`Bearer ${JWT}`), data, SQL);
    expect(data.replay_status).toBe('exp_too_far');
    expect(checkAndRecord).not.toHaveBeenCalled();
  });

  it("replay mode 'off' → 'disabled' (distinct from not_applicable), store untouched", async () => {
    getJtiReplayMode.mockReturnValue('off');
    verifyJwt.mockResolvedValue(verified());
    const data = {};
    await resolveAgentIdentity(req(`Bearer ${JWT}`), data, SQL);
    expect(data.replay_status).toBe('disabled');
    expect(checkAndRecord).not.toHaveBeenCalled();
  });

  it('verified without a jti → not_present', async () => {
    verifyJwt.mockResolvedValue(verified({ jti: null }));
    const data = {};
    await resolveAgentIdentity(req(`Bearer ${JWT}`), data, SQL);
    expect(data.replay_status).toBe('not_present');
    expect(checkAndRecord).not.toHaveBeenCalled();
  });

  it('oversized jti (>1024 chars) never reaches the store → not_present', async () => {
    verifyJwt.mockResolvedValue(verified({ jti: 'x'.repeat(1025) }));
    const data = {};
    await resolveAgentIdentity(req(`Bearer ${JWT}`), data, SQL);
    expect(data.replay_status).toBe('not_present');
    expect(checkAndRecord).not.toHaveBeenCalled();
  });

  it('jti without a numeric exp cannot be TTLd → not_present', async () => {
    verifyJwt.mockResolvedValue(verified({ exp: undefined }));
    const data = {};
    await resolveAgentIdentity(req(`Bearer ${JWT}`), data, SQL);
    expect(data.replay_status).toBe('not_present');
    expect(checkAndRecord).not.toHaveBeenCalled();
  });

  it('verified with a null issuer (defense in depth) → not_present, no throw', async () => {
    verifyJwt.mockResolvedValue(verified({ issuer: null }));
    const data = {};
    await resolveAgentIdentity(req(`Bearer ${JWT}`), data, SQL);
    expect(data.replay_status).toBe('not_present');
    expect(checkAndRecord).not.toHaveBeenCalled();
  });
});

describe('resolveAgentIdentity — act binding', () => {
  it('act_status comes from resolveActStatus and act_hash from the token binding', async () => {
    verifyJwt.mockResolvedValue(verified({ act: { hash: 'abc123' } }));
    checkAndRecord.mockResolvedValue('recorded');
    resolveActStatus.mockReturnValue('match');
    const data = {};
    await resolveAgentIdentity(req(`Bearer ${JWT}`), data, SQL);
    expect(resolveActStatus).toHaveBeenCalled();
    expect(data.act_status).toBe('match');
    expect(data.act_hash).toBe('abc123');
  });

  it('act_hash is null when the token carries no binding', async () => {
    verifyJwt.mockResolvedValue(verified());
    checkAndRecord.mockResolvedValue('recorded');
    const data = {};
    await resolveAgentIdentity(req(`Bearer ${JWT}`), data, SQL);
    expect(data.act_hash).toBeNull();
  });
});
