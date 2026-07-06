import { verifyJwt, extractBearerToken } from './jwks-verifier';
import { checkAndRecord as checkAndRecordJti } from './repositories/jti-replay.repository';
import { resolveActStatus } from './act-binding';
import { getJtiReplayMode } from './replay-protection';
import type { getSql } from './db';

type GuardSql = ReturnType<typeof getSql>;
type GuardData = Record<string, unknown> & {
  agent_id?: string;
  agent_name?: string;
  declared_goal?: string;
  verification_status?: string;
};

/**
 * Phase 2 agent identity for POST /api/guard: JWKS verification, replay
 * protection, and action-binding status. Extracted verbatim from the route
 * handler (v4.66.x health pass) — mutates `data` in place exactly as the
 * inline block did, so the guard evaluation and audit trail see identical
 * fields: verification_status, jti, replay_status, act_status, act_hash,
 * and the JWT-sub override of agent_id/agent_name.
 *
 * Fail-soft: infrastructure errors fall back to 'unverified', never 'failed'.
 */
export async function resolveAgentIdentity(request: Request, data: GuardData, sql: GuardSql): Promise<void> {
  const authHeader = request.headers.get('authorization');
  const bearerToken = extractBearerToken(authHeader);

  if (!bearerToken) {
    data.verification_status = 'unverified';
    data.replay_status = 'not_applicable';
    data.jti = null;
    data.act_status = 'not_applicable';
    data.act_hash = null;
    return;
  }

  const verificationResult = await verifyJwt(bearerToken);

  if (verificationResult.verification_status === 'verified') {
    // Cryptographic proof beats self-assertion: JWT sub overrides body agent_id.
    if (verificationResult.agent_id) {
      if (data.agent_id && data.agent_id !== verificationResult.agent_id) {
        console.warn(
          `[Guard] JWT sub (${verificationResult.agent_id}) overrides body agent_id (${data.agent_id})`
        );
      }
      data.agent_id = verificationResult.agent_id;
    }
    if (verificationResult.agent_name && !data.agent_name) {
      data.agent_name = verificationResult.agent_name;
    }
  }

  data.verification_status = verificationResult.verification_status;
  data.jti = verificationResult.jti || null;

  // Phase 2b: replay-protection check (issue #120, design by @piiiico).
  // Only verified tokens hit the store — there's no signature trust to
  // replay without that. The exp_too_far signal flows through verification
  // status directly (the verifier sets it before any network call).
  const replayProtection = getJtiReplayMode();
  if (verificationResult.verification_status === 'exp_too_far') {
    data.replay_status = 'exp_too_far';
  } else if (verificationResult.verification_status === 'verified' && replayProtection === 'off') {
    // Distinct from `not_applicable` so the audit trail can tell apart
    // "Phase 1 path / no JWT" from "verified JWT but operator opted out
    // of replay protection." Same allow-everything outcome, different
    // forensic story during incident review.
    data.replay_status = 'disabled';
  } else if (verificationResult.verification_status === 'verified') {
    // Length cap matches the repository's MAX_JTI_LENGTH (1024). Catching
    // it here too means a hostile-IdP-issued multi-MB jti never reaches
    // the store at all and never throws OVERSIZED_JTI. Boundary
    // validation > deep validation.
    const oversizedJti = typeof verificationResult.jti === 'string' && verificationResult.jti.length > 1024;
    if (!verificationResult.jti) {
      data.replay_status = 'not_present';
    } else if (oversizedJti) {
      console.warn('[Guard] Oversized jti rejected from replay store', {
        jti_length: verificationResult.jti.length,
        issuer: verificationResult.issuer,
      });
      data.replay_status = 'not_present';
    } else if (typeof verificationResult.exp !== 'number') {
      // jti without exp can't be safely TTL'd → treat as not_present so
      // the store never accumulates rows with no purge horizon.
      data.replay_status = 'not_present';
    } else if (!verificationResult.issuer) {
      // Defense in depth: the verifier currently sets verification_status
      // to 'failed' when issuer is null, so we should never reach here
      // with a 'verified' status and null issuer. If a future code path
      // ever does, treat as not_present rather than throwing INVALID_INPUT
      // out of the repository (which would surface as an unhandled 500).
      data.replay_status = 'not_present';
    } else {
      data.replay_status = await checkAndRecordJti(sql, {
        jti: verificationResult.jti,
        issuer: verificationResult.issuer,
        expiresAt: verificationResult.exp,
        agentId: verificationResult.agent_id,
      });
    }
  } else {
    data.replay_status = 'not_applicable';
  }

  // Phase 2c: action-binding status (issue #121). Its own axis, like
  // replay_status — never overloads verification_status. Computed for
  // verified tokens in EVERY mode (off included): even an operator running
  // DASHCLAW_ACT_BINDING=off gets the `match` signal that tells them their
  // issuer started minting bindings and it's safe to flip to required.
  // resolveActStatus returns 'not_applicable' for any non-verified token,
  // and hashes the raw request context (pre-redaction) so legitimate
  // matches whose goal contains a redactable pattern still compare.
  data.act_status = resolveActStatus(verificationResult, data);
  data.act_hash = verificationResult.act?.hash || null;
}
