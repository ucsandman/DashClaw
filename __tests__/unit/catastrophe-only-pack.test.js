import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as jsYaml from 'js-yaml';
import { evaluatePolicy } from '@/lib/guard.js';
import { inferPolicyType, PACK_PREVIEWS } from '@/lib/policyPackPreviews.js';

describe('catastrophe-only pack', () => {
  let pack;

  beforeAll(() => {
    const packPath = join(process.cwd(), 'app', 'lib', 'guardrails', 'packs', 'catastrophe-only', 'policies.yml');
    pack = jsYaml.load(readFileSync(packPath, 'utf-8'));
  });

  it('is registered in PACK_PREVIEWS', () => {
    expect(PACK_PREVIEWS['catastrophe-only']).toBeDefined();
    expect(PACK_PREVIEWS['catastrophe-only'].name).toBe('Catastrophe Only');
  });

  it('declares exactly four policies', () => {
    expect(pack.policies).toHaveLength(4);
  });

  // The Short List: the pack IS the list of things that stop the agent, so
  // every line carries the flag the /policies surface reads.
  it('every policy is flagged short_list', () => {
    for (const p of pack.policies) {
      expect(p.rules.short_list).toBe(true);
    }
  });

  it('every policy declares an explicit policy_type (no inference ambiguity)', () => {
    for (const p of pack.policies) {
      expect(p.policy_type).toBeTruthy();
      expect(inferPolicyType(p)).toBe(p.policy_type);
    }
  });

  it('block_mass_destructive fires at risk score 100', async () => {
    const policy = pack.policies.find((p) => p.id === 'block_mass_destructive');
    const result = await evaluatePolicy(
      { policy_type: policy.policy_type },
      policy.rules,
      { action_type: 'security', declared_goal: 'Bash: rm -rf /tmp/build' },
      null,
      'org_test',
      100,
    );
    expect(result).toEqual({ action: 'block', reason: expect.stringContaining('100 >= threshold 100') });
  });

  it('block_mass_destructive allows normal file edits (risk well below 100)', async () => {
    const policy = pack.policies.find((p) => p.id === 'block_mass_destructive');
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

  it('hold_secret_file_writes holds a Windows-absolute .env write (drive-prefix normalization)', async () => {
    const policy = pack.policies.find((p) => p.id === 'hold_secret_file_writes');
    const result = await evaluatePolicy(
      { policy_type: policy.policy_type },
      policy.rules,
      { action_type: 'security', declared_goal: 'Write: .env', target: 'C:\\Users\\x\\proj\\.env' },
      null,
      'org_test',
      50,
    );
    expect(result).toEqual({ action: 'require_approval', reason: expect.stringContaining('Protected path touched') });
  });

  it('hold_secret_file_writes holds the liveness-probe witness shape (/tmp/elp-run/.env)', async () => {
    const policy = pack.policies.find((p) => p.id === 'hold_secret_file_writes');
    const result = await evaluatePolicy(
      { policy_type: policy.policy_type },
      policy.rules,
      { action_type: 'security', declared_goal: 'Write: .env', target: '/tmp/elp-run/.env' },
      null,
      'org_test',
      50,
    );
    expect(result).toEqual({ action: 'require_approval', reason: expect.stringContaining('Protected path touched') });
  });

  it('hold_secret_file_writes ignores a normal source write', async () => {
    const policy = pack.policies.find((p) => p.id === 'hold_secret_file_writes');
    const result = await evaluatePolicy(
      { policy_type: policy.policy_type },
      policy.rules,
      { action_type: 'apply', declared_goal: 'Write: src/app.js', target: 'src/app.js' },
      null,
      'org_test',
      30,
    );
    expect(result).toBeNull();
  });

  it('hold_secret_file_writes does NOT hold .env.example (the fatigue exemption is pinned)', async () => {
    const policy = pack.policies.find((p) => p.id === 'hold_secret_file_writes');
    const result = await evaluatePolicy(
      { policy_type: policy.policy_type },
      policy.rules,
      { action_type: 'apply', declared_goal: 'Write: .env.example', target: '.env.example' },
      null,
      'org_test',
      30,
    );
    expect(result).toBeNull();
  });

  it('hold_secret_file_writes is ungrantable (an allow_grant can never clear it)', () => {
    const policy = pack.policies.find((p) => p.id === 'hold_secret_file_writes');
    expect(policy.rules.ungrantable).toBe(true);
  });

  // Force-push is a HOLD, not a dead run: `block` always wins the severity
  // merge, so the risk-100 block line EXCLUDES force-pushes and line 3 owns
  // them with an approval card.
  it('block_mass_destructive excludes force-pushes so the hold line can own them', async () => {
    const policy = pack.policies.find((p) => p.id === 'block_mass_destructive');
    const result = await evaluatePolicy(
      { policy_type: policy.policy_type },
      policy.rules,
      { action_type: 'security', declared_goal: 'Bash: git push --force origin main' },
      null,
      'org_test',
      100,
    );
    expect(result).toBeNull();
  });

  it('hold_force_push_protected holds a force-push over main at risk 100', async () => {
    const policy = pack.policies.find((p) => p.id === 'hold_force_push_protected');
    expect(policy.policy_type).toBe('require_approval');
    expect(policy.rules.ungrantable).toBeUndefined(); // grantable: a single-use grant is the right answer when the human meant it
    const result = await evaluatePolicy(
      { policy_type: policy.policy_type },
      policy.rules,
      { action_type: 'security', declared_goal: 'Bash: git push --force origin main' },
      null,
      'org_test',
      100,
    );
    expect(result).toMatchObject({ action: 'require_approval' });
  });

  it('a force-push over a feature branch is neither blocked nor held', async () => {
    const context = { action_type: 'security', declared_goal: 'Bash: git push --force origin feature/x' };
    for (const id of ['block_mass_destructive', 'hold_force_push_protected']) {
      const policy = pack.policies.find((p) => p.id === id);
      const result = await evaluatePolicy(
        { policy_type: policy.policy_type },
        policy.rules,
        context,
        null,
        'org_test',
        100,
      );
      expect(result).toBeNull();
    }
  });

  it('rate_limit_runaway_safety declares a warn-only rate-limit rule shape', () => {
    const policy = pack.policies.find((p) => p.id === 'rate_limit_runaway_safety');
    expect(policy.policy_type).toBe('rate_limit');
    expect(policy.rules.max_actions).toBe(200);
    expect(policy.rules.window_minutes).toBe(10);
    expect(policy.rules.action).toBe('warn');
  });
});
