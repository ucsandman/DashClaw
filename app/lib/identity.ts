import crypto from 'crypto';
import { canonicalJsonStringify } from './canonical-json';
import type { SqlTag } from './types/db';

/**
 * Verify a cryptographic signature from an agent.
 *
 * @param orgId
 * @param agentId
 * @param payload - The JSON object that was signed
 * @param signature - Base64 encoded signature
 * @param sql - DB connection
 */
export async function verifyAgentSignature(
  orgId: string,
  agentId: string,
  payload: unknown,
  signature: string,
  sql: SqlTag,
): Promise<boolean> {
  try {
    const rows = await sql`
      SELECT public_key, algorithm
      FROM agent_identities
      WHERE org_id = ${orgId} AND agent_id = ${agentId}
      LIMIT 1
    `;

    const row = rows[0];
    if (!row) return false;

    const public_key = row.public_key as string;
    const algorithm = row.algorithm as string;

    // Use canonical JSON so key order does not break verification.
    const stringToVerify = canonicalJsonStringify(payload);

    // Map algorithm names if necessary. SDK uses RSASSA-PKCS1-v1_5.
    // We assume SHA-256 for the digest.
    const verifyAlgo = algorithm === 'RSASSA-PKCS1-v1_5' ? 'RSA-SHA256' : algorithm;

    const verifier = crypto.createVerify(verifyAlgo);
    verifier.update(stringToVerify);
    return verifier.verify(public_key, signature, 'base64');
  } catch (err) {
    console.warn('[Identity] Verification error for %s:', agentId, (err as Error).message);
    return false;
  }
}
