import { describe, it, expect } from 'vitest';
import { riskFactor, bucketRiskScore, unitWeight, gradeCoverage, computeScore, frequencyFactor } from '../../app/lib/posture/model';
import type { GovernableUnit, Adjustments } from '../../app/lib/posture/types';

const unit = (over: Partial<GovernableUnit> = {}): GovernableUnit => ({
  key: 'cap:deploy', surfaceType: 'capability', riskLevel: 'high', reversible: false,
  hasSpendExposure: false, requiresApproval: true, observedCount: 10, dimension: 'enforcement', ...over,
});
const noAdj: Adjustments = { incidents: [], approvalFollowThrough: 1, coachOpenGapUnitKeys: [] };

describe('risk weighting', () => {
  it('maps risk_level to escalating multipliers', () => {
    expect(riskFactor('low')).toBe(1);
    expect(riskFactor('medium')).toBe(3);
    expect(riskFactor('high')).toBe(8);
    expect(riskFactor('critical')).toBe(16);
  });
  it('buckets a numeric risk_score into the four tiers', () => {
    expect(bucketRiskScore(10)).toBe('low');
    expect(bucketRiskScore(40)).toBe('medium');
    expect(bucketRiskScore(60)).toBe('high');
    expect(bucketRiskScore(90)).toBe('critical');
  });
  it('dampens frequency (log) so frequency cannot dominate risk', () => {
    const rare = unitWeight(unit({ observedCount: 1 }));
    const frequent = unitWeight(unit({ observedCount: 1000 }));
    expect(frequent).toBeGreaterThan(rare);
    expect(frequent).toBeLessThan(rare * 5);
  });
  it('irreversible + spend exposure increase weight', () => {
    expect(unitWeight(unit({ reversible: true }))).toBeLessThan(unitWeight(unit({ reversible: false })));
    expect(unitWeight(unit({ hasSpendExposure: false }))).toBeLessThan(unitWeight(unit({ hasSpendExposure: true })));
  });
  it('frequencyFactor: zero/negative count → baseline 1; counts are log-dampened', () => {
    expect(frequencyFactor(0)).toBe(1);
    expect(frequencyFactor(-5)).toBe(1);
    expect(frequencyFactor(9)).toBeCloseTo(2);
    expect(frequencyFactor(99)).toBeCloseTo(3);
  });
});

describe('coverage grading', () => {
  const u = unit();
  it('a non-firing (allow) policy earns ZERO coverage', () => {
    expect(gradeCoverage(u, () => 'allow', () => true).grade).toBe(0);
  });
  it('warn is partial; block/require_approval is full', () => {
    expect(gradeCoverage(u, () => 'warn', () => true).grade).toBe(0.5);
    expect(gradeCoverage(u, () => 'require_approval', () => true).grade).toBe(1);
    expect(gradeCoverage(u, () => 'block', () => true).grade).toBe(1);
  });
  it('declared requires_approval is intent, not coverage', () => {
    expect(gradeCoverage(unit({ requiresApproval: true }), () => 'allow', () => true).grade).toBe(0);
  });
  it('missing required infra caps grade even when a policy fires', () => {
    expect(gradeCoverage(u, () => 'block', () => false).grade).toBe(0);
  });
  it('hasFiringPolicy is true even when infra is missing (grade 0)', () => {
    const r = gradeCoverage(u, () => 'block', () => false);
    expect(r.grade).toBe(0);
    expect(r.hasFiringPolicy).toBe(true);
  });
});

// Evidence-first guard (v4.63.0): on the enforcement dimension, a declared-only
// decision earns half the grade of an evidence-graded one; the 4th param is
// optional so every pre-existing call above (3 args) is unaffected.
describe('coverage grading — evidence-first guard (spec §6)', () => {
  const enforcementUnit = unit({ dimension: 'enforcement' });
  const spendUnit = unit({ dimension: 'spend' });

  it('declared-only halves an enforcement-dimension grade', () => {
    const r = gradeCoverage(enforcementUnit, () => 'block', () => true, () => 'declared');
    expect(r.grade).toBe(0.5);
  });

  it('evidence-graded keeps full strength', () => {
    const r = gradeCoverage(enforcementUnit, () => 'block', () => true, () => 'evidence');
    expect(r.grade).toBe(1);
  });

  it('no signal (null) — e.g. no recent decision carries intent_source — keeps full strength', () => {
    const r = gradeCoverage(enforcementUnit, () => 'block', () => true, () => null);
    expect(r.grade).toBe(1);
  });

  it('omitting the callback entirely preserves pre-existing (3-arg) behavior', () => {
    const r = gradeCoverage(enforcementUnit, () => 'block', () => true);
    expect(r.grade).toBe(1);
  });

  it('a declared-only warn grade (0.5) halves to 0.25 — not clamped back to the old literal union', () => {
    const r = gradeCoverage(enforcementUnit, () => 'warn', () => true, () => 'declared');
    expect(r.grade).toBe(0.25);
  });

  it('the discount only applies to the enforcement dimension', () => {
    const r = gradeCoverage(spendUnit, () => 'block', () => true, () => 'declared');
    expect(r.grade).toBe(1);
  });

  it('a zero grade (no firing policy) stays zero regardless of intent source', () => {
    const r = gradeCoverage(enforcementUnit, () => 'allow', () => true, () => 'declared');
    expect(r.grade).toBe(0);
  });
});

describe('score aggregation', () => {
  const units: GovernableUnit[] = [
    unit({ key: 'a', riskLevel: 'critical', dimension: 'enforcement' }),
    unit({ key: 'b', riskLevel: 'low', dimension: 'spend', observedCount: 1 }),
  ];
  it('is risk-weighted: covering the critical unit scores far above covering the low one', () => {
    const coverCritical = computeScore(units, { a: 1, b: 0 }, noAdj).score;
    const coverLow = computeScore(units, { a: 0, b: 1 }, noAdj).score;
    expect(coverCritical).toBeGreaterThan(coverLow);
  });
  it('emits a 0-100 score and per-dimension breakdown', () => {
    const r = computeScore(units, { a: 1, b: 1 }, noAdj);
    expect(r.score).toBe(100);
    expect(r.dimensions.map((d) => d.dimension)).toEqual(
      expect.arrayContaining(['enforcement', 'spend']),
    );
  });
  it('clamps over-credit: a grade above 1 cannot exceed full coverage', () => {
    expect(computeScore(units, { a: 5, b: 5 }, noAdj).score).toBe(100);
  });
  it('is deterministic', () => {
    expect(computeScore(units, { a: 0.5, b: 1 }, noAdj)).toEqual(computeScore(units, { a: 0.5, b: 1 }, noAdj));
  });
  it('empty unit set → 100/healthy (nothing to govern)', () => {
    const r = computeScore([], {}, noAdj);
    expect(r.score).toBe(100);
    expect(r.status).toBe('healthy');
  });
  it('approval follow-through reduces only the approval dimension (spec §4.3)', () => {
    const appUnit = unit({ key: 'ap', dimension: 'approval', riskLevel: 'high' });
    const adj: Adjustments = { incidents: [], approvalFollowThrough: 0.5, coachOpenGapUnitKeys: [] };
    const r = computeScore([appUnit], { ap: 1 }, adj);
    const approval = r.dimensions.find((d) => d.dimension === 'approval')!;
    expect(approval.score).toBe(50);
    expect(r.score).toBe(50);
  });
});

describe('anti-gaming properties (spec §4.4)', () => {
  const crit = unit({ key: 'x', riskLevel: 'critical', dimension: 'enforcement', observedCount: 50 });
  it('toothless allow policy → 0 gain', () => {
    const grade = gradeCoverage(crit, () => 'allow', () => true).grade;
    expect(computeScore([crit], { x: grade }, noAdj).score).toBe(0);
  });
  it('low-traffic gaming is negligible vs the real risk mass', () => {
    const real = unit({ key: 'r', riskLevel: 'critical', observedCount: 500, dimension: 'enforcement' });
    const decoy = unit({ key: 'd', riskLevel: 'low', observedCount: 0, dimension: 'enforcement' });
    const gamed = computeScore([real, decoy], { r: 0, d: 1 }, noAdj).score;
    expect(gamed).toBeLessThan(15);
  });
  it('cannot sit high while leaking: an ungoverned high-risk incident caps the score ≤ 60', () => {
    const adj: Adjustments = {
      incidents: [{ unitKey: 'x', actionId: 'act_1', riskLevel: 'high', ts: 't' }],
      approvalFollowThrough: 1, coachOpenGapUnitKeys: [],
    };
    const r = computeScore([crit], { x: 1 }, adj);
    expect(r.cappedBy).toBe('incident');
    expect(r.score).toBeLessThanOrEqual(60);
  });
  it('a Policy Coach open gap caps that unit at partial coverage', () => {
    const adj: Adjustments = { incidents: [], approvalFollowThrough: 1, coachOpenGapUnitKeys: ['x'] };
    expect(computeScore([crit], { x: 1 }, adj).score).toBeLessThanOrEqual(50);
  });
});
