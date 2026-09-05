/**
 * Ed25519 signing-key primitives for the integrity subsystem.
 *
 * Ported/adapted from GroundLock packages/core/src/keys.ts. Ed25519 is the one
 * signing scheme for DashClaw-issued evidence: GroundLock already used it, and
 * app/lib/jwks-verifier.js already verifies EdDSA JWKs — so a published public
 * key re-verifies through the same JWKS path the rest of the runtime uses, with
 * no second key system.
 *
 * This module is pure (no DB). The hybrid env-or-DB server key loader lives in
 * app/lib/integrity/server-key.js so the crypto primitives stay importable
 * without pulling in a database connection.
 */

import {
  createHash,
  generateKeyPairSync,
  createPrivateKey,
  createPublicKey,
  type KeyObject,
} from 'node:crypto';

export const SIGNING_ALG = 'EdDSA';

/**
 * A JSON Web Key for an OKP (Ed25519) curve. `d` is the private scalar (private
 * keys only); `kid`/`alg`/`use` are optional JWKS metadata.
 */
export interface Ed25519Jwk {
  kty: string;
  crv: string;
  x: string;
  d?: string;
  kid?: string;
  alg?: string;
  use?: string;
  key_ops?: string[];
  [member: string]: unknown;
}

export interface GeneratedSigningKey {
  kid: string;
  privateKeyJwk: Ed25519Jwk;
  publicKeyJwk: Ed25519Jwk;
}

/** RFC 7638 JWK thumbprint for an OKP (Ed25519) key — a stable, content-derived kid. */
export function jwkThumbprint(jwk: Ed25519Jwk): string {
  // Required members for OKP, lexicographically ordered, no whitespace.
  const canonical = JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x });
  return createHash('sha256').update(canonical).digest('base64url');
}

/**
 * Generate a fresh Ed25519 keypair as JWKs, tagged with a kid (RFC 7638
 * thumbprint when none is supplied) and `alg`/`use` so the public JWK is
 * JWKS-ready.
 */
export function generateSigningKey(kid?: string): GeneratedSigningKey {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const privateKeyJwk = privateKey.export({ format: 'jwk' }) as Ed25519Jwk;
  const publicKeyJwk = publicKey.export({ format: 'jwk' }) as Ed25519Jwk;
  const resolvedKid = kid || jwkThumbprint(publicKeyJwk);
  return {
    kid: resolvedKid,
    privateKeyJwk: { ...privateKeyJwk, kid: resolvedKid, alg: SIGNING_ALG, use: 'sig' },
    publicKeyJwk: { ...publicKeyJwk, kid: resolvedKid, alg: SIGNING_ALG, use: 'sig' },
  };
}

// Import only the cryptographic JWK members; node's JWK import is strict about
// some metadata members across versions, so we strip alg/use/kid/key_ops.
function pickPublic(jwk: Ed25519Jwk): { kty: string; crv: string; x: string } {
  return { kty: jwk.kty, crv: jwk.crv, x: jwk.x };
}
function pickPrivate(jwk: Ed25519Jwk): { kty: string; crv: string; x: string; d: string | undefined } {
  return { kty: jwk.kty, crv: jwk.crv, x: jwk.x, d: jwk.d };
}

export function privateKeyObjectFromJwk(jwk: Ed25519Jwk): KeyObject {
  return createPrivateKey({ key: pickPrivate(jwk), format: 'jwk' });
}

export function publicKeyObjectFromJwk(jwk: Ed25519Jwk): KeyObject {
  return createPublicKey({ key: pickPublic(jwk), format: 'jwk' });
}

/** Derive the public JWK (JWKS-ready) from a private Ed25519 JWK. */
export function publicJwkFromPrivate(privateKeyJwk: Ed25519Jwk): Ed25519Jwk {
  const kid = privateKeyJwk.kid || jwkThumbprint(privateKeyJwk);
  return { kty: privateKeyJwk.kty, crv: privateKeyJwk.crv, x: privateKeyJwk.x, kid, alg: SIGNING_ALG, use: 'sig' };
}
