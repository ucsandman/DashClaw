/**
 * Hybrid server signing-key loader (env override -> DB auto-generate).
 *
 * Resolution order:
 *   1. DASHCLAW_SIGNING_KEY_JWK env var (an Ed25519 private JWK) — for operators
 *      who want external key custody.
 *   2. The active row in server_signing_keys.
 *   3. On a fresh instance with neither, generate one and persist it.
 *
 * This keeps one-click deploys zero-friction (a brand-new instance can sign and
 * re-verify immediately, no secret to provision) while still allowing an env
 * override. There is exactly ONE signing scheme (Ed25519) and ONE published
 * JWKS — no parallel key system.
 */

import { generateSigningKey, publicJwkFromPrivate, jwkThumbprint } from './keys';
import { getActiveSigningKey, insertSigningKey, listPublicJwks, listSigningKeyStatuses } from '../repositories/signing-keys.repository';
import type { SqlTag } from '../types/db';
import { decrypt, encrypt } from '../encryption';

/** A JSON Web Key. Members are dynamic (parsed JSON / node crypto export). */
type Jwk = Record<string, unknown> & { kid?: string };

interface ResolvedSigningKey {
  kid: string;
  privateKeyJwk: Jwk;
  publicKeyJwk: Jwk;
  source: 'env' | 'db';
}

/** Active signing-key DB row shape (private_jwk/public_jwk may be JSON strings). */
interface SigningKeyRowLike {
  kid: string;
  private_jwk: string | Jwk;
  public_jwk: string | Jwk;
}

// Process-level cache of the resolved signing key. The key is immutable for the
// life of the process; resolving it once avoids a DB read per signature.
let cached: ResolvedSigningKey | null = null;

function parseEnvSigningKey(): ResolvedSigningKey | null {
  const raw = process.env.DASHCLAW_SIGNING_KEY_JWK;
  if (!raw) return null;
  let jwk: any;
  try {
    jwk = JSON.parse(raw);
  } catch {
    throw new Error('DASHCLAW_SIGNING_KEY_JWK is not valid JSON');
  }
  if (!jwk || jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519' || typeof jwk.d !== 'string' || typeof jwk.x !== 'string') {
    throw new Error('DASHCLAW_SIGNING_KEY_JWK must be an Ed25519 (OKP) private JWK with x and d');
  }
  const kid = jwk.kid || jwkThumbprint(jwk);
  return {
    kid,
    privateKeyJwk: { ...jwk, kid },
    publicKeyJwk: publicJwkFromPrivate(jwk),
    source: 'env',
  };
}

function fromRow(row: SigningKeyRowLike): ResolvedSigningKey {
  let privateKeyJwk: Jwk;
  if (typeof row.private_jwk === 'string' && row.private_jwk.startsWith('v2:')) {
    const plaintext = decrypt(row.private_jwk, `dashclaw:server-signing-key:${row.kid}`);
    if (!plaintext) throw new Error(`stored signing key ${row.kid} cannot be decrypted`);
    privateKeyJwk = JSON.parse(plaintext) as Jwk;
  } else {
    // Explicit upgrade compatibility: releases before F29 stored a JSON JWK
    // directly. Keep it readable until the operator runs custody-keys --apply.
    privateKeyJwk = typeof row.private_jwk === 'string' ? JSON.parse(row.private_jwk) : row.private_jwk;
  }
  const publicKeyJwk = typeof row.public_jwk === 'string' ? JSON.parse(row.public_jwk) : row.public_jwk;
  return { kid: row.kid, privateKeyJwk, publicKeyJwk, source: 'db' };
}

/**
 * Resolve the instance signing key. Throws on a malformed env key (fail-closed:
 * a misconfigured signing identity must not silently fall through to a different
 * key).
 */
export async function getServerSigningKey(sql: SqlTag): Promise<ResolvedSigningKey> {
  // An environment-held key changes only with a process restart. DB-backed
  // keys are re-checked so a rotation or compromise takes effect before the
  // next receipt is issued; the cache only avoids repeated JWK decryption when
  // the active kid is unchanged.
  if (cached?.source === 'env') return cached;

  const env = parseEnvSigningKey();
  if (env) {
    cached = env;
    return cached;
  }

  const existing = await getActiveSigningKey(sql);
  if (existing) {
    if (cached?.source === 'db' && cached.kid === existing.kid) return cached;
    cached = fromRow(existing as unknown as SigningKeyRowLike);
    return cached;
  }

  // Fresh instance: generate + persist. The singleton id guarantees one row even
  // under concurrent cold starts; the loser re-reads the winner's key so every
  // instance signs with the one key whose public half is in the JWKS.
  const kp = generateSigningKey();
  const encryptedPrivateJwk = encrypt(
    JSON.stringify(kp.privateKeyJwk),
    `dashclaw:server-signing-key:${kp.kid}`,
  );
  const won = await insertSigningKey(sql, {
    kid: kp.kid,
    alg: 'EdDSA',
    privateJwk: encryptedPrivateJwk,
    publicJwk: JSON.stringify(kp.publicKeyJwk),
  });
  if (won) {
    cached = { kid: kp.kid, privateKeyJwk: kp.privateKeyJwk, publicKeyJwk: kp.publicKeyJwk, source: 'db' };
    return cached;
  }

  const winner = await getActiveSigningKey(sql);
  if (!winner) throw new Error('signing key generation lost the insert race but no active key is present');
  cached = fromRow(winner as unknown as SigningKeyRowLike);
  return cached;
}

/**
 * Public JWKS for re-verification. Publishes the public half of the env key
 * (if any) and every active DB key. Never includes the private member `d`.
 */
export async function getServerPublicJwks(sql: SqlTag): Promise<{
  keys: Jwk[];
  dashclaw_key_status: unknown[];
}> {
  const keys: Jwk[] = [];
  let keyStatuses: unknown[] = [];
  let envKeyStatus: { kid: string; alg: string; status: string; source: string } | null = null;
  try {
    const env = parseEnvSigningKey();
    if (env) {
      keys.push(env.publicKeyJwk);
      envKeyStatus = { kid: env.kid, alg: 'EdDSA', status: 'active', source: 'env' };
    }
  } catch {
    // Malformed env key: signing is broken regardless, but we can still publish
    // any DB keys so previously-issued receipts remain verifiable.
  }
  try {
    const dbKeys = (await listPublicJwks(sql)) as Jwk[];
    for (const k of dbKeys) {
      if (k && !keys.some((existing) => existing.kid === k.kid)) keys.push(k);
    }
  } catch {
    // DB unavailable — the env key (if any) is still published.
  }
  try {
    keyStatuses = await listSigningKeyStatuses(sql);
  } catch {
    // Keep the trusted key response available when lifecycle metadata cannot
    // be loaded. The manifest is additive and never fabricated.
  }
  if (envKeyStatus && !keyStatuses.some((row: any) => row?.kid === envKeyStatus?.kid)) {
    keyStatuses.unshift(envKeyStatus);
  }
  return { keys, dashclaw_key_status: keyStatuses };
}

/** Test-only: clear the resolved-key cache. */
export function _resetSigningKeyCacheForTesting(): void {
  cached = null;
}
