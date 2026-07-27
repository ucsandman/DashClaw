import { describe, it, expect } from 'vitest';
import { DECISION_SEVERITY, sevOf, hasSev } from '../../app/lib/guard/internal';

describe('decision severity ladder (containment)', () => {
  it('orders the five rungs strictly', () => {
    expect(DECISION_SEVERITY.allow).toBeLessThan(DECISION_SEVERITY.warn);
    expect(DECISION_SEVERITY.warn).toBeLessThan(DECISION_SEVERITY.allow_contained);
    expect(DECISION_SEVERITY.allow_contained).toBeLessThan(DECISION_SEVERITY.require_approval);
    expect(DECISION_SEVERITY.require_approval).toBeLessThan(DECISION_SEVERITY.block);
  });
  it('sevOf/hasSev know the new rung; unknown stays 0/false', () => {
    expect(sevOf('allow_contained')).toBe(DECISION_SEVERITY.allow_contained);
    expect(hasSev('allow_contained')).toBe(true);
    expect(sevOf('made_up')).toBe(0);
    expect(hasSev('made_up')).toBe(false);
  });
  it('raise semantics: contained beats warn, loses to require_approval and block', () => {
    expect(sevOf('allow_contained')).toBeGreaterThan(sevOf('warn'));
    expect(sevOf('require_approval')).toBeGreaterThan(sevOf('allow_contained'));
    expect(sevOf('block')).toBeGreaterThan(sevOf('allow_contained'));
  });
});
