/**
 * Shared agent-identity resolution contract.
 *
 * One source of truth for "who is this agent, and is that claim verified?" used
 * by every governed-action-creating route (/api/guard, /api/actions,
 * integration routes). Before this helper, only /api/guard
 * ran JWKS verification; /api/actions trusted the
 * self-asserted body `agent_id` and never recorded whether identity was verified.
 *
 * Contract:
 *   - A JWKS-verified JWT's `sub` OVERRIDES the body agent_id (cryptographic
 *     proof beats self-assertion), and identity is marked verified.
 *   - Any non-verified token outcome (expired/failed/unknown_issuer/exp_too_far,
 *     or an infra-class 'unverified' when the issuer is unreachable) does NOT
 *     apply the token's claims — the route falls back to the self-asserted body
 *     identity and is explicitly marked NOT verified, so a downstream reader can
 *     always distinguish verified from self-asserted identity.
 *
 * The full verifier result is returned as `verification` so a caller that needs
 * replay (jti) or action-binding (act) handling (the guard route) can use it
 * without re-verifying the token.
 */

import { verifyJwt, extractBearerToken } from './jwks-verifier';
import type { AgentIdentity } from './types/identity';

export async function resolveAgentIdentity(
  request: Request,
  { agentId = null, agentName = null }: { agentId?: string | null; agentName?: string | null } = {},
): Promise<AgentIdentity> {
  const authHeader = request?.headers?.get ? request.headers.get('authorization') : null;
  const token = extractBearerToken(authHeader);

  if (!token) {
    return {
      agent_id: agentId ?? null,
      agent_name: agentName ?? null,
      verification_status: 'unverified',
      verified: false,
      jti: null,
      verification: null,
    };
  }

  const vr = await verifyJwt(token);

  if (vr.verification_status === 'verified') {
    return {
      agent_id: vr.agent_id || agentId || null,
      agent_name: vr.agent_name || agentName || null,
      verification_status: 'verified',
      verified: true,
      jti: vr.jti || null,
      verification: vr,
    };
  }

  // Untrusted token: never apply its claims, never grant verified privileges.
  return {
    agent_id: agentId ?? null,
    agent_name: agentName ?? null,
    verification_status: vr.verification_status,
    verified: false,
    jti: vr.jti || null,
    verification: vr,
  };
}
