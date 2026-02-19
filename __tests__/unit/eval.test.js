import { describe, it, expect, vi, beforeEach } from 'vitest';

// ----- Mock crypto for deterministic IDs -----
vi.mock('crypto', () => ({ randomBytes: vi.fn(() => ({ toString: () => 'abcdef123456abcdef123456' })) }));

const { mockSql, mockIsLLMAvailable } = vi.hoisted(() => ({
  mockSql: Object.assign(vi.fn(async () => []), { query: vi.fn(async () => []) }),
  mockIsLLMAvailable: vi.fn(() => false),
}));

vi.mock('@/lib/db.js', () => ({ getSql: () => mockSql }));
vi.mock('@/lib/org.js', () => ({ getOrgId: () => 'org_test' }));
vi.mock('@/lib/llm.js', () => ({
  isLLMAvailable: mockIsLLMAvailable,
  tryLLMComplete: vi.fn(),
}));

import {
  executeScorer,
} from '@/lib/eval.js';

describe('executeScorer  regex', () => {
  const scorer = { scorer_type: 'regex', config: { pattern: 'hello\\s+world', flags: 'i' } };

  it('scores 1 on match', () => {
    const result = executeScorer(scorer, { outcome: 'Hello   World' });
    expect(result.score).toBe(1);
    expect(result.label).toBe('match');
  });

  it('scores 0 on no match', () => {
    const result = executeScorer(scorer, { outcome: 'goodbye' });
    expect(result.score).toBe(0);
    expect(result.label).toBe('no_match');
  });

  it('handles empty input', () => {
    const result = executeScorer(scorer, { outcome: '' });
    expect(result.score).toBe(0);
  });
});

describe('executeScorer  contains', () => {
  it('scores 1 when all keywords present (any mode, default)', () => {
    const scorer = { scorer_type: 'contains', config: { keywords: ['hello', 'world'] } };
    const result = executeScorer(scorer, { outcome: 'Hello World Test' });
    expect(result.score).toBe(1);
    expect(result.label).toBe('contains');
  });

  it('scores 1 when any keyword present (any mode)', () => {
    const scorer = { scorer_type: 'contains', config: { keywords: ['hello', 'missing'], mode: 'any' } };
    const result = executeScorer(scorer, { outcome: 'hello there' });
    expect(result.score).toBe(1);
    expect(result.label).toBe('contains');
  });

  it('scores 0 when all keywords required but one missing', () => {
    const scorer = { scorer_type: 'contains', config: { keywords: ['hello', 'missing'], mode: 'all' } };
    const result = executeScorer(scorer, { outcome: 'hello there' });
    expect(result.score).toBe(0);
    expect(result.label).toBe('missing');
  });

  it('handles empty keywords array', () => {
    const scorer = { scorer_type: 'contains', config: { keywords: [] } };
    const result = executeScorer(scorer, { outcome: 'anything' });
    expect(result.score).toBe(0); // passed is false because matches.length (0) is not > 0
  });
});

describe('executeScorer  numeric_range', () => {
  it('scores 1 when value in range', () => {
    const scorer = { scorer_type: 'numeric_range', config: { field: 'confidence', min: 70, max: 100 } };
    const result = executeScorer(scorer, { confidence: 85 });
    expect(result.score).toBe(1);
    expect(result.label).toBe('in_range');
  });

  it('scores 0 when value below range', () => {
    const scorer = { scorer_type: 'numeric_range', config: { field: 'confidence', min: 70, max: 100 } };
    const result = executeScorer(scorer, { confidence: 50 });
    expect(result.score).toBe(0);
    expect(result.label).toBe('out_of_range');
  });

  it('scores 0 when value above range', () => {
    const scorer = { scorer_type: 'numeric_range', config: { field: 'confidence', min: 0, max: 50 } };
    const result = executeScorer(scorer, { confidence: 80 });
    expect(result.score).toBe(0);
  });

  it('handles missing field gracefully', () => {
    const scorer = { scorer_type: 'numeric_range', config: { field: 'missing', min: 0, max: 100 } };
    const result = executeScorer(scorer, {});
    expect(result.label).toBe('no_data');
  });

  it('includes boundary values', () => {
    const scorer = { scorer_type: 'numeric_range', config: { field: 'val', min: 10, max: 20 } };
    expect(executeScorer(scorer, { val: 10 }).score).toBe(1);
    expect(executeScorer(scorer, { val: 20 }).score).toBe(1);
  });
});

describe('executeScorer  custom_function', () => {
  it('executes custom expression and returns score', () => {
    const scorer = {
      scorer_type: 'custom_function',
      config: { expression: 'outcome.length > 5 ? 1 : 0' },
    };
    expect(executeScorer(scorer, { outcome: 'long enough' }).score).toBe(1);
    expect(executeScorer(scorer, { outcome: 'short' }).score).toBe(0);
  });

  it('handles function errors gracefully', () => {
    const scorer = {
      scorer_type: 'custom_function',
      config: { expression: 'undefined_var.length' },
    };
    const result = executeScorer(scorer, { outcome: 'test' });
    expect(result.score).toBe(null);
    expect(result.error).toBeDefined();
  });
});

describe('executeScorer  llm_judge', () => {
  it('returns error when LLM not available', async () => {
    const scorer = { scorer_type: 'llm_judge', config: { prompt_template: 'Rate this' } };
    // LLM judge is async
    const result = await executeScorer(scorer, { outcome: 'test output' });
    expect(result.error).toContain('AI provider not configured');
  });
});

describe('executeScorer  unknown type', () => {
  it('returns score null with error for unknown scorer type', () => {
    const scorer = { scorer_type: 'nonexistent', config: {} };
    const result = executeScorer(scorer, { outcome: 'test' });
    expect(result.score).toBe(null);
    expect(result.error).toBeDefined();
  });
});
