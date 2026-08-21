import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as jsYaml from 'js-yaml';
import { evaluatePolicy } from '@/lib/guard.js';
import { inferPolicyType, PACK_PREVIEWS } from '@/lib/policyPackPreviews.js';

describe('claude-code-starter pack', () => {
  let pack;

  beforeAll(() => {
    const packPath = join(process.cwd(), 'app', 'lib', 'guardrails', 'packs', 'claude-code-starter', 'policies.yml');
    pack = jsYaml.load(readFileSync(packPath, 'utf-8'));
  });

  it('is registered in PACK_PREVIEWS', () => {
    expect(PACK_PREVIEWS['claude-code-starter']).toBeDefined();
    expect(PACK_PREVIEWS['claude-code-starter'].name).toBe('Claude Code Starter');
  });

  it('declares exactly four policies', () => {
    expect(pack.policies).toHaveLength(4);
  });

  it('every policy declares an explicit policy_type (no inference ambiguity)', () => {
    for (const p of pack.policies) {
      expect(p.policy_type).toBeTruthy();
      expect(inferPolicyType(p)).toBe(p.policy_type);
    }
  });

  it('hold_mass_destructive fires at risk score 100', async () => {
    const policy = pack.policies.find((p) => p.id === 'hold_mass_destructive');
    const result = await evaluatePolicy(
      { policy_type: policy.policy_type },
      policy.rules,
      { action_type: 'security', declared_goal: 'Bash: rm -rf ~', evidence_flags: ['destructive', 'protected_target'] },
      null,
      'org_test',
      100,
    );
    expect(result).toEqual({ action: 'require_approval', reason: expect.stringContaining('100 >= threshold 100') });
  });

  it('hold_mass_destructive allows normal file edits', async () => {
    const policy = pack.policies.find((p) => p.id === 'hold_mass_destructive');
    const result = await evaluatePolicy(
      { policy_type: policy.policy_type },
      policy.rules,
      { action_type: 'apply', declared_goal: 'Write: src/app.js' },
      null,
      'org_test',
      60,
    );
    expect(result).toBeNull();
  });

  it('require_approval_network_calls gates api action_type', async () => {
    const policy = pack.policies.find((p) => p.id === 'require_approval_network_calls');
    const result = await evaluatePolicy(
      { policy_type: policy.policy_type },
      policy.rules,
      { action_type: 'api', declared_goal: 'Bash: curl https://example.com' },
      null,
      'org_test',
      35,
    );
    expect(result).toEqual({ action: 'require_approval', reason: expect.stringContaining('api') });
  });

  it('require_approval_network_calls ignores non-api actions', async () => {
    const policy = pack.policies.find((p) => p.id === 'require_approval_network_calls');
    const result = await evaluatePolicy(
      { policy_type: policy.policy_type },
      policy.rules,
      { action_type: 'apply', declared_goal: 'Edit: README.md' },
      null,
      'org_test',
      60,
    );
    expect(result).toBeNull();
  });

  it('require_approval_package_installs gates build action_type', async () => {
    const policy = pack.policies.find((p) => p.id === 'require_approval_package_installs');
    const result = await evaluatePolicy(
      { policy_type: policy.policy_type },
      policy.rules,
      { action_type: 'build', declared_goal: 'Bash: npm install express' },
      null,
      'org_test',
      25,
    );
    expect(result).toEqual({ action: 'require_approval', reason: expect.stringContaining('build') });
  });

  it('require_approval_package_installs ignores test runs', async () => {
    const policy = pack.policies.find((p) => p.id === 'require_approval_package_installs');
    const result = await evaluatePolicy(
      { policy_type: policy.policy_type },
      policy.rules,
      { action_type: 'test', declared_goal: 'Bash: npm test' },
      null,
      'org_test',
      15,
    );
    expect(result).toBeNull();
  });
});
