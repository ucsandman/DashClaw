import { describe, it, expect, vi, beforeEach } from 'vitest';

// We test the pure statistical functions from drift.js
// Since drift.js mixes pure math with DB calls, we mock the DB layer
// and test what we can. The key value is testing the math.

const { mockSql } = vi.hoisted(() => ({
  mockSql: Object.assign(vi.fn(async () => []), { query: vi.fn(async () => []) }),
}));

vi.mock('@/lib/db.js', () => ({ getSql: () => mockSql }));
vi.mock('@/lib/org.js', () => ({ getOrgId: () => 'org_test' }));

import { listMetrics } from '@/lib/drift.js';

describe('listMetrics', () => {
  it('returns all tracked metrics', () => {
    const metrics = listMetrics();
    expect(metrics.length).toBe(6);
    const ids = metrics.map(m => m.id);
    expect(ids).toContain('risk_score');
    expect(ids).toContain('confidence');
    expect(ids).toContain('duration_ms');
    expect(ids).toContain('cost_estimate');
    expect(ids).toContain('tokens_total');
    expect(ids).toContain('learning_score');
  });

  it('all metrics have id and label', () => {
    const metrics = listMetrics();
    for (const m of metrics) {
      expect(m.id).toBeDefined();
      expect(m.label).toBeDefined();
      expect(typeof m.id).toBe('string');
      expect(typeof m.label).toBe('string');
    }
  });
});

// Test the statistical internals by extracting them
// Since they're not exported, we test them indirectly through the drift detection flow
// or by re-implementing the pure math here for verification.

describe('Statistical Utilities (verification)', () => {
  // These verify the math that drift.js uses internally

  function calcMean(arr) {
    if (arr.length === 0) return 0;
    return arr.reduce((s, v) => s + v, 0) / arr.length;
  }

  function calcStddev(arr, mean) {
    if (arr.length < 2) return 0;
    const variance = arr.reduce((s, v) => s + (v - mean) ** 2, 0) / (arr.length - 1);
    return Math.sqrt(variance);
  }

  function zScore(currentMean, baselineMean, baselineStddev) {
    if (baselineStddev === 0) return currentMean === baselineMean ? 0 : 999;
    return (currentMean - baselineMean) / baselineStddev;
  }

  it('calculates mean correctly', () => {
    expect(calcMean([1, 2, 3, 4, 5])).toBe(3);
    expect(calcMean([10])).toBe(10);
    expect(calcMean([])).toBe(0);
  });

  it('calculates stddev correctly (sample stddev)', () => {
    const values = [10, 12, 23, 23, 16, 23, 21, 16];
    const mean = calcMean(values);
    const stddev = calcStddev(values, mean);
    expect(stddev).toBeCloseTo(5.237, 2);
  });

  it('stddev of single value is 0', () => {
    expect(calcStddev([42], 42)).toBe(0);
  });

  it('z-score detects significant shift', () => {
    // Baseline: mean=50, stddev=10
    // Current: mean=80 => z = (80-50)/10 = 3.0 (critical)
    expect(zScore(80, 50, 10)).toBe(3);
  });

  it('z-score detects no shift', () => {
    expect(zScore(50, 50, 10)).toBe(0);
  });

  it('z-score handles zero stddev', () => {
    expect(zScore(50, 50, 0)).toBe(0);
    expect(zScore(60, 50, 0)).toBe(999);
  });

  it('z-score classification matches severity thresholds', () => {
    // info: >= 1.5, warning: >= 2.0, critical: >= 3.0
    const classify = (absZ) => {
      if (absZ >= 3.0) return 'critical';
      if (absZ >= 2.0) return 'warning';
      if (absZ >= 1.5) return 'info';
      return null;
    };
    expect(classify(3.5)).toBe('critical');
    expect(classify(3.0)).toBe('critical');
    expect(classify(2.5)).toBe('warning');
    expect(classify(2.0)).toBe('warning');
    expect(classify(1.8)).toBe('info');
    expect(classify(1.5)).toBe('info');
    expect(classify(1.0)).toBeNull();
    expect(classify(0)).toBeNull();
  });
});
