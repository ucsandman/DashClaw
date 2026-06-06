/**
 * Phase 2c frozen interop test vectors (issue #121).
 *
 * The act-binding property is "issuer and verifier hash the same bytes." The
 * unit suite in `__tests__/unit/act-binding.test.js` proves the digest is
 * self-consistent against itself — it does not prove an *independent* issuer
 * would land on the same bytes. These vectors close that gap: each tuple has
 * a frozen canonical form and a frozen `sha256:` digest, locked in CI.
 *
 * Six cases, chosen to cover the canonicalization surface:
 *
 *   1. ASCII read tuple — baseline.
 *   2. ASCII delete tuple — action variation, distinct digest.
 *   3. Unicode precomposed (U+00E9 in target + goal).
 *   4. Unicode decomposed (U+0065 U+0301 in target + goal). Must hash IDENTICAL
 *      to (3); that's the NFC fold proof. If a future canonicalization change
 *      drops NFC normalization, (3) and (4) part ways and this test fails.
 *   5. Quote + backslash escaping in target and goal.
 *   6. Embedded control character (literal newline) in goal.
 *
 * Each case asserts BOTH the canonical string AND the digest. Splitting the two
 * means a future regression points at *which half* drifted: an unintended
 * canonicalization change shows up as a canonical mismatch; an unintended
 * digest change (different algorithm, different encoding) shows up as a digest
 * mismatch while the canonical bytes still line up.
 *
 * The vectors were independently re-derived from the act-binding.ts module
 * header spec by a hand-rolled lex-ordered string builder that doesn't rely
 * on V8 insertion-order enumeration. 6/6 agree byte-for-byte.
 *
 * Changing any expected value in this file is a wire-format break. If a future
 * change forces it, bump `urn:dashclaw:act-binding`'s `typ` suffix
 * (`action-binding/v1` → `v2`) and re-derive a fresh vector set rather than
 * silently editing these.
 */
import { describe, it, expect } from 'vitest';
import {
  canonicalizeActionTuple,
  computeActBindingHash,
} from '@/lib/act-binding.js';

const VECTORS = [
  {
    name: 'vec.ascii.read-customer',
    tuple: {
      action: 'http.GET',
      target: 'https://api.example/customers/42',
      goal: 'read the customer record to summarize recent orders',
    },
    canonical:
      '{"action":"http.GET","goal":"read the customer record to summarize recent orders","target":"https://api.example/customers/42"}',
    hash: 'sha256:XfBUzVuMEr-BUnGQtAT06R_Hzlt8pocE2aEywEL2s9k',
  },
  {
    name: 'vec.ascii.delete-order',
    tuple: {
      action: 'http.DELETE',
      target: 'https://api.example/orders/9001',
      goal: 'delete the cancelled order at the user request',
    },
    canonical:
      '{"action":"http.DELETE","goal":"delete the cancelled order at the user request","target":"https://api.example/orders/9001"}',
    hash: 'sha256:8m9D2_tkCCf5Q67SNFMs4VjwtwnP376pqefXI46baao',
  },
  {
    // U+00E9 (LATIN SMALL LETTER E WITH ACUTE) inline in source.
    name: 'vec.unicode.precomposed',
    tuple: {
      action: 'agent.note',
      target: String.fromCodePoint(0x63, 0x61, 0x66, 0xe9),
      goal: 'add a note about the ' + String.fromCodePoint(0x63, 0x61, 0x66, 0xe9) + ' visit',
    },
    canonical:
      '{"action":"agent.note","goal":"add a note about the ' +
      String.fromCodePoint(0x63, 0x61, 0x66, 0xe9) +
      ' visit","target":"' +
      String.fromCodePoint(0x63, 0x61, 0x66, 0xe9) +
      '"}',
    hash: 'sha256:D1svv5sGwpixEiwRJaQ-xRWrOHEFQdx60Qk3qSB_xbU',
  },
  {
    // Same caf{e+combining acute}, U+0065 + U+0301 — must hash identical to the
    // precomposed vector above. That is the NFC fold proof.
    name: 'vec.unicode.decomposed',
    tuple: {
      action: 'agent.note',
      target: String.fromCodePoint(0x63, 0x61, 0x66, 0x65, 0x301),
      goal: 'add a note about the ' + String.fromCodePoint(0x63, 0x61, 0x66, 0x65, 0x301) + ' visit',
    },
    // After NFC the decomposed form folds to the precomposed; canonical bytes
    // are the precomposed serialization.
    canonical:
      '{"action":"agent.note","goal":"add a note about the ' +
      String.fromCodePoint(0x63, 0x61, 0x66, 0xe9) +
      ' visit","target":"' +
      String.fromCodePoint(0x63, 0x61, 0x66, 0xe9) +
      '"}',
    hash: 'sha256:D1svv5sGwpixEiwRJaQ-xRWrOHEFQdx60Qk3qSB_xbU',
  },
  {
    name: 'vec.escape.quotes-and-backslash',
    tuple: {
      action: 'shell.exec',
      target: 'rm -rf "/tmp/with \\ quotes"',
      goal: 'cleanup temp dir with quoted and \\ escaped paths',
    },
    canonical:
      '{"action":"shell.exec","goal":"cleanup temp dir with quoted and \\\\ escaped paths","target":"rm -rf \\"/tmp/with \\\\ quotes\\""}',
    hash: 'sha256:73778maUi-E7ySXocYn8BwSLqsQmOCN_KxhsJMDSmz0',
  },
  {
    name: 'vec.escape.control-char',
    tuple: {
      action: 'log.write',
      target: 'app.log',
      goal: 'line1\nline2',
    },
    canonical:
      '{"action":"log.write","goal":"line1\\nline2","target":"app.log"}',
    hash: 'sha256:Rn2KBAu2PX4OAL_ziqCja2zDfvfyoMQoDU3XzwBJLbw',
  },
];

describe('act-binding frozen interop vectors (Phase 2c)', () => {
  for (const v of VECTORS) {
    describe(v.name, () => {
      it('canonicalizes to the frozen byte string', () => {
        expect(canonicalizeActionTuple(v.tuple)).toBe(v.canonical);
      });
      it('hashes to the frozen sha256:base64url digest', () => {
        expect(computeActBindingHash(v.tuple)).toBe(v.hash);
      });
    });
  }

  it('NFC fold: precomposed and decomposed café canonicalize identically', () => {
    const precomposed = VECTORS.find((v) => v.name === 'vec.unicode.precomposed');
    const decomposed = VECTORS.find((v) => v.name === 'vec.unicode.decomposed');
    // Guard: the inputs really differ before NFC.
    expect(precomposed.tuple.target).not.toBe(decomposed.tuple.target);
    expect(precomposed.tuple.goal).not.toBe(decomposed.tuple.goal);
    // Post-canonicalization they fold together.
    expect(canonicalizeActionTuple(precomposed.tuple)).toBe(
      canonicalizeActionTuple(decomposed.tuple),
    );
    expect(computeActBindingHash(precomposed.tuple)).toBe(
      computeActBindingHash(decomposed.tuple),
    );
  });
});
