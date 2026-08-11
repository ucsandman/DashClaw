// __tests__/unit/policy-shapes.test.ts
import { describe, expect, it } from 'vitest';
import {
  normalizeTarget,
  shapeKey,
  grantMatches,
  extractDecisionShape,
  prefixMatches,
  precedentKey,
  precedentEligible,
  normalizeFlags,
  PRECEDENT_ELIGIBLE,
  NEVER_PRECEDENTED,
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

// Precedent grants: scope is an exact SERVER-computed evidence flag set, not an
// operator-supplied target prefix. These tests exist because this is the one
// mechanism in the system that turns repeated human approvals into a standing
// relaxation — the failure mode is a hole that widens itself.
describe('precedent grants', () => {
  const ELIGIBLE = ['destructive', 'regenerable_artifact'];
  const precedent = (flags: string[] = ELIGIBLE) => ({
    action_type: 'cleanup',
    precedent_flags: flags,
  });
  const call = (over: Record<string, unknown> = {}) => ({
    action_type: 'cleanup',
    evidence_flags: ELIGIBLE,
    ...over,
  });

  it('normalizeFlags sorts, dedupes and rejects malformed input', () => {
    expect(normalizeFlags(['b', 'a', 'b'])).toEqual(['a', 'b']);
    expect(normalizeFlags([])).toBeNull();
    expect(normalizeFlags('destructive')).toBeNull();
    expect(normalizeFlags(null)).toBeNull();
    expect(normalizeFlags([1, 2])).toBeNull();
  });

  it('precedentKey is order-independent', () => {
    expect(precedentKey('cleanup', ['regenerable_artifact', 'destructive']))
      .toBe(precedentKey('cleanup', ['destructive', 'regenerable_artifact']));
  });

  it('the shipped allowlist is exactly one entry (widening it is a reviewed act)', () => {
    expect([...PRECEDENT_ELIGIBLE]).toEqual(['cleanup|destructive,regenerable_artifact']);
  });

  it('matches when the act carries exactly the learned flag set', () => {
    expect(grantMatches(precedent(), call())).toBe(true);
  });

  it('a SUPERSET never matches — an extra property is a different kind of act', () => {
    expect(grantMatches(precedent(), call({
      evidence_flags: ['destructive', 'regenerable_artifact', 'protected_target'],
    }))).toBe(false);
  });

  it('a SUBSET never matches', () => {
    expect(grantMatches(precedent(), call({ evidence_flags: ['destructive'] }))).toBe(false);
  });

  it('fails closed when the call carries no server evidence flags', () => {
    expect(grantMatches(precedent(), call({ evidence_flags: undefined }))).toBe(false);
    expect(grantMatches(precedent(), call({ evidence_flags: [] }))).toBe(false);
  });

  it('fails closed on malformed precedent_flags', () => {
    expect(grantMatches({ action_type: 'cleanup', precedent_flags: 'destructive' }, call())).toBe(false);
    expect(grantMatches({ action_type: 'cleanup', precedent_flags: [] }, call())).toBe(false);
  });

  it('an off-allowlist action_type can never be precedented, however many flags line up', () => {
    expect(precedentEligible('security', ELIGIBLE)).toBe(false);
    expect(grantMatches(
      { action_type: 'security', precedent_flags: ELIGIBLE },
      call({ action_type: 'security' }),
    )).toBe(false);
  });

  it('a NEVER_PRECEDENTED flag disqualifies even a stored precedent (match-time recheck)', () => {
    for (const flag of NEVER_PRECEDENTED) {
      expect(precedentEligible('cleanup', ['destructive', flag])).toBe(false);
    }
    // package installs must never become one-click-forever (npm postinstall = RCE)
    expect(precedentEligible('build', ['package'])).toBe(false);
  });

  it('absent precedent_flags is a structural no-op — legacy grants are untouched', () => {
    expect(grantMatches(
      { action_type: 'apply', target_prefix: 'sdk/lib/' },
      { action_type: 'apply', target: 'sdk/lib/deep/file.ts' },
    )).toBe(true);
    expect(grantMatches({ action_type: 'apply' }, { action_type: 'apply' })).toBe(true);
  });

  it('a precedent ignores target_prefix entirely — flags are the whole scope', () => {
    expect(grantMatches(
      { action_type: 'cleanup', precedent_flags: ELIGIBLE, target_prefix: 'C:/Users/' },
      call({ target: 'C:/Users/sandm/Documents' }),
    )).toBe(true);
    expect(grantMatches(
      { action_type: 'cleanup', precedent_flags: ELIGIBLE, target_prefix: 'C:/Users/' },
      call({ evidence_flags: ['destructive'], target: 'C:/Users/sandm/Documents' }),
    )).toBe(false);
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
  // REVERSED 2026-08-11. This used to assert 'sdk/lib/' — deep filesystem
  // paths collapsed to their first two segments. That collapse was a live
  // security hole, not a grouping nicety: /api/policies/review/verdict takes
  // the GROUP's target_prefix straight into the allow_grant it creates, so a
  // coarse group label became the grant's authorization scope. On
  // my-dashclaw.vercel.app that produced `security -> C:/Users/`
  // (gp_02ad86b4b16645fb94e4667d) from one approval, downgrading the risk-100
  // require_approval rail to allow for anything under the whole user profile.
  // A path shape now keeps its exact target: the group you click covers only
  // what you actually saw. Host shapes still collapse (see the test below).
  it('keeps deep filesystem path targets exact (a group label is an authorization scope)', () => {
    const s = extractDecisionShape({
      action_type: 'write',
      context: JSON.stringify({ target: 'sdk/lib/deep/file.ts' }),
    });
    expect(s.target_prefix).toBe('sdk/lib/deep/file.ts');
    expect(s.key).toBe('write::sdk/lib/deep/file.ts');
  });

  it('never collapses a Windows drive path to the user tree (live repro)', () => {
    const s = extractDecisionShape({
      action_type: 'security',
      context: JSON.stringify({ target: 'C:/Users/sandm/Documents/notes.md' }),
    });
    expect(s.target_prefix).toBe('C:/Users/sandm/Documents/notes.md');
  });

  it('never collapses an absolute posix path', () => {
    const s = extractDecisionShape({
      action_type: 'security',
      context: JSON.stringify({ target: '/home/wes/.ssh/id_rsa' }),
    });
    expect(s.target_prefix).toBe('/home/wes/.ssh/id_rsa');
  });

  it('still groups deep HOST paths by host/first-segment (unchanged)', () => {
    const s = extractDecisionShape({
      action_type: 'api',
      context: JSON.stringify({ target: 'github.com/ucsandman/DashClaw/pulls/1' }),
    });
    expect(s.target_prefix).toBe('github.com/ucsandman/');
  });

  it('does not treat a dot-prefixed build dir as a host', () => {
    const s = extractDecisionShape({
      action_type: 'cleanup',
      context: JSON.stringify({ target: '.next/cache/webpack/client' }),
    });
    expect(s.target_prefix).toBe('.next/cache/webpack/client');
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
