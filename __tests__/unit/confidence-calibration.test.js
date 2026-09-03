import { describe, it, expect } from 'vitest';
import {
  buildConfidenceCalibration,
  MIN_SCORED,
  GAP_THRESHOLD,
} from '../../app/lib/confidence-calibration.js';

// Shorthand for a row of the buckets query.
function bucket(agent_id, bucketKey, n, completed, avg_confidence, agent_name = null) {
  return { agent_id, agent_name, bucket: bucketKey, n, completed, avg_confidence };
}

describe('buildConfidenceCalibration — empty input', () => {
  it('never throws and reports zero coverage rather than a clean verdict', () => {
    const result = buildConfidenceCalibration([], [], 30);
    expect(result.window_days).toBe(30);
    expect(result.coverage).toEqual({ closed: 0, stated: 0 });
    expect(result.overall).toEqual({
      n: 0,
      stated_avg: 0,
      observed_rate: 0,
      gap: 0,
      verdict: 'insufficient',
    });
    expect(result.agents).toEqual([]);
  });

  it('tolerates null/undefined row arrays', () => {
    expect(() => buildConfidenceCalibration(null, undefined, 30)).not.toThrow();
    expect(buildConfidenceCalibration(null, undefined, 30).agents).toEqual([]);
  });
});

describe('buildConfidenceCalibration — bucket math', () => {
  it('computes n, stated_avg, observed_rate and gap per bucket', () => {
    const result = buildConfidenceCalibration(
      [bucket('a1', 'b90_plus', 10, 6, 90, 'Deployer')],
      [{ agent_id: 'a1', closed: 40, stated: 10 }],
      30,
    );

    expect(result.agents).toHaveLength(1);
    const agent = result.agents[0];
    expect(agent.agent_id).toBe('a1');
    expect(agent.agent_name).toBe('Deployer');
    expect(agent.n).toBe(10);
    expect(agent.stated_avg).toBe(90);
    expect(agent.observed_rate).toBe(60);
    expect(agent.gap).toBe(30);
    expect(agent.verdict).toBe('overconfident');
    expect(agent.coverage).toEqual({ closed: 40, stated: 10 });
    expect(agent.buckets).toEqual([
      { bucket: 'b90_plus', label: '90 and up', n: 10, stated_avg: 90, observed_rate: 60, gap: 30 },
    ]);
    // Overall mirrors the single agent.
    expect(result.overall.n).toBe(10);
    expect(result.overall.gap).toBe(30);
    expect(result.coverage).toEqual({ closed: 40, stated: 10 });
  });

  it('emits buckets in canonical order and omits empty ones', () => {
    const result = buildConfidenceCalibration(
      [
        bucket('a1', 'b90_plus', 5, 5, 95),
        bucket('a1', 'lt50', 5, 1, 40),
        bucket('a1', 'b70_89', 0, 0, 80),
        bucket('a1', 'not_a_bucket', 99, 99, 99),
      ],
      [],
      30,
    );
    expect(result.agents[0].buckets.map((b) => b.bucket)).toEqual(['lt50', 'b90_plus']);
    expect(result.agents[0].buckets.map((b) => b.label)).toEqual(['Under 50', '90 and up']);
    // The unknown bucket key contributed nothing to the totals either.
    expect(result.agents[0].n).toBe(10);
  });

  it('sums coverage across every agent, including agents with nothing scored', () => {
    const result = buildConfidenceCalibration(
      [bucket('a1', 'b90_plus', 10, 10, 95)],
      [
        { agent_id: 'a1', closed: 100, stated: 10 },
        { agent_id: 'silent', closed: 900, stated: 0 },
      ],
      30,
    );
    expect(result.coverage).toEqual({ closed: 1000, stated: 10 });
    // The silent agent has nothing to score, so it gets no row of dashes.
    expect(result.agents.map((a) => a.agent_id)).toEqual(['a1']);
  });
});

describe('buildConfidenceCalibration — weighted stated_avg', () => {
  it('weights each bucket average by its own n rather than averaging the averages', () => {
    const result = buildConfidenceCalibration(
      [
        bucket('a1', 'b90_plus', 10, 5, 90),
        bucket('a1', 'b50_69', 30, 30, 60),
      ],
      [],
      30,
    );
    const agent = result.agents[0];
    // (90*10 + 60*30) / 40 = 67.5 -> 68. A naive mean of the averages would be 75.
    expect(agent.stated_avg).toBe(68);
    // 35 completed of 40 = 87.5 -> 88.
    expect(agent.observed_rate).toBe(88);
    expect(agent.gap).toBe(-20);
    expect(agent.verdict).toBe('underconfident');
  });

  it('weights the overall row across agents, not across agent averages', () => {
    const result = buildConfidenceCalibration(
      [
        bucket('big', 'b50_69', 90, 90, 60),
        bucket('small', 'b90_plus', 10, 0, 100),
      ],
      [],
      30,
    );
    // (60*90 + 100*10) / 100 = 64. Averaging the two agents would give 80.
    expect(result.overall.stated_avg).toBe(64);
    expect(result.overall.observed_rate).toBe(90);
    expect(result.overall.gap).toBe(-26);
    expect(result.overall.verdict).toBe('underconfident');
  });
});

describe('buildConfidenceCalibration — verdict thresholds', () => {
  const verdictAt = (n, completed, avg) =>
    buildConfidenceCalibration([bucket('a1', 'b90_plus', n, completed, avg)], [], 30).overall;

  it(`declines a verdict at n = ${MIN_SCORED - 1} however extreme the gap`, () => {
    const overall = verdictAt(MIN_SCORED - 1, 0, 100);
    expect(overall.n).toBe(9);
    expect(overall.gap).toBe(100);
    expect(overall.verdict).toBe('insufficient');
  });

  it(`gives a verdict at exactly n = ${MIN_SCORED}`, () => {
    const overall = verdictAt(MIN_SCORED, 0, 100);
    expect(overall.n).toBe(10);
    expect(overall.verdict).toBe('overconfident');
  });

  it(`calls a gap of ${GAP_THRESHOLD - 1} calibrated`, () => {
    const overall = verdictAt(20, 16, 99);
    expect(overall.stated_avg).toBe(99);
    expect(overall.observed_rate).toBe(80);
    expect(overall.gap).toBe(19);
    expect(overall.verdict).toBe('calibrated');
  });

  it(`calls a gap of exactly ${GAP_THRESHOLD} overconfident`, () => {
    const overall = verdictAt(20, 16, 100);
    expect(overall.gap).toBe(20);
    expect(overall.verdict).toBe('overconfident');
  });

  it(`calls a gap of exactly -${GAP_THRESHOLD} underconfident`, () => {
    const overall = verdictAt(20, 16, 60);
    expect(overall.gap).toBe(-20);
    expect(overall.verdict).toBe('underconfident');
  });

  it(`calls a gap of -${GAP_THRESHOLD - 1} calibrated`, () => {
    const overall = verdictAt(20, 16, 61);
    expect(overall.gap).toBe(-19);
    expect(overall.verdict).toBe('calibrated');
  });
});

describe('buildConfidenceCalibration — sorting', () => {
  it('puts overconfident agents first, then orders by scored volume descending', () => {
    const result = buildConfidenceCalibration(
      [
        bucket('calibrated_big', 'b70_89', 100, 80, 80),
        bucket('over_small', 'b90_plus', 10, 0, 95),
        bucket('over_mid', 'b90_plus', 50, 10, 95),
        bucket('under_big', 'b50_69', 200, 200, 55),
      ],
      [],
      30,
    );
    expect(result.agents.map((a) => a.agent_id)).toEqual([
      'over_mid',
      'over_small',
      'under_big',
      'calibrated_big',
    ]);
    expect(result.agents.map((a) => a.verdict)).toEqual([
      'overconfident',
      'overconfident',
      'underconfident',
      'calibrated',
    ]);
  });
});

describe('buildConfidenceCalibration — coercion', () => {
  it('coerces string numerics and treats null/undefined as zero', () => {
    const result = buildConfidenceCalibration(
      [
        { agent_id: 'a1', agent_name: null, bucket: 'lt50', n: '10', completed: null, avg_confidence: undefined },
        { agent_id: 'a1', agent_name: 'Named later', bucket: 'b90_plus', n: '10', completed: '10', avg_confidence: '95.4' },
      ],
      [{ agent_id: 'a1', closed: '30', stated: undefined }],
      30,
    );
    const agent = result.agents[0];
    expect(agent.agent_name).toBe('Named later');
    expect(agent.n).toBe(20);
    // (0*10 + 95.4*10) / 20 = 47.7 -> 48
    expect(agent.stated_avg).toBe(48);
    expect(agent.observed_rate).toBe(50);
    expect(agent.gap).toBe(-2);
    expect(agent.verdict).toBe('calibrated');
    expect(agent.coverage).toEqual({ closed: 30, stated: 0 });
    expect(result.coverage).toEqual({ closed: 30, stated: 0 });
  });

  it('survives a row with a missing agent_id and non-numeric junk', () => {
    const result = buildConfidenceCalibration(
      [{ bucket: 'b70_89', n: 'not a number', completed: 'x', avg_confidence: 'y' }],
      [{ closed: 'x', stated: 'y' }],
      30,
    );
    // n coerced to 0, so the row contributes no scored actions at all.
    expect(result.agents).toEqual([]);
    expect(result.overall.n).toBe(0);
    expect(result.coverage).toEqual({ closed: 0, stated: 0 });
  });
});
