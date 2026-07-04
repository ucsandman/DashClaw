/**
 * Phase 2c action-binding tests (issue #121).
 *
 * Covers the shared canonicalization / digest / parse / status module that the
 * issuer and the guard both depend on. The whole feature rests on issuer and
 * verifier producing the same bytes, so determinism is the headline property.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ACT_BINDING_CLAIM,
  canonicalizeActionTuple,
  computeActBindingHash,
  parseActBinding,
  resolveActStatus,
  getActBindingMode,
  getSupportedTyps,
} from '@/lib/act-binding.js';

const TUPLE = {
  action: 'http.GET',
  target: 'https://api.example/customers/42',
  goal: 'read the customer record to summarize recent orders',
};

describe('canonicalizeActionTuple', () => {
  it('is independent of input key order', () => {
    const a = canonicalizeActionTuple({ action: 'a', target: 'b', goal: 'c' });
    const b = canonicalizeActionTuple({ goal: 'c', target: 'b', action: 'a' });
    expect(a).toBe(b);
  });

  it('emits keys in lexicographic order with no whitespace', () => {
    expect(canonicalizeActionTuple({ action: 'a', target: 'c', goal: 'b' }))
      .toBe('{"action":"a","goal":"b","target":"c"}');
  });

  it('NFC-normalizes values so precomposed and decomposed Unicode agree', () => {
    // Source kept ASCII on purpose: build the two forms from code points so the
    // test genuinely exercises NFC rather than comparing identical literals.
    const precomposed = String.fromCodePoint(0x63,0x61,0x66,0xe9);        // 'cafe' + precomposed e-acute (U+00E9)
    const decomposed = String.fromCodePoint(0x63,0x61,0x66,0x65,0x301);   // 'cafe' + combining acute (U+0301)
    expect(precomposed).not.toBe(decomposed); // guard: the inputs really differ
    expect(canonicalizeActionTuple({ ...TUPLE, goal: precomposed }))
      .toBe(canonicalizeActionTuple({ ...TUPLE, goal: decomposed }));
  });

  it('throws CTX_INCOMPLETE when a field is missing', () => {
    expect(() => canonicalizeActionTuple({ action: 'a', goal: 'b' }))
      .toThrowError(expect.objectContaining({ code: 'CTX_INCOMPLETE' }));
  });

  it('throws CTX_INCOMPLETE when a field is empty or non-string', () => {
    expect(() => canonicalizeActionTuple({ action: 'a', target: '', goal: 'b' }))
      .toThrowError(expect.objectContaining({ code: 'CTX_INCOMPLETE' }));
    expect(() => canonicalizeActionTuple({ action: 'a', target: 5, goal: 'b' }))
      .toThrowError(expect.objectContaining({ code: 'CTX_INCOMPLETE' }));
  });
});

describe('computeActBindingHash', () => {
  it('produces a sha256:base64url string', () => {
    const hash = computeActBindingHash(TUPLE);
    expect(hash).toMatch(/^sha256:[A-Za-z0-9_-]+$/);
  });

  it('is stable for the same tuple', () => {
    expect(computeActBindingHash(TUPLE)).toBe(computeActBindingHash({ ...TUPLE }));
  });

  it('changes when any field changes', () => {
    const base = computeActBindingHash(TUPLE);
    expect(computeActBindingHash({ ...TUPLE, action: 'http.DELETE' })).not.toBe(base);
    expect(computeActBindingHash({ ...TUPLE, target: 'https://api.example/customers/99' })).not.toBe(base);
    expect(computeActBindingHash({ ...TUPLE, goal: 'delete everything' })).not.toBe(base);
  });
});

describe('parseActBinding', () => {
  afterEach(() => { delete process.env.DASHCLAW_ACT_BINDING_TYP; });

  it('parses a well-formed claim and marks the default typ supported', () => {
    const { act, actTypSupported } = parseActBinding({
      [ACT_BINDING_CLAIM]: { typ: 'action-binding/v1', hash: 'sha256:abc' },
    });
    expect(act).toEqual({ typ: 'action-binding/v1', hash: 'sha256:abc' });
    expect(actTypSupported).toBe(true);
  });

  it('returns act:null when the claim is absent', () => {
    expect(parseActBinding({ sub: 'agt_1' })).toEqual({ act: null, actTypSupported: false });
  });

  it('treats a malformed claim as absent (cannot pass as a match)', () => {
    expect(parseActBinding({ [ACT_BINDING_CLAIM]: 'not-an-object' })).toEqual({ act: null, actTypSupported: false });
    expect(parseActBinding({ [ACT_BINDING_CLAIM]: { typ: 'action-binding/v1' } })).toEqual({ act: null, actTypSupported: false });
    expect(parseActBinding({ [ACT_BINDING_CLAIM]: ['x'] })).toEqual({ act: null, actTypSupported: false });
  });

  it('parses an unsupported typ but flags it unsupported', () => {
    const { act, actTypSupported } = parseActBinding({
      [ACT_BINDING_CLAIM]: { typ: 'action-binding/v2', hash: 'sha256:abc' },
    });
    expect(act).toEqual({ typ: 'action-binding/v2', hash: 'sha256:abc' });
    expect(actTypSupported).toBe(false);
  });

  it('honors DASHCLAW_ACT_BINDING_TYP overrides', () => {
    process.env.DASHCLAW_ACT_BINDING_TYP = 'action-binding/v1, action-binding/v2';
    expect(parseActBinding({ [ACT_BINDING_CLAIM]: { typ: 'action-binding/v2', hash: 'sha256:abc' } }).actTypSupported).toBe(true);
  });
});

describe('resolveActStatus', () => {
  const matchingHash = computeActBindingHash(TUPLE);
  const ctx = { action_type: TUPLE.action, target: TUPLE.target, declared_goal: TUPLE.goal };

  it('is not_applicable for a non-verified token', () => {
    expect(resolveActStatus({ verification_status: 'unverified' }, ctx)).toBe('not_applicable');
    expect(resolveActStatus(null, ctx)).toBe('not_applicable');
  });

  it('is not_present when a verified token carries no binding', () => {
    expect(resolveActStatus({ verification_status: 'verified', act: null }, ctx)).toBe('not_present');
  });

  it('is unsupported_typ when the typ is not understood', () => {
    expect(resolveActStatus(
      { verification_status: 'verified', act: { typ: 'action-binding/v2', hash: matchingHash }, act_typ_supported: false },
      ctx,
    )).toBe('unsupported_typ');
  });

  it('is match when the digest matches', () => {
    expect(resolveActStatus(
      { verification_status: 'verified', act: { typ: 'action-binding/v1', hash: matchingHash }, act_typ_supported: true },
      ctx,
    )).toBe('match');
  });

  it('is mismatch when the call differs from the binding', () => {
    expect(resolveActStatus(
      { verification_status: 'verified', act: { typ: 'action-binding/v1', hash: matchingHash }, act_typ_supported: true },
      { ...ctx, action_type: 'http.DELETE' },
    )).toBe('mismatch');
  });

  it('is ctx_incomplete when the request lacks a field needed for the digest', () => {
    expect(resolveActStatus(
      { verification_status: 'verified', act: { typ: 'action-binding/v1', hash: matchingHash }, act_typ_supported: true },
      { action_type: TUPLE.action, declared_goal: TUPLE.goal }, // no target
    )).toBe('ctx_incomplete');
  });
});

describe('getActBindingMode / getSupportedTyps', () => {
  beforeEach(() => {
    delete process.env.DASHCLAW_ACT_BINDING;
    delete process.env.DASHCLAW_ACT_BINDING_TYP;
  });
  afterEach(() => {
    delete process.env.DASHCLAW_ACT_BINDING;
    delete process.env.DASHCLAW_ACT_BINDING_TYP;
  });

  it('defaults to best_effort (v3.6 flip) and rejects unknown modes', () => {
    expect(getActBindingMode()).toBe('best_effort');
    process.env.DASHCLAW_ACT_BINDING = 'garbage';
    expect(getActBindingMode()).toBe('best_effort');
    process.env.DASHCLAW_ACT_BINDING = 'off';
    expect(getActBindingMode()).toBe('off');
    process.env.DASHCLAW_ACT_BINDING = 'REQUIRED';
    expect(getActBindingMode()).toBe('required');
  });

  it('defaults to action-binding/v1', () => {
    expect(getSupportedTyps()).toEqual(['action-binding/v1']);
    process.env.DASHCLAW_ACT_BINDING_TYP = 'a/v1 , b/v2';
    expect(getSupportedTyps()).toEqual(['a/v1', 'b/v2']);
  });
});
