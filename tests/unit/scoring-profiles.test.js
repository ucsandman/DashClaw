import { describe, it, expect } from 'vitest';
import {
  extractRawValue,
  scoreDimensionValue,
  computeComposite,
  evaluateCondition,
} from '@/lib/scoringProfiles';

// -- extractRawValue ---------------------------------------------------

describe('extractRawValue', () => {
  const baseDim = (source, config = {}) => ({ data_source: source, data_config: config });

  it('extracts duration_ms from top-level field', () => {
    const action = { duration_ms: 4500 };
    expect(extractRawValue(action, baseDim('duration_ms'))).toBe(4500);
  });

  it('falls back to metadata for duration_ms', () => {
    const action = { metadata: { duration_ms: 3200 } };
    expect(extractRawValue(action, baseDim('duration_ms'))).toBe(3200);
  });

  it('extracts cost_estimate', () => {
    const action = { cost_estimate: 0.042 };
    expect(extractRawValue(action, baseDim('cost_estimate'))).toBe(0.042);
  });

  it('computes tokens_total from prompt + completion', () => {
    const action = { prompt_tokens: 500, completion_tokens: 200 };
    expect(extractRawValue(action, baseDim('tokens_total'))).toBe(700);
  });

  it('extracts risk_score', () => {
    const action = { risk_score: 65 };
    expect(extractRawValue(action, baseDim('risk_score'))).toBe(65);
  });

  it('extracts confidence', () => {
    const action = { confidence: 0.92 };
    expect(extractRawValue(action, baseDim('confidence'))).toBe(0.92);
  });

  it('extracts nested metadata_field via dot path', () => {
    const action = { metadata: { result: { latency: 120 } } };
    expect(extractRawValue(action, baseDim('metadata_field', { field: 'result.latency' }))).toBe(120);
  });

  it('returns null for missing metadata_field', () => {
    const action = { metadata: {} };
    expect(extractRawValue(action, baseDim('metadata_field', { field: 'nonexistent.path' }))).toBeNull();
  });

  it('returns null for metadata_field with no field config', () => {
    const action = { metadata: { foo: 'bar' } };
    expect(extractRawValue(action, baseDim('metadata_field', {}))).toBeNull();
  });

  it('executes custom_function', () => {
    const action = { metadata: { errors: 3, warnings: 5 } };
    const dim = baseDim('custom_function', {
      function_body: 'return (action.metadata.errors || 0) + (action.metadata.warnings || 0);',
    });
    expect(extractRawValue(action, dim)).toBe(8);
  });

  it('returns null for broken custom_function', () => {
    const action = {};
    const dim = baseDim('custom_function', { function_body: 'throw new Error("boom");' });
    expect(extractRawValue(action, dim)).toBeNull();
  });

  it('returns null for unknown data_source', () => {
    const action = { something: 123 };
    expect(extractRawValue(action, baseDim('unknown_source'))).toBeNull();
  });
});

// -- scoreDimensionValue -----------------------------------------------

describe('scoreDimensionValue', () => {
  const durationScale = [
    { label: 'excellent', operator: 'lt', value: 30000, score: 100 },
    { label: 'good', operator: 'lt', value: 60000, score: 75 },
    { label: 'acceptable', operator: 'lt', value: 120000, score: 50 },
    { label: 'poor', operator: 'gte', value: 120000, score: 20 },
  ];

  it('matches first rule (excellent)', () => {
    const result = scoreDimensionValue(15000, durationScale);
    expect(result.score).toBe(100);
    expect(result.label).toBe('excellent');
  });

  it('matches second rule (good)', () => {
    const result = scoreDimensionValue(45000, durationScale);
    expect(result.score).toBe(75);
    expect(result.label).toBe('good');
  });

  it('matches third rule (acceptable)', () => {
    const result = scoreDimensionValue(90000, durationScale);
    expect(result.score).toBe(50);
    expect(result.label).toBe('acceptable');
  });

  it('matches last rule (poor)', () => {
    const result = scoreDimensionValue(200000, durationScale);
    expect(result.score).toBe(20);
    expect(result.label).toBe('poor');
  });

  it('returns no_data for null input', () => {
    const result = scoreDimensionValue(null, durationScale);
    expect(result.score).toBeNull();
    expect(result.label).toBe('no_data');
  });

  it('returns unscaled for empty scale array', () => {
    const result = scoreDimensionValue(50, []);
    expect(result.score).toBe(50);
    expect(result.label).toBe('unscaled');
  });

  it('handles eq operator', () => {
    const scale = [{ label: 'exact', operator: 'eq', value: 'success', score: 100 }];
    expect(scoreDimensionValue('success', scale).score).toBe(100);
  });

  it('handles between operator', () => {
    const scale = [{ label: 'in_range', operator: 'between', value: [10, 50], score: 80 }];
    expect(scoreDimensionValue(30, scale).score).toBe(80);
    expect(scoreDimensionValue(5, scale).label).toBe('default');
  });

  it('handles contains operator', () => {
    const scale = [{ label: 'has_error', operator: 'contains', value: 'error', score: 10 }];
    expect(scoreDimensionValue('Fatal error occurred', scale).score).toBe(10);
    expect(scoreDimensionValue('All good', scale).label).toBe('default');
  });

  it('falls back to lowest score when no rules match', () => {
    const scale = [
      { label: 'only_low', operator: 'lt', value: 5, score: 90 },
      { label: 'only_mid', operator: 'lt', value: 10, score: 60 },
    ];
    // Value 100 matches neither rule
    const result = scoreDimensionValue(100, scale);
    expect(result.score).toBe(60); // min of [90, 60]
    expect(result.label).toBe('default');
  });
});

// -- computeComposite --------------------------------------------------

describe('computeComposite', () => {
  const dims = [
    { score: 100, weight: 0.3 },
    { score: 75, weight: 0.4 },
    { score: 50, weight: 0.3 },
  ];

  it('computes weighted_average correctly', () => {
    // (100*0.3 + 75*0.4 + 50*0.3) / 1.0 = 30 + 30 + 15 = 75
    expect(computeComposite(dims, 'weighted_average')).toBe(75);
  });

  it('computes minimum correctly', () => {
    expect(computeComposite(dims, 'minimum')).toBe(50);
  });

  it('computes geometric_mean correctly', () => {
    // 100^(0.3) * 75^(0.4) * 50^(0.3) -- roughly 73.15
    const result = computeComposite(dims, 'geometric_mean');
    expect(result).toBeGreaterThan(70);
    expect(result).toBeLessThan(76);
  });

  it('returns null for empty scored array', () => {
    expect(computeComposite([], 'weighted_average')).toBeNull();
  });

  it('skips null scores in weighted_average', () => {
    const mixed = [
      { score: 80, weight: 0.5 },
      { score: null, weight: 0.3 },
      { score: 60, weight: 0.2 },
    ];
    // Only scored: 80 (w=0.5) + 60 (w=0.2), total weight = 0.7
    // (80*0.5/0.7) + (60*0.2/0.7) = 57.14 + 17.14 = 74.29
    const result = computeComposite(mixed, 'weighted_average');
    expect(result).toBeGreaterThan(74);
    expect(result).toBeLessThan(75);
  });

  it('returns 0 for geometric_mean when any score is 0', () => {
    const withZero = [
      { score: 100, weight: 0.5 },
      { score: 0, weight: 0.5 },
    ];
    expect(computeComposite(withZero, 'geometric_mean')).toBe(0);
  });
});

// -- evaluateCondition -------------------------------------------------

describe('evaluateCondition', () => {
  const action = {
    action_type: 'deploy',
    risk_score: 45,
    metadata: {
      environment: 'production',
      modifies_data: true,
      irreversible: false,
      region: 'us-east-1',
      tags: 'critical,urgent',
    },
  };

  it('evaluates == with string value', () => {
    expect(evaluateCondition("metadata.environment == 'production'", action)).toBe(true);
    expect(evaluateCondition("metadata.environment == 'staging'", action)).toBe(false);
  });

  it('evaluates == with boolean', () => {
    expect(evaluateCondition("metadata.modifies_data == true", action)).toBe(true);
    expect(evaluateCondition("metadata.irreversible == true", action)).toBe(false);
  });

  it('evaluates != operator', () => {
    expect(evaluateCondition("action_type != 'query'", action)).toBe(true);
    expect(evaluateCondition("action_type != 'deploy'", action)).toBe(false);
  });

  it('evaluates > and >= operators', () => {
    expect(evaluateCondition("risk_score > 40", action)).toBe(true);
    expect(evaluateCondition("risk_score > 50", action)).toBe(false);
    expect(evaluateCondition("risk_score >= 45", action)).toBe(true);
  });

  it('evaluates < and <= operators', () => {
    expect(evaluateCondition("risk_score < 50", action)).toBe(true);
    expect(evaluateCondition("risk_score < 40", action)).toBe(false);
    expect(evaluateCondition("risk_score <= 45", action)).toBe(true);
  });

  it('evaluates contains operator', () => {
    expect(evaluateCondition("metadata.tags contains critical", action)).toBe(true);
    expect(evaluateCondition("metadata.tags contains debug", action)).toBe(false);
  });

  it('returns false for null/empty condition', () => {
    expect(evaluateCondition(null, action)).toBe(false);
    expect(evaluateCondition('', action)).toBe(false);
  });

  it('returns false for malformed condition', () => {
    expect(evaluateCondition('this is not a condition', action)).toBe(false);
  });

  it('handles nested field paths', () => {
    const nested = { metadata: { deploy: { target: 'k8s' } } };
    expect(evaluateCondition("metadata.deploy.target == 'k8s'", nested)).toBe(true);
  });

  it('handles missing field gracefully', () => {
    expect(evaluateCondition("metadata.nonexistent == 'value'", action)).toBe(false);
  });
});
