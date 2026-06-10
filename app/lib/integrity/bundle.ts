/**
 * Signed, hash-chained compliance bundle.
 *
 * Replaces the old unsigned compliance markdown/JSON export. A bundle wraps the
 * report payload (sections + evidence summary + metadata) in a tamper-evident,
 * independently re-verifiable envelope: the payload is bound by its digest
 * (payloadHash), the envelope is Ed25519-signed by the instance key, and each
 * bundle links to the previous one via prevBundleHash so a tampered or removed
 * export in the middle of the chain is detectable.
 *
 * Honest scope: a valid bundle proves integrity (nothing altered after issuance),
 * the issuer signature, and the chain linkage. It does NOT prove time-of-issuance
 * (`issuedAt` is issuer-asserted; there is no trusted timestamp).
 */

import { digestJson } from './canonicalize';
import { signCanonical, verifyCanonical } from './sign';
import type { CanonicalSignature } from './sign';
import { ENGINE_VERSION } from './receipt';

export const BUNDLE_VERSION = 'dashclaw-compliance-bundle/v1';

/** Signing key (private half) used to sign a bundle. */
interface SigningKey {
  kid: string;
  privateKeyJwk: object;
}

/** A public JWK candidate used to verify a bundle signature. */
interface PublicKeyLike {
  kid?: string;
  [key: string]: unknown;
}

/** Ed25519 signature envelope produced by signCanonical. */
type Signature = CanonicalSignature;

/** The signed base of a bundle (everything except payload + signature). */
interface BundleBase {
  version: string;
  issuedAt: string;
  engineVersion: string;
  payloadHash: string;
  prevBundleHash: string | null;
}

/** A full signed compliance bundle. */
export interface Bundle extends BundleBase {
  payload: unknown;
  signature: Signature;
}

export interface VerifyBundleResult {
  ok: boolean;
  kid?: string;
  prevBundleHash?: string | null;
  reason?: string;
}

// The signed base — everything except the (potentially large) payload and the
// signature. The payload is bound by payloadHash, so the signature stays compact
// while still covering the full content transitively.
function baseOf(bundle: Bundle): BundleBase {
  return {
    version: bundle.version,
    issuedAt: bundle.issuedAt,
    engineVersion: bundle.engineVersion,
    payloadHash: bundle.payloadHash,
    prevBundleHash: bundle.prevBundleHash ?? null,
  };
}

/**
 * @param payload - report content (sections, evidenceSummary, metadata)
 * @param key
 * @param issuedAt - issuer-asserted ISO timestamp (NOT trusted)
 * @param prevBundleHash - bundleHash() of the previous export, or null
 */
export function signBundle(payload: unknown, key: SigningKey, issuedAt: string, prevBundleHash: string | null = null): Bundle {
  const base: BundleBase = {
    version: BUNDLE_VERSION,
    issuedAt,
    engineVersion: ENGINE_VERSION,
    payloadHash: digestJson(payload),
    prevBundleHash: prevBundleHash ?? null,
  };
  return { ...base, payload, signature: signCanonical(base, key) };
}

/** Deterministic identity hash of a bundle (over its signed base). Chains exports. */
export function bundleHash(bundle: Bundle): string {
  return digestJson(baseOf(bundle));
}

/**
 * Re-verify a bundle against a JWKS (or a single public JWK). Fail-closed.
 */
export function verifyBundle(bundle: Bundle | null | undefined, keys: PublicKeyLike | PublicKeyLike[]): VerifyBundleResult {
  try {
    if (!bundle || typeof bundle !== 'object' || !bundle.payload || !bundle.signature) {
      return { ok: false, reason: 'malformed' };
    }
    // Payload integrity: the stored payloadHash must match the live payload.
    if (digestJson(bundle.payload) !== bundle.payloadHash) {
      return { ok: false, reason: 'payload_tampered' };
    }
    const base = baseOf(bundle);
    const candidateKeys = Array.isArray(keys) ? keys : [keys];
    const kid = bundle.signature.kid;
    const matched = kid ? candidateKeys.filter((k) => k && k.kid === kid) : [];
    const tryKeys = matched.length > 0 ? matched : candidateKeys;
    for (const k of tryKeys) {
      if (verifyCanonical(base, bundle.signature, k)) {
        return { ok: true, kid: k.kid, prevBundleHash: base.prevBundleHash };
      }
    }
    return { ok: false, reason: 'bad_signature' };
  } catch {
    return { ok: false, reason: 'error' };
  }
}
