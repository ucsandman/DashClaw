// __tests__/unit/policy-shapes.test.ts
import { describe, expect, it } from 'vitest';
import {
  normalizeTarget,
  shapeKey,
  grantMatches,
  extractDecisionShape,
  prefixMatches,
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
  // Step 1: .hostname drops the port; a host grant should match any port on that host.
  it('drops port from URL — uses hostname not host', () => {
    expect(normalizeTarget('https://api.stripe.com:8443/path')).toBe('api.stripe.com');
  });
  // Malformed URL fallback — must not throw.
  it('falls back to the raw string for a malformed URL without throwing', () => {
    expect(() => normalizeTarget('http://')).not.toThrow();
    // The try/catch returns the raw trimmed string when URL() fails.
    expect(normalizeTarget('http://')).toBe('http://');
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

describe('prefixMatches', () => {
  // Empty prefix/candidate — fail closed.
  it('returns false for empty prefix', () => {
    expect(prefixMatches('', 'api.stripe.com')).toBe(false);
  });
  it('returns false for empty candidate', () => {
    expect(prefixMatches('api.stripe.com', '')).toBe(false);
  });

  // Exact match.
  it('returns true on exact match', () => {
    expect(prefixMatches('api.stripe.com', 'api.stripe.com')).toBe(true);
  });

  // Host semantics — subdomain suffix.
  it('stripe.com matches api.stripe.com as a subdomain', () => {
    expect(prefixMatches('stripe.com', 'api.stripe.com')).toBe(true);
  });
  it('stripe.com does NOT match evilstripe.com', () => {
    expect(prefixMatches('stripe.com', 'evilstripe.com')).toBe(false);
  });

  // Path semantics — slash boundary.
  it('sdk/lib/ matches sdk/lib/deep/file.ts', () => {
    expect(prefixMatches('sdk/lib/', 'sdk/lib/deep/file.ts')).toBe(true);
  });
  it('sdk/lib (no trailing slash) matches sdk/lib/deep/file.ts at slash boundary', () => {
    expect(prefixMatches('sdk/lib', 'sdk/lib/deep/file.ts')).toBe(true);
  });
  it('sdk/lib does NOT match sdk/libsecret/x', () => {
    expect(prefixMatches('sdk/lib', 'sdk/libsecret/x')).toBe(false);
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
  it('matches when normalized target equals target_prefix exactly', () => {
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

  // --- Regression tests: boundary-aware matching ---

  // Host suffix bypass (CVE-class: api.stripe.com.evil.io)
  it('host grant api.stripe.com does NOT match api.stripe.com.evil.io', () => {
    expect(grantMatches(
      { action_type: 'api', target_prefix: 'api.stripe.com' },
      { ...ctx(), target: 'https://api.stripe.com.evil.io/x' },
    )).toBe(false);
  });

  // Port normalization: hostname drops port so grant works across ports.
  it('host grant api.stripe.com DOES match https://api.stripe.com:8443/x (port dropped)', () => {
    expect(grantMatches(
      { action_type: 'api', target_prefix: 'api.stripe.com' },
      { ...ctx(), target: 'https://api.stripe.com:8443/x' },
    )).toBe(true);
  });

  // Userinfo trick: https://api.stripe.com@evil.io/x — hostname is evil.io.
  it('host grant api.stripe.com does NOT match userinfo trick https://api.stripe.com@evil.io/x', () => {
    expect(grantMatches(
      { action_type: 'api', target_prefix: 'api.stripe.com' },
      { ...ctx(), target: 'https://api.stripe.com@evil.io/x' },
    )).toBe(false);
  });

  // Subdomain suffix: grant stripe.com covers api.stripe.com.
  it('host grant stripe.com DOES match https://api.stripe.com/x', () => {
    expect(grantMatches(
      { action_type: 'api', target_prefix: 'stripe.com' },
      { ...ctx(), target: 'https://api.stripe.com/x' },
    )).toBe(true);
  });

  // Path: sdk/lib must NOT match sdk/libsecret/x.
  it('path grant sdk/lib does NOT match write_paths ["sdk/libsecret/x"]', () => {
    expect(grantMatches(
      { action_type: 'write', target_prefix: 'sdk/lib' },
      { action_type: 'write', write_paths: ['sdk/libsecret/x'] },
    )).toBe(false);
  });

  // Path with trailing slash: sdk/lib/ DOES match sdk/lib/deep/file.ts.
  it('path grant sdk/lib/ DOES match write_paths ["sdk/lib/deep/file.ts"]', () => {
    expect(grantMatches(
      { action_type: 'write', target_prefix: 'sdk/lib/' },
      { action_type: 'write', write_paths: ['sdk/lib/deep/file.ts'] },
    )).toBe(true);
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
  // Context with valid JSON but no target key → target_prefix null.
  it('valid-JSON context lacking a target key → target_prefix null', () => {
    const s = extractDecisionShape({
      action_type: 'write',
      context: JSON.stringify({ write_paths: ['sdk/lib/index.ts'] }),
    });
    expect(s.target_prefix).toBeNull();
  });
});
