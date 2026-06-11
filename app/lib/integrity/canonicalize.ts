/**
 * Integrity canonicalization — text hygiene + one canonical-JSON path.
 *
 * Ported from GroundLock packages/core/src/canonicalize.ts, adapted to reuse
 * DashClaw's existing canonical-json serializer so there is exactly ONE JSON
 * canonicalization in the codebase (NFC + sorted keys + base64url), not a
 * parallel one.
 *
 * - `canonicalizeText` is the fabrication-domain text normalizer: NFC plus
 *   ASCII dash/quote/ellipsis/nbsp cleanup. It is what the verifier compares
 *   operational tokens against, and what `digestText` hashes. It is NOT the
 *   JSON canonicalizer.
 * - `canonicalizeJson` routes through `canonicalJsonStringify` (sorted keys,
 *   undefined dropped, no whitespace) after an NFC deep-normalize, so two
 *   structurally-equal source-of-truth objects that differ only by Unicode
 *   normalization form serialize and therefore hash and sign identically.
 */

import { createHash } from 'node:crypto';
import { canonicalizeText, canonicalizeJson } from './canonicalize-pure';

// Pure (no-Node) helpers live in canonicalize-pure.ts so client bundles can
// import them without pulling in node:crypto. Re-export them here so all
// existing consumers of canonicalize.ts keep working unchanged.
export { canonicalizeText, canonicalizeJson } from './canonicalize-pure';

/** 'sha256:' + base64url(sha256(utf8(canonical))). */
export function sha256(canonical: string): string {
  return 'sha256:' + createHash('sha256').update(canonical, 'utf8').digest('base64url');
}

export function digestText(input: string): string {
  return sha256(canonicalizeText(input));
}

export function digestJson(value: unknown): string {
  return sha256(canonicalizeJson(value));
}
