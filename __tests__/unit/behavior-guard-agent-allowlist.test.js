import { describe, it, expect } from 'vitest';
import { evaluatePolicy } from '@/lib/guard.js';
import { validatePolicy } from '@/lib/validate.js';

// agent_allowlist is a pure action-type match policy — no DB access — so
// evaluatePolicy can be exercised directly with a null sql client. It mirrors
// decideSample (behavior/policy-model) so simulation and enforcement agree.
describe('guard agent_allowlist policy', () => {
  const policy = { policy_type: 'agent_allowlist' };

  it('warns (default) when the action type is outside the allowlist', async () => {
    const rules = { allowed_action_types: ['review', 'read'] };
    const res = await evaluatePolicy(policy, rules, { action_type: 'deploy' }, null, 'org_1');
    expect(res).toBeTruthy();
    expect(res.action).toBe('warn');
    expect(res.reason).toMatch(/allowlist/);
  });

  it('honors a custom action (require_approval) on a novel action type', async () => {
    const rules = { allowed_action_types: ['review'], action: 'require_approval' };
    const res = await evaluatePolicy(policy, rules, { action_type: 'delete' }, null, 'org_1');
    expect(res.action).toBe('require_approval');
  });

  it('returns null when the action type is inside the allowlist', async () => {
    const rules = { allowed_action_types: ['review', 'read'] };
    const res = await evaluatePolicy(policy, rules, { action_type: 'review' }, null, 'org_1');
    expect(res).toBe(null);
  });

  it('returns null when the action type is unknown (never flags)', async () => {
    const rules = { allowed_action_types: ['review'] };
    const res = await evaluatePolicy(policy, rules, {}, null, 'org_1');
    expect(res).toBe(null);
  });

  it('returns null when the allowlist is empty', async () => {
    const res = await evaluatePolicy(policy, { allowed_action_types: [] }, { action_type: 'deploy' }, null, 'org_1');
    expect(res).toBe(null);
  });
});

describe('validate agent_allowlist policy', () => {
  it('accepts a well-formed agent_allowlist policy', () => {
    const r = validatePolicy({
      name: 'envelope', policy_type: 'agent_allowlist',
      rules: JSON.stringify({ allowed_action_types: ['review', 'read'], action: 'warn' }),
    });
    expect(r.valid).toBe(true);
  });

  it('rejects an agent_allowlist policy with no allowed action types', () => {
    const r = validatePolicy({
      name: 'bad', policy_type: 'agent_allowlist', rules: JSON.stringify({ allowed_action_types: [] }),
    });
    expect(r.valid).toBe(false);
    expect(r.errors.join(' ')).toMatch(/allowed_action_types/);
  });

  it('rejects action: allow (silent no-op) on an agent_allowlist policy', () => {
    const r = validatePolicy({
      name: 'bad', policy_type: 'agent_allowlist',
      rules: JSON.stringify({ allowed_action_types: ['review'], action: 'allow' }),
    });
    expect(r.valid).toBe(false);
  });
});
