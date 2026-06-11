// __tests__/unit/policy-shapes.test.ts
import { describe, expect, it } from 'vitest';
import {
  normalizeTarget,
  shapeKey,
  grantMatches,
  extractDecisionShape,
} from '@/lib/policy-shapes';

describe('normalizeTarget', () => {
  it('reduces a URL to its host', () => {
    expect(normalizeTarget('https://api.stripe.com/v1/charges')).toBe('api.stripe.com');
  });
  it('keeps a path as-is (trimmed)', () => {
    expect(normalizeTarget(' sdk/index.ts ')).toBe('sdk/index.ts');
  });
  it('returns null for empty input', () => {
    expect(normalizeTarget('')).toBeNull();
    expect(normalizeTarget(undefined)).toBeNull();
  });
});

describe('shapeKey', () => {
  it('combines action_type and target prefix', () => {
    expect(shapeKey('api', 'api.stripe.com')).toBe('api::api.stripe.com');
  });
  it('handles null target', () => {
    expect(shapeKey('sync', null)).toBe('sync::');
  });
});

describe('grantMatches', () => {
  const ctx = (over: Record<string, unknown> = {}) => ({
    action_type: 'api',
    target: 'https://api.stripe.com/v1/charges',
    ...over,
  });
  it('matches on action_type alone when no target_prefix', () => {
    expect(grantMatches({ action_type: 'api' }, ctx())).toBe(true);
  });
  it('does not match a different action_type', () => {
    expect(grantMatches({ action_type: 'sync' }, ctx())).toBe(false);
  });
  it('matches when normalized target starts with target_prefix', () => {
    expect(grantMatches({ action_type: 'api', target_prefix: 'api.stripe.com' }, ctx())).toBe(true);
  });
  it('does not match a different host', () => {
    expect(grantMatches({ action_type: 'api', target_prefix: 'github.com' }, ctx())).toBe(false);
  });
  it('matches write_paths candidates by prefix', () => {
    expect(grantMatches(
      { action_type: 'write', target_prefix: 'sdk/' },
      { action_type: 'write', write_paths: ['sdk/index.ts'] },
    )).toBe(true);
  });
  it('does not match when context has no target candidates but grant has a prefix', () => {
    expect(grantMatches({ action_type: 'api', target_prefix: 'api.stripe.com' }, { action_type: 'api' })).toBe(false);
  });
});

describe('extractDecisionShape', () => {
  it('extracts shape from a guard_decisions row with URL target in context', () => {
    const s = extractDecisionShape({
      action_type: 'api',
      context: JSON.stringify({ target: 'https://api.stripe.com/v1/charges' }),
    });
    expect(s).toEqual({
      action_type: 'api',
      target_prefix: 'api.stripe.com',
      key: 'api::api.stripe.com',
      label: 'api → api.stripe.com',
    });
  });
  it('groups path targets by first two segments', () => {
    const s = extractDecisionShape({
      action_type: 'write',
      context: JSON.stringify({ target: 'sdk/lib/deep/file.ts' }),
    });
    expect(s.target_prefix).toBe('sdk/lib/');
    expect(s.key).toBe('write::sdk/lib/');
  });
  it('handles missing/invalid context', () => {
    const s = extractDecisionShape({ action_type: 'sync', context: 'not json' });
    expect(s).toEqual({ action_type: 'sync', target_prefix: null, key: 'sync::', label: 'sync' });
  });
});
