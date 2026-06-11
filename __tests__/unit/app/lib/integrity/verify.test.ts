import { describe, expect, it } from 'vitest';
import { DEFAULT_CITATION_SIGNAL, verify } from '@/lib/integrity/verify.js';

function sourceOfTruth() {
  return {
    requiredFacts: [
      { label: 'deposit', value: '$1,500.00', slot: { prefix: 'deposit was ' } },
      { label: 'withheld', value: '$2,000.00', slot: { prefix: 'return ' } },
      { label: 'tenant', value: 'Jane Roe' },
    ],
    allowedFacts: [
      { label: 'deposit', value: '$1,500.00' },
      { label: 'withheld', value: '$2,000.00' },
      { label: 'due_date', value: 'June 1, 2026' },
    ],
    forbiddenPatterns: [{ label: 'citation', pattern: DEFAULT_CITATION_SIGNAL }],
    extract: {
      money: true,
      dates: true,
      percentages: true,
      patterns: [{ label: 'invoice', pattern: 'INV-\\d{4}' }],
    },
  };
}

describe('verify mirrored characterization', () => {
  it('passes grounded text and accepts equivalent money formatting in a required slot', () => {
    const candidate = 'My security deposit was $1,500.00. Please return $2000 to Jane Roe by June 1, 2026.';

    expect(verify(candidate, sourceOfTruth())).toEqual({ verdict: 'pass', violations: [] });
  });

  it('blocks missing required facts, forbidden citations, and fabricated extracted tokens', () => {
    const candidate =
      'My security deposit was $1,500.00. Please return $2,500.00 to John Doe by July 9, 2026. Per RCW section 59.';

    const result = verify(candidate, sourceOfTruth());

    expect(result.verdict).toBe('block');
    expect(result.violations).toEqual(
      expect.arrayContaining([
        { code: 'missing_required', label: 'withheld' },
        { code: 'missing_required', label: 'tenant' },
        { code: 'forbidden_match', label: 'citation' },
        { code: 'fabricated_fact', label: 'money', detail: '$2,500.00' },
        { code: 'fabricated_fact', label: 'date', detail: 'July 9, 2026' },
      ]),
    );
  });

  it('fails closed for malformed source objects and unsafe caller patterns', () => {
    expect(verify('grounded text', {} as never)).toMatchObject({
      verdict: 'block',
      violations: [expect.objectContaining({ code: 'engine_error', label: 'engine' })],
    });

    expect(
      verify('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaX', {
        requiredFacts: [],
        allowedFacts: [],
        forbiddenPatterns: [],
        extract: {
          money: false,
          dates: false,
          percentages: false,
          patterns: [{ label: 'unsafe', pattern: '((a+)+)+$' }],
        },
      }),
    ).toMatchObject({
      verdict: 'block',
      violations: [expect.objectContaining({ code: 'engine_error', label: 'engine' })],
    });
  });

  // Regression: a forbidden pattern is compiled into a RegExp (CodeQL
  // js/regex-injection). A caller-supplied ReDoS-prone forbidden pattern must be
  // rejected at construction (fail-closed engine_error block), not compiled and
  // run. Before forbiddenRegex routed through assertSafePattern, this pattern
  // reached `new RegExp(...)` unguarded.
  it('fails closed on a ReDoS-prone forbidden pattern instead of compiling it', () => {
    expect(
      verify('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaX', {
        requiredFacts: [],
        allowedFacts: [],
        forbiddenPatterns: [{ label: 'evil', pattern: '((a+)+)+$' }],
        extract: { money: false, dates: false, percentages: false, patterns: [] },
      }),
    ).toMatchObject({
      verdict: 'block',
      violations: [expect.objectContaining({ code: 'engine_error', label: 'engine' })],
    });
  });
});
