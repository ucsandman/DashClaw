import { describe, it, expect } from 'vitest';
import { findInertPolicies } from '@/lib/inert-policies';
import { grantExpiresAt, grantIsExpired, GRANT_DEFAULT_TTL_DAYS } from '@/lib/policy-shapes';

// F1 (governance gap audit 2026-08-05): an operator's require_approval rule
// that a blanket grant silently downgrades still reads as active everywhere.
// findInertPolicies is what makes that suppression visible on /policies.

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString();

const policy = (over: Record<string, unknown>) => ({
  id: 'gp_x', name: 'P', policy_type: 'require_approval', rules: '{}', active: 1,
  created_at: new Date().toISOString(), ...over,
}) as Parameters<typeof findInertPolicies>[0][number];

describe('grant TTL helpers', () => {
  it('prefers an explicit rules.expires_at', () => {
    const exp = grantExpiresAt({ expires_at: '2026-09-01T00:00:00.000Z' }, daysAgo(500));
    expect(exp?.toISOString()).toBe('2026-09-01T00:00:00.000Z');
  });

  it('falls back to created_at + the default TTL', () => {
    const created = new Date('2026-01-01T00:00:00.000Z');
    const exp = grantExpiresAt({}, created.toISOString());
    expect(exp?.getTime()).toBe(created.getTime() + GRANT_DEFAULT_TTL_DAYS * DAY);
  });

  it('never expires when neither is known (synthetic rows)', () => {
    expect(grantExpiresAt({})).toBeNull();
    expect(grantIsExpired({})).toBe(false);
  });

  it('reports expiry correctly on both paths', () => {
    expect(grantIsExpired({ expires_at: daysAgo(1) })).toBe(true);
    expect(grantIsExpired({}, daysAgo(GRANT_DEFAULT_TTL_DAYS + 1))).toBe(true);
    expect(grantIsExpired({}, daysAgo(1))).toBe(false);
  });
});

describe('findInertPolicies', () => {
  it('flags a require_approval rule nullified by a blanket grant, naming the grant', () => {
    const inert = findInertPolicies([
      policy({ id: 'gp_gate', name: 'Require approval: social posts', rules: JSON.stringify({ action_types: ['post', 'social_post'] }) }),
      policy({ id: 'gp_grant', name: '[Grant] post', policy_type: 'allow_grant', rules: JSON.stringify({ action_type: 'post' }) }),
    ]);
    expect(inert).toHaveLength(1);
    expect(inert[0]!.id).toBe('gp_gate');
    expect(inert[0]!.action_types).toEqual(['post']);
    expect(inert[0]!.suppressed_by[0]!.name).toBe('[Grant] post');
    expect(inert[0]!.suppressed_by[0]!.target_prefix).toBeNull();
  });

  it('reports a scoped grant as the suppressor with its prefix', () => {
    const inert = findInertPolicies([
      policy({ id: 'gp_gate', rules: JSON.stringify({ action_types: ['api'] }) }),
      policy({ id: 'gp_grant', name: '[Grant] api → api.x.com', policy_type: 'allow_grant', rules: JSON.stringify({ action_type: 'api', target_prefix: 'api.x.com' }) }),
    ]);
    expect(inert[0]!.suppressed_by[0]!.target_prefix).toBe('api.x.com');
  });

  it('an EXPIRED grant suppresses nothing', () => {
    const inert = findInertPolicies([
      policy({ id: 'gp_gate', rules: JSON.stringify({ action_types: ['api'] }) }),
      policy({ id: 'gp_grant', policy_type: 'allow_grant', rules: JSON.stringify({ action_type: 'api', expires_at: daysAgo(1) }) }),
    ]);
    expect(inert).toEqual([]);
  });

  it('an inactive grant suppresses nothing', () => {
    const inert = findInertPolicies([
      policy({ id: 'gp_gate', rules: JSON.stringify({ action_types: ['api'] }) }),
      policy({ id: 'gp_grant', policy_type: 'allow_grant', active: 0, rules: JSON.stringify({ action_type: 'api' }) }),
    ]);
    expect(inert).toEqual([]);
  });

  it('an ungrantable rule is immune and never listed', () => {
    const inert = findInertPolicies([
      policy({ id: 'gp_gate', rules: JSON.stringify({ action_types: ['api'], ungrantable: true }) }),
      policy({ id: 'gp_grant', policy_type: 'allow_grant', rules: JSON.stringify({ action_type: 'api' }) }),
    ]);
    expect(inert).toEqual([]);
  });

  it('block policies are never inert — grants cannot clear a block', () => {
    const inert = findInertPolicies([
      policy({ id: 'gp_block', policy_type: 'block_action_type', rules: JSON.stringify({ action_types: ['api'] }) }),
      policy({ id: 'gp_grant', policy_type: 'allow_grant', rules: JSON.stringify({ action_type: 'api' }) }),
    ]);
    expect(inert).toEqual([]);
  });

  it('returns nothing when the org has no grants at all', () => {
    const inert = findInertPolicies([
      policy({ id: 'gp_gate', rules: JSON.stringify({ action_types: ['api'] }) }),
    ]);
    expect(inert).toEqual([]);
  });
});
