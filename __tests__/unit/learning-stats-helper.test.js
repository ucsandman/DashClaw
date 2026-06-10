/**
 * P15: realtime successRate updates must exclude pending outcomes — the
 * server computes the rate over terminal outcomes only, and the old client
 * recompute divided by ALL decisions, drifting the live rate after every
 * decision.created event.
 */
import { describe, expect, it } from 'vitest';
import { applyDecisionToStats } from '../../app/lib/learning-stats';

describe('applyDecisionToStats', () => {
  const base = { totalDecisions: 10, successRate: 50, totalWithOutcome: 4 };

  it('a pending decision bumps the count but NEVER moves the rate', () => {
    const next = applyDecisionToStats(base, 'pending');
    expect(next.totalDecisions).toBe(11);
    expect(next.successRate).toBe(50);
    expect(next.totalWithOutcome).toBe(4);
  });

  it('a success recomputes over terminal outcomes only', () => {
    // 2 of 4 terminal were successes; +1 success → 3/5 = 60%.
    const next = applyDecisionToStats(base, 'success');
    expect(next.successRate).toBe(60);
    expect(next.totalWithOutcome).toBe(5);
  });

  it('a failure dilutes the rate over the terminal denominator', () => {
    // 2 of 4 → 2/5 = 40%.
    const next = applyDecisionToStats(base, 'failure');
    expect(next.successRate).toBe(40);
  });

  it('handles the zero-terminal start state', () => {
    const next = applyDecisionToStats({ totalDecisions: 0, successRate: 0, totalWithOutcome: 0 }, 'success');
    expect(next.successRate).toBe(100);
    expect(next.totalWithOutcome).toBe(1);
  });
});
