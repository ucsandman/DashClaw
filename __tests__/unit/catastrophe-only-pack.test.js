import { describe, it, expect, beforeAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as jsYaml from 'js-yaml';
import { createSqlMock } from '../helpers.js';

// evaluateGuard (the whole-pack test at the bottom) reads settings and can
// deliver webhooks; same mocks the characterization suite uses.
vi.mock('@/lib/webhooks.js', () => ({ deliverGuardWebhook: vi.fn() }));
vi.mock('@/lib/llm.js', () => ({ checkSemanticGuardrail: vi.fn() }));
vi.mock('@/lib/repositories/settings.repository.js', () => ({ getSettings: vi.fn(async () => []) }));

import { evaluatePolicy, evaluateGuard } from '@/lib/guard.js';
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

  it('declares exactly five policies', () => {
    expect(pack.policies).toHaveLength(5);
  });

  // Real money is on the Short List (2026-09-04): keyed on the classifier's
  // `spend` flag, held not blocked, and ungrantable so no standing grant can
  // ever cover a purchase.
  it('holds real-money spend on the spend evidence flag, ungrantable', () => {
    const line = pack.policies.find((p) => p.id === 'hold_real_money_spend');
    expect(line).toBeDefined();
    expect(line.policy_type).toBe('risk_threshold');
    expect(line.rules.action).toBe('require_approval');
    expect(line.rules.ungrantable).toBe(true);
    expect(line.rules.only_evidence_flags).toEqual(['spend']);
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

  it('hold_mass_destructive fires at risk score 100 on protected_target evidence', async () => {
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

  // 2026-08-21: the score saturates at 100 for `cat .env.example` and friends;
  // the line keys on the catastrophic flag, so score-100 without it passes.
  it('hold_mass_destructive stays silent at risk 100 without protected_target', async () => {
    const policy = pack.policies.find((p) => p.id === 'hold_mass_destructive');
    expect(policy.rules.only_evidence_flags).toEqual(['protected_target']);
    const result = await evaluatePolicy(
      { policy_type: policy.policy_type },
      policy.rules,
      { action_type: 'security', declared_goal: 'Bash: cat -n site/.env.example', evidence_flags: ['secret_exposure'] },
      null,
      'org_test',
      100,
    );
    expect(result).toBeNull();
  });

  it('hold_mass_destructive allows normal file edits (risk well below 100)', async () => {
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

  // The risk-100 line EXCLUDES force-pushes so line 3 owns their approval
  // card (one reason on the card, not two).
  it('hold_mass_destructive excludes force-pushes so the force-push line owns them', async () => {
    const policy = pack.policies.find((p) => p.id === 'hold_mass_destructive');
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
    for (const id of ['hold_mass_destructive', 'hold_force_push_protected']) {
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

  // All four lines at once through the REAL engine, so the severity merge
  // is exercised rather than assumed.
  describe('all four lines seeded, through evaluateGuard', () => {
    let orgCounter = 0;
    const decide = (declaredGoal) => {
      const rows = pack.policies.map((p, i) => ({
        id: `gp_pack_${i}`,
        name: p.description,
        policy_type: p.policy_type,
        rules: JSON.stringify(p.rules),
      }));
      // The real hook shape: declared_goal "Bash: <cmd>" plus the act itself,
      // so the evidence classifier grades the command (the mass-destructive
      // line keys on its protected_target flag, not on the declared score).
      return evaluateGuard(
        `org_pack_${++orgCounter}`,
        {
          action_type: 'security', agent_id: 'a1', risk_score: 100, declared_goal: declaredGoal,
          act: { kind: 'shell', command: declaredGoal.replace(/^Bash: /, '') },
        },
        createSqlMock({ taggedResponses: [rows] }),
      );
    };

    it('a force-push over main HOLDS (the risk-100 line excluded it)', async () => {
      const result = await decide('Bash: git push --force origin main');
      expect(result.decision).toBe('require_approval');
    });

    it('a force-push over a feature branch is neither blocked nor held', async () => {
      const result = await decide('Bash: git push --force origin feature/x');
      expect(['block', 'require_approval']).not.toContain(result.decision);
    });

    // Nothing in the pack refuses outright: the human decides, never the
    // runtime (2026-08-21 — a Vercel deploy at score 100 was being refused).
    it('rm -rf HOLDS for approval, never blocks', async () => {
      const result = await decide('Bash: rm -rf /');
      expect(result.decision).toBe('require_approval');
    });

    // The whole point of the flag gate: a score-100 act that is NOT the
    // catastrophic class runs (and is logged) instead of paging the human.
    it('cat .env.example at declared risk 100 is neither blocked nor held', async () => {
      const result = await decide('Bash: cat -n site/.env.example');
      expect(['block', 'require_approval']).not.toContain(result.decision);
    });

    it('a force-push smuggled into an rm chain still HOLDS', async () => {
      const result = await decide('Bash: rm -rf / && git push --force origin main');
      expect(result.decision).toBe('require_approval');
    });

    it('no line in the pack carries action: block', () => {
      for (const p of pack.policies) expect(p.rules.action).not.toBe('block');
    });
  });
});
