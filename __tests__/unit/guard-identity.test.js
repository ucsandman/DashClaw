import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../../app/lib/jwks-verifier', () => ({
  verifyJwt: vi.fn(),
  extractBearerToken: vi.fn((header) => {
    if (!header) return null;
    const m = /^Bearer\s+(.+)$/i.exec(header);
    return m ? m[1] : null;
  }),
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

describe('resolveAgentIdentity — identity override', () => {
  it('JWT sub overrides body agent_id; agent_name only fills when absent', async () => {
    verifyJwt.mockResolvedValue(verified());
    checkAndRecord.mockResolvedValue('recorded');
    const data = { agent_id: 'agent-body', agent_name: 'Body Name' };
    await resolveAgentIdentity(req('Bearer tok'), data, SQL);
    expect(data.agent_id).toBe('agent-jwt');
    expect(data.agent_name).toBe('Body Name');
  });

  it('fills agent_name from the JWT claim when the body omits it', async () => {
    verifyJwt.mockResolvedValue(verified());
    checkAndRecord.mockResolvedValue('recorded');
    const data = {};
    await resolveAgentIdentity(req('Bearer tok'), data, SQL);
    expect(data.agent_name).toBe('JWT Agent');
  });

  it('non-verified statuses never override body identity', async () => {
    verifyJwt.mockResolvedValue(verified({ verification_status: 'failed' }));
    const data = { agent_id: 'agent-body' };
    await resolveAgentIdentity(req('Bearer tok'), data, SQL);
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
    await resolveAgentIdentity(req('Bearer tok'), data, SQL);
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
    await resolveAgentIdentity(req('Bearer tok'), data, SQL);
    expect(data.replay_status).toBe('exp_too_far');
    expect(checkAndRecord).not.toHaveBeenCalled();
  });

  it("replay mode 'off' → 'disabled' (distinct from not_applicable), store untouched", async () => {
    getJtiReplayMode.mockReturnValue('off');
    verifyJwt.mockResolvedValue(verified());
    const data = {};
    await resolveAgentIdentity(req('Bearer tok'), data, SQL);
    expect(data.replay_status).toBe('disabled');
    expect(checkAndRecord).not.toHaveBeenCalled();
  });

  it('verified without a jti → not_present', async () => {
    verifyJwt.mockResolvedValue(verified({ jti: null }));
    const data = {};
    await resolveAgentIdentity(req('Bearer tok'), data, SQL);
    expect(data.replay_status).toBe('not_present');
    expect(checkAndRecord).not.toHaveBeenCalled();
  });

  it('oversized jti (>1024 chars) never reaches the store → not_present', async () => {
    verifyJwt.mockResolvedValue(verified({ jti: 'x'.repeat(1025) }));
    const data = {};
    await resolveAgentIdentity(req('Bearer tok'), data, SQL);
    expect(data.replay_status).toBe('not_present');
    expect(checkAndRecord).not.toHaveBeenCalled();
  });

  it('jti without a numeric exp cannot be TTLd → not_present', async () => {
    verifyJwt.mockResolvedValue(verified({ exp: undefined }));
    const data = {};
    await resolveAgentIdentity(req('Bearer tok'), data, SQL);
    expect(data.replay_status).toBe('not_present');
    expect(checkAndRecord).not.toHaveBeenCalled();
  });

  it('verified with a null issuer (defense in depth) → not_present, no throw', async () => {
    verifyJwt.mockResolvedValue(verified({ issuer: null }));
    const data = {};
    await resolveAgentIdentity(req('Bearer tok'), data, SQL);
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
    await resolveAgentIdentity(req('Bearer tok'), data, SQL);
    expect(resolveActStatus).toHaveBeenCalled();
    expect(data.act_status).toBe('match');
    expect(data.act_hash).toBe('abc123');
  });

  it('act_hash is null when the token carries no binding', async () => {
    verifyJwt.mockResolvedValue(verified());
    checkAndRecord.mockResolvedValue('recorded');
    const data = {};
    await resolveAgentIdentity(req('Bearer tok'), data, SQL);
    expect(data.act_hash).toBeNull();
  });
});
