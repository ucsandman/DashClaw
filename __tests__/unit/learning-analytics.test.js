import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSql } = vi.hoisted(() => ({
  mockSql: Object.assign(vi.fn(async () => []), { query: vi.fn(async () => []) }),
}));

vi.mock('@/lib/db.js', () => ({ getSql: () => mockSql }));
vi.mock('@/lib/org.js', () => ({ getOrgId: () => 'org_test' }));

import { getMaturityLevels } from '@/lib/learningAnalytics.js';

describe('getMaturityLevels', () => {
  it('returns 6 maturity levels in ascending order', () => {
    const levels = getMaturityLevels();
    expect(levels).toHaveLength(6);
    expect(levels[0].level).toBe('novice');
    expect(levels[5].level).toBe('master');
  });

  it('each level has increasing thresholds', () => {
    const levels = getMaturityLevels();
    for (let i = 1; i < levels.length; i++) {
      expect(levels[i].min_episodes).toBeGreaterThanOrEqual(levels[i - 1].min_episodes);
      expect(levels[i].min_success_rate).toBeGreaterThanOrEqual(levels[i - 1].min_success_rate);
      expect(levels[i].min_avg_score).toBeGreaterThanOrEqual(levels[i - 1].min_avg_score);
    }
  });

  it('novice has zero thresholds', () => {
    const levels = getMaturityLevels();
    const novice = levels[0];
    expect(novice.min_episodes).toBe(0);
    expect(novice.min_success_rate).toBe(0);
    expect(novice.min_avg_score).toBe(0);
  });

  it('master requires 1000+ episodes and 92%+ success', () => {
    const levels = getMaturityLevels();
    const master = levels.find(l => l.level === 'master');
    expect(master.min_episodes).toBe(1000);
    expect(master.min_success_rate).toBe(0.92);
    expect(master.min_avg_score).toBe(85);
  });
});

describe('Maturity Classification Logic (verification)', () => {
  // Replicating classifyMaturity logic for testing
  const MATURITY_LEVELS = [
    { level: 'novice', min_episodes: 0, min_success_rate: 0, min_avg_score: 0 },
    { level: 'developing', min_episodes: 10, min_success_rate: 0.4, min_avg_score: 40 },
    { level: 'competent', min_episodes: 50, min_success_rate: 0.6, min_avg_score: 55 },
    { level: 'proficient', min_episodes: 150, min_success_rate: 0.75, min_avg_score: 65 },
    { level: 'expert', min_episodes: 500, min_success_rate: 0.85, min_avg_score: 75 },
    { level: 'master', min_episodes: 1000, min_success_rate: 0.92, min_avg_score: 85 },
  ];

  function classifyMaturity(totalEpisodes, successRate, avgScore) {
    let best = MATURITY_LEVELS[0];
    for (const level of MATURITY_LEVELS) {
      if (totalEpisodes >= level.min_episodes && successRate >= level.min_success_rate && avgScore >= level.min_avg_score) {
        best = level;
      }
    }
    const episodeScore = Math.min(totalEpisodes / 1000, 1) * 30;
    const rateScore = successRate * 40;
    const qualityScore = (avgScore / 100) * 30;
    return { level: best.level, score: Math.round((episodeScore + rateScore + qualityScore) * 1000) / 1000 };
  }

  it('classifies brand new agent as novice', () => {
    const result = classifyMaturity(0, 0, 0);
    expect(result.level).toBe('novice');
    expect(result.score).toBe(0);
  });

  it('classifies developing agent', () => {
    const result = classifyMaturity(15, 0.5, 45);
    expect(result.level).toBe('developing');
  });

  it('classifies competent agent', () => {
    const result = classifyMaturity(60, 0.65, 60);
    expect(result.level).toBe('competent');
  });

  it('classifies proficient agent', () => {
    const result = classifyMaturity(200, 0.80, 70);
    expect(result.level).toBe('proficient');
  });

  it('classifies expert agent', () => {
    const result = classifyMaturity(600, 0.88, 78);
    expect(result.level).toBe('expert');
  });

  it('classifies master agent', () => {
    const result = classifyMaturity(1500, 0.95, 90);
    expect(result.level).toBe('master');
    expect(result.score).toBeGreaterThan(90);
  });

  it('requires ALL thresholds met (episodes high but score low = lower level)', () => {
    // 1000 episodes but only 30% success and 30 avg score => novice thresholds only
    const result = classifyMaturity(1000, 0.3, 30);
    expect(result.level).toBe('novice');
  });

  it('maturity score is weighted composite (30% episodes + 40% rate + 30% quality)', () => {
    // Perfect across all dimensions
    const result = classifyMaturity(1000, 1.0, 100);
    expect(result.score).toBe(100); // 30 + 40 + 30
  });

  it('maturity score caps episode contribution at 1000', () => {
    const r1 = classifyMaturity(1000, 0.5, 50);
    const r2 = classifyMaturity(5000, 0.5, 50);
    expect(r1.score).toBe(r2.score); // capped at same value
  });
});

describe('Linear Regression Slope (verification)', () => {
  function linearRegSlope(values) {
    const n = values.length;
    if (n < 2) return 0;
    const xMean = (n - 1) / 2;
    const yMean = values.reduce((s, v) => s + v, 0) / n;
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) {
      num += (i - xMean) * (values[i] - yMean);
      den += (i - xMean) ** 2;
    }
    return den === 0 ? 0 : num / den;
  }

  it('detects positive trend', () => {
    const slope = linearRegSlope([10, 20, 30, 40, 50]);
    expect(slope).toBe(10);
  });

  it('detects negative trend', () => {
    const slope = linearRegSlope([50, 40, 30, 20, 10]);
    expect(slope).toBe(-10);
  });

  it('detects flat trend', () => {
    const slope = linearRegSlope([50, 50, 50, 50, 50]);
    expect(slope).toBe(0);
  });

  it('handles single value', () => {
    expect(linearRegSlope([42])).toBe(0);
  });

  it('handles two values', () => {
    expect(linearRegSlope([0, 10])).toBe(10);
  });

  it('handles noisy but upward data', () => {
    const slope = linearRegSlope([10, 15, 12, 20, 18, 25, 22, 30]);
    expect(slope).toBeGreaterThan(0);
  });
});
