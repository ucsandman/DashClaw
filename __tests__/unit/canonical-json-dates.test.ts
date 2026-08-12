import { describe, expect, it } from 'vitest';
import { canonicalJsonStringify } from '@/lib/canonical-json.js';
import { canonicalizeJson } from '@/lib/integrity/canonicalize-pure.js';

// Regression pin for the signed-evidence-bundle self-verification failure:
// a Date has no own enumerable keys, so both canonicalizers hashed EVERY Date
// as `{}`. Evidence bundles are built from live `TIMESTAMP` rows (both drivers
// in app/lib/db.ts return TIMESTAMP as a JS Date), so a bundle signed with
// Dates could not validate against itself once the same values had been
// through JSON and arrived back as ISO strings.
//
// The contract these tests pin: canonicalize(v) === canonicalize(JSON round
// trip of v), for both implementations, which is exactly what sign-then-verify
// does across the wire.

const roundTrip = (v: unknown) => JSON.parse(JSON.stringify(v));

describe('canonicalJsonStringify — Date handling', () => {
  it('encodes a Date as its ISO-8601 string, not as {}', () => {
    const d = new Date('2026-08-11T10:20:30.400Z');
    expect(canonicalJsonStringify(d)).toBe('"2026-08-11T10:20:30.400Z"');
    expect(canonicalJsonStringify(d)).toBe(canonicalJsonStringify(d.toISOString()));
  });

  it('survives a JSON round trip unchanged for a bundle-shaped payload', () => {
    const payload = {
      artifact_type: 'evidence_bundle',
      action: { action_id: 'act_1', started_at: new Date('2026-08-11T10:00:00.000Z') },
      artifacts: [
        { artifact_id: 'art_1', created_at: new Date('2026-08-10T09:00:00.000Z'), updated_at: null },
      ],
      generated_at: new Date('2026-08-11T11:00:00.000Z').toISOString(),
    };
    expect(canonicalJsonStringify(payload)).toBe(canonicalJsonStringify(roundTrip(payload)));
  });

  it('handles Dates nested in arrays and in nested objects', () => {
    const v = { a: [new Date('2020-01-02T03:04:05.000Z')], b: { c: new Date('2021-02-03T04:05:06.000Z') } };
    expect(canonicalJsonStringify(v)).toBe(
      '{"a":["2020-01-02T03:04:05.000Z"],"b":{"c":"2021-02-03T04:05:06.000Z"}}',
    );
    expect(canonicalJsonStringify(v)).toBe(canonicalJsonStringify(roundTrip(v)));
  });

  it('encodes an invalid Date as null, matching Date.prototype.toJSON', () => {
    const v = { at: new Date('nope') };
    expect(canonicalJsonStringify(v)).toBe('{"at":null}');
    expect(canonicalJsonStringify(v)).toBe(canonicalJsonStringify(roundTrip(v)));
  });

  it('still treats null as null, not as a Date', () => {
    expect(canonicalJsonStringify({ a: null })).toBe('{"a":null}');
  });
});

describe('canonicalizeJson — Date handling', () => {
  it('encodes a Date as its ISO-8601 string, not as {}', () => {
    const d = new Date('2026-08-11T10:20:30.400Z');
    expect(canonicalizeJson(d)).toBe('"2026-08-11T10:20:30.400Z"');
  });

  it('survives a JSON round trip unchanged (sign-time hash === verify-time hash)', () => {
    const payload = {
      action: { started_at: new Date('2026-08-11T10:00:00.000Z'), finished_at: new Date('2026-08-11T10:05:00.000Z') },
      artifacts: [{ created_at: new Date('2026-08-10T09:00:00.000Z') }],
    };
    expect(canonicalizeJson(payload)).toBe(canonicalizeJson(roundTrip(payload)));
  });

  it('encodes an invalid Date as null', () => {
    expect(canonicalizeJson({ at: new Date('nope') })).toBe('{"at":null}');
  });
});

// The two functions are two implementations of one contract; a divergence
// between them is its own bug, so pin them against each other directly. Inputs
// are already NFC so canonicalizeJson's normalize step is a no-op.
describe('both canonicalizers agree', () => {
  const cases: Array<[string, unknown]> = [
    ['bare Date', new Date('2026-08-11T10:20:30.400Z')],
    ['invalid Date', new Date('nope')],
    ['Date in object', { at: new Date('2026-08-11T10:20:30.400Z') }],
    ['Date in array', [new Date('2026-08-11T10:20:30.400Z'), 1]],
    ['deeply nested Date', { a: { b: [{ c: new Date('2026-08-11T10:20:30.400Z') }] } }],
    ['null', null],
    ['array of primitives', [1, 'two', true, null]],
    ['unsorted keys', { b: 2, a: 1 }],
  ];

  for (const [name, value] of cases) {
    it(`agree on ${name}`, () => {
      expect(canonicalizeJson(value)).toBe(canonicalJsonStringify(value));
    });
  }
});
