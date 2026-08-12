/**
 * Canonical JSON stringify for stable signing/verification.
 *
 * JSON.stringify is not a canonical representation of objects:
 * key order can vary depending on object construction.
 *
 * This function produces a deterministic JSON string by sorting object keys.
 * - Object keys are sorted lexicographically.
 * - Undefined object values are omitted (matching JSON.stringify behavior).
 * - Undefined array entries are encoded as null (matching JSON.stringify behavior).
 * - Dates are encoded as ISO-8601 strings (matching JSON.stringify behavior).
 *
 * The invariant callers depend on: canonicalize(v) === canonicalize(JSON round
 * trip of v). Sign-time and verify-time sit on opposite sides of a JSON
 * transport, so anything that serializes differently from JSON.stringify
 * produces a signature that cannot validate against itself.
 */

function canonicalize(value: unknown): string {
  if (value === null) return 'null';

  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean') return JSON.stringify(value);

  if (t === 'undefined') return 'null';

  if (Array.isArray(value)) {
    const parts = value.map((v) => (typeof v === 'undefined' ? 'null' : canonicalize(v)));
    return `[${parts.join(',')}]`;
  }

  if (t === 'object') {
    // A Date has no own enumerable keys, so the generic branch below hashed
    // EVERY Date as `{}`. Evidence bundles are built from live TIMESTAMP rows
    // (both drivers in app/lib/db.ts return TIMESTAMP as a JS Date), so a
    // bundle signed with Dates could not validate against itself: by verify
    // time the same values had been through JSON and arrived as ISO strings.
    // Match JSON.stringify exactly — ISO-8601, and `null` for an invalid Date
    // (Date.prototype.toJSON returns null on a non-finite time value) — so the
    // canonical form is identical on both sides of the wire.
    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? 'null' : JSON.stringify(value.toISOString());
    }

    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj)
      .filter((k) => typeof obj[k] !== 'undefined')
      .sort();
    const parts = keys.map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`);
    return `{${parts.join(',')}}`;
  }

  // Fallback for unsupported types (bigint, function, symbol): match JSON.stringify -> undefined
  return 'null';
}

export function canonicalJsonStringify(value: unknown): string {
  return canonicalize(value);
}
