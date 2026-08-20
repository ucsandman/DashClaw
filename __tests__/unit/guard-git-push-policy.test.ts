import { describe, it, expect } from 'vitest';
import { evaluatePolicy } from '@/lib/guard.js';
import { validatePolicy } from '@/lib/validate.js';
import type { PolicyRules, GuardEvalContext, GuardSql } from '@/lib/guard/types';

// No policy in this file touches SQL (no webhook_check / rate_limit).
const NO_SQL = null as unknown as GuardSql;

// The `git_push` predicate on hold/block rules and `except_git_push` on
// risk_threshold. Together they make a force-push over a protected branch a
// HOLD: the risk-100 BLOCK line carves force-pushes out (block always wins the
// severity merge, so a hold could never out-vote it) and a require_approval
// line owns them instead.

const run = (policyType: string, rules: PolicyRules, context: GuardEvalContext, risk: number) =>
  evaluatePolicy({ id: 'gp_t', name: 'T', policy_type: policyType, rules: JSON.stringify(rules) }, rules, context, NO_SQL, 'org_test', risk);

describe('require_approval with rules.git_push', () => {
  const rules = { action: 'require_approval', git_push: { force: true, branches: ['main'] } };

  it('holds a force-push over main (no action_types needed)', async () => {
    const result = await run('require_approval', rules, { action_type: 'other', declared_goal: 'Bash: git push --force origin main' }, 100);
    expect(result).toEqual({ action: 'require_approval', reason: 'Force-push over protected branch "main" requires approval' });
  });

  it('ignores a force-push over a feature branch', async () => {
    const result = await run('require_approval', rules, { action_type: 'other', declared_goal: 'Bash: git push --force origin feature/x' }, 100);
    expect(result).toBeNull();
  });

  it('reads the command off act.command when the act is attached', async () => {
    const result = await run('require_approval', rules, { action_type: 'other', act: { command: 'git push -f origin main' } }, 50);
    expect(result).toMatchObject({ action: 'require_approval' });
  });

  it('still requires the action_type to match when action_types is also present', async () => {
    const scoped = { ...rules, action_types: ['deploy'] };
    expect(await run('require_approval', scoped, { action_type: 'other', declared_goal: 'Bash: git push --force origin main' }, 100)).toBeNull();
    expect(await run('require_approval', scoped, { action_type: 'deploy', declared_goal: 'Bash: git push --force origin main' }, 100))
      .toEqual({ action: 'require_approval', reason: 'Action type "deploy" requires approval' });
  });
});

describe('risk_threshold with rules.except_git_push', () => {
  const rules = { threshold: 100, action: 'block', except_git_push: { force: true } };

  it('excludes force-pushes from the block line', async () => {
    const result = await run('risk_threshold', rules, { action_type: 'security', declared_goal: 'Bash: git push --force origin main' }, 100);
    expect(result).toBeNull();
  });

  it('still blocks everything else at the threshold', async () => {
    const result = await run('risk_threshold', rules, { action_type: 'security', declared_goal: 'Bash: rm -rf /' }, 100);
    expect(result).toEqual({ action: 'block', reason: expect.stringContaining('100 >= threshold 100') });
  });
});

describe('validatePolicy — git_push / except_git_push shapes', () => {
  const base = (policy_type: string, rules: unknown) => ({ name: 'T', policy_type, rules: JSON.stringify(rules) });

  it('accepts require_approval with git_push and no action_types', () => {
    const r = validatePolicy(base('require_approval', { action: 'require_approval', git_push: { force: true, branches: ['main', 'release/*'] } }));
    expect(r.valid).toBe(true);
  });

  it('still requires action_types when git_push is absent', () => {
    expect(validatePolicy(base('require_approval', {})).valid).toBe(false);
  });

  it('rejects a malformed git_push predicate', () => {
    expect(validatePolicy(base('require_approval', { git_push: 'main' })).valid).toBe(false);
    expect(validatePolicy(base('require_approval', { git_push: { force: 'yes' } })).valid).toBe(false);
    expect(validatePolicy(base('require_approval', { git_push: { branches: [''] } })).valid).toBe(false);
    expect(validatePolicy(base('require_approval', { git_push: { branches: Array.from({ length: 33 }, (_, i) => `b${i}`) } })).valid).toBe(false);
  });

  it('validates except_git_push on risk_threshold', () => {
    expect(validatePolicy(base('risk_threshold', { threshold: 100, action: 'block', except_git_push: { force: true } })).valid).toBe(true);
    expect(validatePolicy(base('risk_threshold', { threshold: 100, action: 'block', except_git_push: [] })).valid).toBe(false);
  });
});
