import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ verifyJwt: vi.fn() }));
// Only verifyJwt is mocked: extractBearerToken and looksLikeJwt stay real, so
// "is this bearer an identity claim at all?" is exercised, not stubbed.
vi.mock('@/lib/jwks-verifier.js', async (importOriginal) => ({
  ...(await importOriginal()),
  verifyJwt: m.verifyJwt,
}));

const { resolveAgentIdentity } = await import('@/lib/identity-resolution.js');

function reqWith(headers = {}) {
  return { headers: new Headers(headers) };
}

// JWT-shaped bearer (3 base64url segments) — the only kind that counts as an
// identity claim. Its contents don't matter here: verifyJwt is mocked.
const JWT = 'aaa.bbb.ccc';

beforeEach(() => vi.clearAllMocks());

describe('resolveAgentIdentity (shared identity contract, R3)', () => {
  it('no bearer token → self-asserted identity, explicitly unverified', async () => {
    const id = await resolveAgentIdentity(reqWith(), { agentId: 'body_agent', agentName: 'Body' });
    expect(id.agent_id).toBe('body_agent');
    expect(id.verification_status).toBe('unverified');
    expect(id.verified).toBe(false);
    expect(m.verifyJwt).not.toHaveBeenCalled();
  });

  // Regression (2026-08-10): the built-in OAuth AS issues opaque `oat_` access
  // tokens and /api/mcp forwards them in the Authorization header. Running one
  // through verifyJwt can only return 'failed' — the label reserved for a
  // REJECTED identity claim — so every decision made through the Claude
  // consumer-app connector was stamped as a failed verification.
  it('opaque OAuth bearer is a credential, not an identity claim → unverified', async () => {
    const id = await resolveAgentIdentity(
      reqWith({ authorization: 'Bearer oat_ZmFrZW9hdXRodG9rZW4' }),
      { agentId: 'claude-desktop' },
    );
    expect(id.agent_id).toBe('claude-desktop');
    expect(id.verification_status).toBe('unverified');
    expect(id.verified).toBe(false);
    expect(m.verifyJwt).not.toHaveBeenCalled();
  });

  it('JWT-shaped garbage IS an identity claim and still reaches the verifier', async () => {
    m.verifyJwt.mockResolvedValue({ verification_status: 'failed', agent_id: null, agent_name: null, jti: null });
    const id = await resolveAgentIdentity(reqWith({ authorization: `Bearer ${JWT}` }), { agentId: 'body_agent' });
    expect(m.verifyJwt).toHaveBeenCalled();
    expect(id.verification_status).toBe('failed');
  });

  it('verified JWT overrides the body agent_id and marks verified', async () => {
    m.verifyJwt.mockResolvedValue({
      verification_status: 'verified', agent_id: 'jwt_sub', agent_name: 'JWT Agent', jti: 'j1', issuer: 'https://idp', exp: 9999999999,
    });
    const id = await resolveAgentIdentity(reqWith({ authorization: `Bearer ${JWT}` }), { agentId: 'attacker_chosen', agentName: 'x' });
    expect(id.agent_id).toBe('jwt_sub');         // cryptographic proof beats self-assertion
    expect(id.agent_name).toBe('JWT Agent');
    expect(id.verification_status).toBe('verified');
    expect(id.verified).toBe(true);
  });

  it('failed/expired token does NOT grant verified privileges and keeps body identity', async () => {
    m.verifyJwt.mockResolvedValue({ verification_status: 'expired', agent_id: 'jwt_sub', agent_name: null, jti: null });
    const id = await resolveAgentIdentity(reqWith({ authorization: `Bearer ${JWT}` }), { agentId: 'body_agent' });
    expect(id.agent_id).toBe('body_agent');      // untrusted token claims are NOT applied
    expect(id.verified).toBe(false);
    expect(id.verification_status).toBe('expired');
  });

  it('infra-unverified token (issuer down) falls back to self-asserted, never verified', async () => {
    m.verifyJwt.mockResolvedValue({ verification_status: 'unverified', agent_id: null, agent_name: null, jti: null });
    const id = await resolveAgentIdentity(reqWith({ authorization: `Bearer ${JWT}` }), { agentId: 'body_agent' });
    expect(id.agent_id).toBe('body_agent');
    expect(id.verified).toBe(false);
    expect(id.verification_status).toBe('unverified');
  });
});
