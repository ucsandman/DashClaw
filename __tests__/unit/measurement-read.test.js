import { describe, it, expect } from 'vitest';
import { deriveCohort, applyContract } from '../../scripts/measurement-read.mjs';

// Pins the v5.5 measurement-contract arithmetic the v6.5 read applies
// (docs/superpowers/specs/2026-07-05-reach-readiness-verdict-v55.md).

describe('deriveCohort', () => {
  it("excludes the 'unknown' bucket (pre-act mints) and sums the rest", () => {
    const cohort = deriveCohort([
      { source: 'unknown', minted: 4, firstAction: 0 },
      { source: 'github', minted: 3, firstAction: 1 },
      { source: 'direct', minted: 2, firstAction: 0 },
      { source: 'other', minted: 1, firstAction: 1 },
    ]);
    expect(cohort.n).toBe(6);
    expect(cohort.firstAction).toBe(2);
    expect(cohort.channels.map((c) => c.source)).toEqual(['github', 'direct', 'other']);
  });

  it('handles a missing or empty bySource as an empty cohort', () => {
    expect(deriveCohort(undefined)).toEqual({ channels: [], n: 0, firstAction: 0 });
    expect(deriveCohort([{ source: 'unknown', minted: 4, firstAction: 0 }]).n).toBe(0);
  });

  it("excludes the 'drill' bucket (v8.3 drill mints are maintainer traffic, never cohort)", () => {
    const cohort = deriveCohort([
      { source: 'drill', minted: 2, firstAction: 2 },
      { source: 'github', minted: 3, firstAction: 1 },
    ]);
    expect(cohort.n).toBe(3);
    expect(cohort.firstAction).toBe(1);
    expect(cohort.channels.map((c) => c.source)).toEqual(['github']);
  });
});

describe('applyContract', () => {
  it('>=1 firstAction -> activation, regardless of n', () => {
    expect(applyContract({ n: 1, firstAction: 1 }).verdict).toBe('activation');
    expect(applyContract({ n: 40, firstAction: 1 }).verdict).toBe('activation');
  });

  it('n>=10 with zero firstActions -> counter-verdict', () => {
    expect(applyContract({ n: 10, firstAction: 0 }).verdict).toBe('counter-verdict');
    expect(applyContract({ n: 25, firstAction: 0 }).verdict).toBe('counter-verdict');
  });

  it('zero firstActions below the counter-verdict threshold -> no verdict fires', () => {
    expect(applyContract({ n: 0, firstAction: 0 }).verdict).toBe('no-verdict');
    expect(applyContract({ n: 9, firstAction: 0 }).verdict).toBe('no-verdict');
  });

  it('directional rate only evaluable at n>=8', () => {
    expect(applyContract({ n: 7, firstAction: 1 }).directional).toBeNull();
    expect(applyContract({ n: 8, firstAction: 2 }).directional).toEqual({ rate: 25, target: 25 });
    expect(applyContract({ n: 12, firstAction: 1 }).directional).toEqual({ rate: 8.3, target: 25 });
  });
});
