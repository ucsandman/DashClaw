/**
 * Signed, independently re-verifiable proof receipts + ruleset hashing.
 *
 * Ported/adapted from GroundLock packages/core/src/receipt.ts + ruleset.ts,
 * rebranded to DashClaw. A receipt binds: the verdict, the structured
 * violations (code + label only — raw detail is stripped for privacy), a hash
 * of the candidate text, a hash of the source-of-truth (the "ruleset version"),
 * and an Ed25519 issuer signature.
 *
 * Honest scope: a valid receipt proves integrity (nothing was altered after
 * issuance), the verdict, the ruleset version, and the issuer's signature. It
 * does NOT prove time-of-issuance — `issuedAt` is issuer-asserted, there is no
 * trusted timestamp — nor the semantic correctness of prose that carries no
 * extractable operational token.
 */

import { digestText, digestJson } from './canonicalize';
import { signCanonical, verifyCanonical } from './sign';

export const ENGINE_VERSION = '0.1.0'; // version-hardcode-allowed (integrity engine version, not the platform version)
export const RECEIPT_VERSION = 'dashclaw-receipt/v1';

export interface ReceiptViolation {
  code: string;
  label: string;
}

export interface VerifyResultLike {
  verdict: string;
  violations: ReceiptViolation[];
}

export interface SourceOfTruthLike {
  requiredFacts: unknown;
  allowedFacts: unknown;
  forbiddenPatterns?: unknown;
  extract?: unknown;
}

export interface SigningKey {
  kid: string;
  privateKeyJwk: object;
}

export interface ReceiptSignature {
  alg: string;
  kid: string;
  sig: string;
}

export interface ReceiptBase {
  version: string;
  issuedAt: string;
  engineVersion: string;
  verdict: string;
  violations: ReceiptViolation[];
  candidateHash: string;
  sourceOfTruthHash: string;
}

export interface Receipt extends ReceiptBase {
  signature: ReceiptSignature;
}

export interface VerifyReceiptResult {
  ok: boolean;
  reason?: string;
}

/** Stable content hash of the source-of-truth, used as the ruleset version in a receipt. */
export function hashSourceOfTruth(source: SourceOfTruthLike): string {
  return digestJson({
    requiredFacts: source.requiredFacts,
    allowedFacts: source.allowedFacts,
    forbiddenPatterns: source.forbiddenPatterns ?? [],
    extract: source.extract ?? {},
  });
}

/**
 * Issue a signed receipt for a verify() result.
 *
 * @param issuedAt - issuer-asserted ISO timestamp (NOT a trusted timestamp)
 */
export function issueReceipt(
  result: VerifyResultLike,
  candidate: string,
  source: SourceOfTruthLike,
  key: SigningKey,
  issuedAt: string,
): Receipt {
  const base: ReceiptBase = {
    version: RECEIPT_VERSION,
    issuedAt,
    engineVersion: ENGINE_VERSION,
    verdict: result.verdict,
    violations: result.violations.map((v) => ({ code: v.code, label: v.label })),
    candidateHash: digestText(candidate),
    sourceOfTruthHash: hashSourceOfTruth(source),
  };
  return { ...base, signature: signCanonical(base, key) };
}

/**
 * Re-verify a receipt against a public JWK. Fail-closed: any malformed input,
 * unsupported signature, or error returns { ok: false }.
 */
export function verifyReceipt(receipt: unknown, publicKeyJwk: object): VerifyReceiptResult {
  try {
    if (!receipt || typeof receipt !== 'object') return { ok: false, reason: 'malformed' };
    const { signature, ...base } = receipt as Receipt;
    if (!signature || signature.alg !== 'EdDSA' || typeof signature.sig !== 'string') {
      return { ok: false, reason: 'unsupported_signature' };
    }
    const ok = verifyCanonical(base, signature, publicKeyJwk);
    return ok ? { ok: true } : { ok: false, reason: 'bad_signature' };
  } catch {
    return { ok: false, reason: 'error' }; // fail-closed
  }
}
