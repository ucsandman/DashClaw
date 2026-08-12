/**
 * Pure (no Node.js built-ins) canonicalization helpers.
 *
 * Split from canonicalize.ts so client-side bundles (e.g. the work-orders page)
 * can import only the parts they need without pulling in `node:crypto`.
 *
 * canonicalize.ts re-exports everything from here so all existing imports are
 * unaffected.
 */

import { canonicalJsonStringify } from '../canonical-json';

const LONG_DASHES = /[‒–—―]/g; // figure/en/em dash, horizontal bar
const HYPHEN_VARIANTS = /[‐‑−]/g; // hyphen, non-breaking hyphen, minus
const SINGLE_QUOTES = /[‘’‚‛]/g;
const DOUBLE_QUOTES = /[“”„‟]/g;
const ELLIPSIS = /…/g;
const NBSP = /\u00A0/g; // non-breaking space (U+00A0), escaped so the regex body is reviewable

/** Normalize text for comparison: NFC plus ASCII dash/quote/ellipsis hygiene. Idempotent. */
export function canonicalizeText(input: string): string {
  // No type coercion: a non-string here is a caller bug. The verifier wraps
  // canonicalizeText in a try/catch and fails closed (engine_error block), so
  // letting a non-string throw is the correct over-block behavior.
  return input
    .normalize('NFC')
    .replace(LONG_DASHES, '-')
    .replace(HYPHEN_VARIANTS, '-')
    .replace(SINGLE_QUOTES, "'")
    .replace(DOUBLE_QUOTES, '"')
    .replace(ELLIPSIS, '...')
    .replace(NBSP, ' ');
}

const MAX_JSON_DEPTH = 100;

/**
 * Bound nesting depth before the (recursive) canonicalization runs. The public
 * POST /api/integrity/verify endpoint feeds attacker-controlled JSON through
 * canonicalizeJson; without a cap a deeply-nested body could exhaust the call
 * stack. The cap is far above any legitimate receipt/bundle shape.
 */
function assertBoundedDepth(value: unknown, depth: number): void {
  if (depth > MAX_JSON_DEPTH) {
    const err = new Error('integrity: JSON nesting exceeds max depth') as Error & { code?: string };
    err.code = 'MAX_DEPTH';
    throw err;
  }
  if (Array.isArray(value)) {
    for (const v of value) assertBoundedDepth(v, depth + 1);
  } else if (value && typeof value === 'object') {
    for (const k in value as Record<string, unknown>) {
      assertBoundedDepth((value as Record<string, unknown>)[k], depth + 1);
    }
  }
}

/** Recursively NFC-normalize string values and object keys. */
function nfcDeep(value: unknown): unknown {
  if (typeof value === 'string') return value.normalize('NFC');
  if (Array.isArray(value)) return value.map(nfcDeep);
  // A Date has no own entries, so the object branch below would rebuild it as
  // `{}` and destroy it before canonicalJsonStringify ever saw it — the same
  // bug that made signed evidence bundles fail their own re-verification. Hand
  // it through untouched; the one serializer owns Date encoding.
  if (value instanceof Date) return value;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k.normalize('NFC')] = nfcDeep(v);
    return out;
  }
  return value;
}

/** Deterministic JSON: NFC, sorted keys, no whitespace, undefined dropped. */
export function canonicalizeJson(value: unknown): string {
  assertBoundedDepth(value, 0);
  return canonicalJsonStringify(nfcDeep(value));
}
