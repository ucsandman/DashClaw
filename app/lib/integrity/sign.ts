/**
 * Detached Ed25519 signatures over canonical JSON — the one signing primitive
 * shared by proof receipts and signed compliance bundles. There is a single
 * canonicalization (NFC + sorted keys + base64url, via canonicalize.js) and a
 * single scheme (Ed25519), so receipts and bundles re-verify through the same
 * published JWKS.
 */

import { sign as cryptoSign, verify as cryptoVerify } from 'node:crypto';
import { canonicalizeJson } from './canonicalize';
import { privateKeyObjectFromJwk, publicKeyObjectFromJwk } from './keys';
import type { Ed25519Jwk } from './keys';

export interface CanonicalSignature {
  alg: 'EdDSA';
  kid: string;
  sig: string;
}

interface SigningKey {
  kid: string;
  privateKeyJwk: object;
}

/**
 * Sign the canonical JSON of `base`.
 * @param base - the object to sign (must NOT contain the signature)
 */
export function signCanonical(base: unknown, key: SigningKey): CanonicalSignature {
  const input = Buffer.from(canonicalizeJson(base), 'utf8');
  const sig = cryptoSign(null, input, privateKeyObjectFromJwk(key.privateKeyJwk as Ed25519Jwk));
  return { alg: 'EdDSA', kid: key.kid, sig: sig.toString('base64url') };
}

/**
 * Verify a detached signature over the canonical JSON of `base`. Fail-closed:
 * any malformed input or error returns false.
 */
export function verifyCanonical(
  base: unknown,
  signature: { alg?: unknown; sig?: unknown } | null | undefined,
  publicKeyJwk: object,
): boolean {
  try {
    if (!signature || signature.alg !== 'EdDSA' || typeof signature.sig !== 'string') return false;
    return cryptoVerify(
      null,
      Buffer.from(canonicalizeJson(base), 'utf8'),
      publicKeyObjectFromJwk(publicKeyJwk as Ed25519Jwk),
      Buffer.from(signature.sig, 'base64url'),
    );
  } catch {
    return false;
  }
}
