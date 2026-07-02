// --- Read queries ---
import type { SqlTag } from '../types/db';

export async function findActiveKeyByHash(sql: SqlTag, keyHash: string): Promise<Record<string, unknown>[]> {
  return sql`
    SELECT id FROM api_keys
    WHERE key_hash = ${keyHash} AND revoked_at IS NULL
    LIMIT 1
  `;
}

// Full auth resolution for a key hash (org + role + hosted-trial fields).
// Mirrors the inline Neon query in middleware.js resolveApiKey; used by the
// internal resolve-key route so self-host TCP Postgres can resolve DB keys.
export async function resolveKeyForAuth(sql: SqlTag, keyHash: string): Promise<Record<string, unknown>[]> {
  return sql`
    SELECT ak.org_id, ak.role, ak.revoked_at,
           o.hosted_mode, o.trial_ends_at, o.trial_action_cap, o.trial_actions_used
    FROM api_keys ak
    LEFT JOIN organizations o ON o.id = ak.org_id
    WHERE ak.key_hash = ${keyHash}
    LIMIT 1
  `;
}

export async function touchKeyLastUsed(sql: SqlTag, keyHash: string): Promise<void> {
  await sql`UPDATE api_keys SET last_used_at = CURRENT_TIMESTAMP WHERE key_hash = ${keyHash}`;
}
