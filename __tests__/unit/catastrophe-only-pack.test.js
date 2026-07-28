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

  it('declares exactly three policies', () => {
    expect(pack.policies).toHaveLength(3);
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

  it('rate_limit_runaway_safety declares a warn-only rate-limit rule shape', () => {
    const policy = pack.policies.find((p) => p.id === 'rate_limit_runaway_safety');
    expect(policy.policy_type).toBe('rate_limit');
    expect(policy.rules.max_actions).toBe(200);
    expect(policy.rules.window_minutes).toBe(10);
    expect(policy.rules.action).toBe('warn');
  });
});
