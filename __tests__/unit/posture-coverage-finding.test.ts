/**
 * v4.2 coverage truth — deriveCoverageFinding threshold + min-sample + fix.
 */
import { describe, it, expect } from 'vitest';
import {
  deriveCoverageFinding,
  COVERAGE_MIN_PCT,
  COVERAGE_MIN_EXPECTED,
  COVERAGE_MIN_CLOSES,
  type AgentCoverageLike,
} from '../../app/lib/posture/findings';

const NOW = Date.parse('2026-07-04T00:00:00Z');

const agent = (over: Partial<AgentCoverageLike>): AgentCoverageLike => ({
  agentId: 'a1',
  expected: 0,
  recordPct: null,
  outcomePct: null,
  outcomeSample: 0,
  ...over,
});

describe('deriveCoverageFinding', () => {
  it('returns null when no agent is below the bar', () => {
    expect(deriveCoverageFinding([], NOW)).toBeNull();
    expect(deriveCoverageFinding([agent({ recordPct: 95, expected: 100 })], NOW)).toBeNull();
  });

  it('fires on a record-coverage drop below 90% with ≥ 20 expected', () => {
    const f = deriveCoverageFinding([agent({ recordPct: 60, expected: 40 })], NOW);
    expect(f).not.toBeNull();
    expect(f!.dimension).toBe('auditability');
    expect(f!.fix).toEqual({ type: 'view_coverage', deepLink: '/agents' });
    expect(f!.evidence.observedCount).toBe(1);
    expect(f!.status).toBe('open');
  });

  it('does not fire on a record drop below the min-sample (< 20 expected)', () => {
    expect(deriveCoverageFinding([agent({ recordPct: 10, expected: 19 })], NOW)).toBeNull();
    expect(deriveCoverageFinding([agent({ recordPct: 10, expected: COVERAGE_MIN_EXPECTED })], NOW)).not.toBeNull();
  });

  it('fires on an outcome-coverage drop below 90% with ≥ 20 hook-recorded closes', () => {
    const f = deriveCoverageFinding([agent({ outcomePct: 50, outcomeSample: 40 })], NOW);
    expect(f).not.toBeNull();
    expect(f!.fix.type).toBe('view_coverage');
  });

  it('does not fire on an outcome drop below the min-sample (< 20 closes)', () => {
    expect(deriveCoverageFinding([agent({ outcomePct: 10, outcomeSample: 19 })], NOW)).toBeNull();
    expect(deriveCoverageFinding([agent({ outcomePct: 10, outcomeSample: COVERAGE_MIN_CLOSES })], NOW)).not.toBeNull();
  });

  it('collapses multiple offenders into ONE finding listing the count', () => {
    const f = deriveCoverageFinding([
      agent({ agentId: 'a1', recordPct: 50, expected: 100 }),
      agent({ agentId: 'a2', outcomePct: 40, outcomeSample: 50 }),
      agent({ agentId: 'a3', recordPct: 99, expected: 100 }), // healthy, excluded
    ], NOW);
    expect(f).not.toBeNull();
    expect(f!.evidence.observedCount).toBe(2);
    expect(f!.title).toContain('2 agents');
  });

  it('exposes the calibrated bar constants', () => {
    expect(COVERAGE_MIN_PCT).toBe(90);
    expect(COVERAGE_MIN_EXPECTED).toBe(20);
    expect(COVERAGE_MIN_CLOSES).toBe(20);
  });
});
