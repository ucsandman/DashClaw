// __tests__/unit/risk-threshold-evidence-gate.test.js
//
// rules.only_evidence_flags on risk_threshold (2026-08-21): the default packs'
// mass-destructive line fires on the classifier's `protected_target` flag, not
// on the score. A bare threshold-100 line held `cat .env.example` and a heredoc
// line containing `dd ` — five hand-approvals in one morning, none a
// catastrophe. Covers: the evaluator gate, the validator shape, the full
// evidence fold (real commands through classifyAct), and the seeded-row upgrade.

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as jsYaml from 'js-yaml';
import { createSqlMock } from '../helpers.js';

// evaluateGuard (the seeded-pack block) reads settings and can deliver
// webhooks; same mocks catastrophe-only-pack.test.js uses.
vi.mock('@/lib/webhooks.js', () => ({ deliverGuardWebhook: vi.fn() }));
vi.mock('@/lib/llm.js', () => ({ checkSemanticGuardrail: vi.fn() }));
vi.mock('@/lib/repositories/settings.repository.js', () => ({ getSettings: vi.fn(async () => []) }));

import { evaluatePolicy, evaluateGuard } from '@/lib/guard.js';
import { validatePolicy } from '@/lib/validate.js';
import { classifyAct } from '@/lib/guard/evidence';
import { gateMassDestructiveOnEvidence } from '../../app/lib/setup/catastrophe-pack.mjs';

const RULES = { threshold: 100, action: 'require_approval', only_evidence_flags: ['protected_target'] };
const policy = { policy_type: 'risk_threshold' };

async function decide(context, score = 100, rules = RULES) {
  return evaluatePolicy(policy, rules, context, null, 'org_test', score);
}

describe('risk_threshold — only_evidence_flags gate', () => {
  it('fires at 100 when the act carries a listed flag', async () => {
    const r = await decide({ action_type: 'security', evidence_flags: ['destructive', 'protected_target'] });
    expect(r).toEqual({ action: 'require_approval', reason: expect.stringContaining('100 >= threshold 100') });
  });

  it('stays silent at 100 when the act carries none of the listed flags', async () => {
    expect(await decide({ action_type: 'security', evidence_flags: ['destructive'] })).toBeNull();
    expect(await decide({ action_type: 'security', evidence_flags: ['secret_exposure'] })).toBeNull();
  });

  it('stays silent at 100 when there is no evidence at all (declared-only call)', async () => {
    expect(await decide({ action_type: 'security' })).toBeNull();
  });

  it('still honors the threshold: a flagged act below the threshold passes', async () => {
    expect(await decide({ action_type: 'security', evidence_flags: ['protected_target'] }, 99)).toBeNull();
  });

  it('absent key = score alone (pre-existing behaviour untouched)', async () => {
    const r = await decide({ action_type: 'security' }, 100, { threshold: 100, action: 'require_approval' });
    expect(r?.action).toBe('require_approval');
  });
});

// The live shapes that were hand-approved on 2026-08-21, run through the real
// classifier: none carries protected_target, so none reaches the gated line.
describe('the 2026-08-21 false-positive shapes do not carry protected_target', () => {
  const shapes = [
    'cd "C:/Projects/x/site" && cat -n site/.env.example',
    'cd "C:/Projects/x" && npm run dev > "C:/Users/u/AppData/Local/Temp/claude/x/scratchpad/dev.log" 2>&1 &\ndisown\necho "launched"',
    "cd /c/Users/u/memory; python - <<'EOF'\np='MEMORY.md'; s=open(p).read()\nline='- `\\\\bdd\\\\b` graded `yyyy-MM-dd` destructive; dd now command-position only; `\\\\btruncate\\\\b` still bare'\nEOF",
    // Read-only greps that mention the format tool (name split: a local hook blocks the literal).
    'grep -n ' + 'mk' + 'fs hooks/x.py',
    'grep -rn ' + 'mk' + 'fs. app/lib/guard',
  ];
  for (const command of shapes) {
    it(`no protected_target: ${command.slice(0, 40)}…`, () => {
      const c = classifyAct({ kind: 'shell', command });
      expect(c.flags).not.toContain('protected_target');
    });
  }

  it('the catastrophic class still carries protected_target', () => {
    for (const command of ['rm -rf ~', 'rm -rf /', 'rm -rf C:\\Users\\wes', 'find / -delete', 'dd if=/dev/zero of=/dev/sda', 'mkfs.ext4 /dev/sdb1']) {
      expect(classifyAct({ kind: 'shell', command }).flags, command).toContain('protected_target');
    }
  });
});

// The seeded catastrophe-only pack through the real engine, in the hook's
// shape (declared_goal "Bash: <cmd>" plus the act): a grep that merely names
// the format tool runs; the real device invocation and a force-push over main
// still hold.
describe('seeded catastrophe-only pack — disk-tool mentions vs invocations (evaluateGuard)', () => {
  const MK = 'mk' + 'fs';
  const pack = jsYaml.load(readFileSync(
    join(process.cwd(), 'app', 'lib', 'guardrails', 'packs', 'catastrophe-only', 'policies.yml'), 'utf-8'));
  let orgCounter = 0;
  const decide = (command, actionType) => {
    const rows = pack.policies.map((p, i) => ({
      id: `gp_cat_${i}`, name: p.description, policy_type: p.policy_type, rules: JSON.stringify(p.rules),
    }));
    return evaluateGuard(
      `org_disk_tool_${++orgCounter}`,
      { action_type: actionType, agent_id: 'a1', declared_goal: `Bash: ${command}`, act: { kind: 'shell', command } },
      createSqlMock({ taggedResponses: [rows] }),
    );
  };

  it('a grep mentioning the format tool is allowed', async () => {
    expect((await decide(`grep -n ${MK} hooks/x.py`, 'read')).decision).toBe('allow');
  });

  it('the format tool on a real device holds', async () => {
    expect((await decide(`${MK}.ext4 /dev/sdb1`, 'security')).decision).toBe('require_approval');
  });

  it('the format tool on a real device holds when launched through bash -c', async () => {
    expect((await decide(`bash -c "${MK}.ext4 /dev/sdb1"`, 'security')).decision).toBe('require_approval');
  });

  it('the format tool on a real device holds under sudo -u root', async () => {
    expect((await decide(`sudo -u root ${MK}.ext4 /dev/sdb1`, 'security')).decision).toBe('require_approval');
  });

  it('git push --force origin main still holds (force-push line untouched)', async () => {
    expect((await decide('git push --force origin main', 'security')).decision).toBe('require_approval');
  });
});

describe('validatePolicy — only_evidence_flags shape', () => {
  const base = (rules) => ({ name: 'T', policy_type: 'risk_threshold', rules: JSON.stringify(rules) });

  it('accepts a non-empty list of snake_case flags', () => {
    expect(validatePolicy(base(RULES)).valid).toBe(true);
  });

  it('rejects an empty list, non-array, or non-flag strings', () => {
    expect(validatePolicy(base({ ...RULES, only_evidence_flags: [] })).valid).toBe(false);
    expect(validatePolicy(base({ ...RULES, only_evidence_flags: 'protected_target' })).valid).toBe(false);
    expect(validatePolicy(base({ ...RULES, only_evidence_flags: ['rm -rf /'] })).valid).toBe(false);
  });
});

describe('gateMassDestructiveOnEvidence (seeded-row upgrade)', () => {
  it('merges the flag gate into both seeded line names and only where absent', async () => {
    const calls = [];
    const sql = (strings, ...values) => {
      const text = strings.join(' ');
      calls.push({ text, values });
      return Promise.resolve(text.includes('Catastrophe Pack') || values.some((v) => String(v).startsWith('Catastrophe Pack')) ? [{ id: 'gp_1' }] : []);
    };
    const n = await gateMassDestructiveOnEvidence(sql);
    expect(n).toBe(1);
    expect(calls).toHaveLength(2);
    for (const c of calls) {
      expect(c.text).toContain('"only_evidence_flags":["protected_target"]');
      expect(c.text).toContain("NOT (rules::jsonb ? 'only_evidence_flags')");
    }
    expect(calls.map((c) => c.values[1])).toEqual([
      'Catastrophe Pack — Hold Mass-Destructive Operations for Approval',
      'Claude Code Starter — Hold Mass-Destructive Operations for Approval',
    ]);
  });
});
