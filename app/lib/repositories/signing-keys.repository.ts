/**
 * Repository for the instance-global Ed25519 server signing key.
 *
 * Not org-scoped: the DashClaw instance is the issuer of proof receipts and
 * signed compliance bundles and publishes one JWKS. A constant `id` ('default')
 * makes the active key a singleton so concurrent cold starts can't create two
 * competing keys.
 */
import type { SqlTag } from '../types/db';

interface SigningKeyRow {
  kid: string;
  alg: string;
  private_jwk: string;
  public_jwk: string;
  status: SigningKeyStatus;
  retired_at: string | null;
  compromised_at: string | null;
}

export type SigningKeyStatus = 'active' | 'retired' | 'compromised';

interface InsertSigningKeyInput {
  id?: string;
  kid: string;
  alg?: string;
  privateJwk: string;
  publicJwk: string;
}

export async function getActiveSigningKey(sql: SqlTag): Promise<SigningKeyRow | null> {
  const rows = await sql`
    SELECT kid, alg, private_jwk, public_jwk, status, retired_at, compromised_at
    FROM server_signing_keys
    WHERE active = 1 AND status = 'active'
    ORDER BY created_at DESC
    LIMIT 1
  `;
  return (rows[0] ?? null) as SigningKeyRow | null;
}

/**
 * Insert the signing key, singleton-guarded. Returns true when THIS call
 * persisted the row (RETURNING yielded it), false when a concurrent caller
 * won the race (ON CONFLICT DO NOTHING) — the loser should re-read.
 */
export async function insertSigningKey(
  sql: SqlTag,
  { id = 'default', kid, alg = 'EdDSA', privateJwk, publicJwk }: InsertSigningKeyInput
): Promise<boolean> {
  const rows = await sql`
    INSERT INTO server_signing_keys (id, kid, alg, private_jwk, public_jwk, active, status)
    VALUES (${id}, ${kid}, ${alg}, ${privateJwk}, ${publicJwk}, 1, 'active')
    ON CONFLICT (id) DO NOTHING
    RETURNING kid
  `;
  return rows.length > 0;
}

export async function listPublicJwks(sql: SqlTag): Promise<unknown[]> {
  const rows = await sql`
    SELECT public_jwk, status, retired_at, compromised_at
    FROM server_signing_keys
    WHERE status IN ('active', 'retired')
    ORDER BY created_at DESC
  `;
  return rows
    .filter((r) => r.status !== 'compromised')
    .map((r) => ({
      ...(typeof r.public_jwk === 'string' ? JSON.parse(r.public_jwk) : r.public_jwk),
      dashclaw_status: r.status || 'active',
      ...(r.retired_at ? { dashclaw_retired_at: r.retired_at } : {}),
    }));
}

/**
 * Public-only lifecycle manifest. Compromised keys remain listed here so an
 * operator can communicate the incident without returning them in trusted
 * JWKS `keys`. No private material is selected.
 */
export async function listSigningKeyStatuses(sql: SqlTag): Promise<unknown[]> {
  const rows = await sql`
    SELECT kid, alg, active, status, retired_at, compromised_at, created_at
    FROM server_signing_keys
    ORDER BY created_at DESC
  `;
  return rows.map((row) => ({
    kid: row.kid,
    alg: row.alg,
    status: row.status || (Number(row.active) === 1 ? 'active' : 'retired'),
    created_at: row.created_at,
    retired_at: row.retired_at || null,
    compromised_at: row.compromised_at || null,
  }));
}

/** Retire the current DB key and install its replacement atomically. */
export async function rotateSigningKey(
  sql: SqlTag,
  input: Omit<InsertSigningKeyInput, 'id'> & {
    id?: string;
    rotatedAt: string;
    compromiseKid?: string | null;
    compromisedAt?: string | null;
  },
): Promise<boolean> {
  const { id = `key_${input.kid}`, kid, alg = 'EdDSA', privateJwk, publicJwk, rotatedAt } = input;
  const rows = await sql`
    SELECT public.rotate_server_signing_key(
      ${id}, ${kid}, ${alg}, ${privateJwk}, ${publicJwk}, ${rotatedAt},
      ${input.compromiseKid || null}, ${input.compromisedAt || null}
    ) AS rotated
  `;
  return rows[0]?.rotated === true;
}

/** Mark a key compromised and remove it from the trusted JWKS set. */
export async function markSigningKeyCompromised(
  sql: SqlTag,
  kid: string,
  compromisedAt: string,
): Promise<boolean> {
  const rows = await sql`
    UPDATE server_signing_keys
    SET active = 0,
        status = 'compromised',
        compromised_at = COALESCE(compromised_at, ${compromisedAt})
    WHERE kid = ${kid} AND status != 'compromised'
    RETURNING kid
  `;
  return rows.length > 0;
}
