// Interruption budget + command shape + tuning/loosening ownership seam.
// Origin: the 2026-08-16 incident — 1,759 require_approval decisions in seven
// days, ~zero resolved, zero proposals from any engine, operator disabled every
// policy in the org. Spec: docs/superpowers/specs/2026-08-16-interruption-budget-design.md
import { describe, expect, it } from 'vitest';
import { commandShapeKey } from '@/lib/policy-shapes';
import {
  BUDGET_RULE,
  INTERRUPTION_BUDGET_DEFAULTS,
  budgetProposalId,
  deriveBudgetProposals,
  tuningCanMove,
  type InterruptVolumeRow,
  type LooseningPolicyRow,
} from '@/lib/posture/loosening';

describe('commandShapeKey', () => {
  // Every string here is a real declared_goal from the incident ledger.
  const cases: Array<[string, string | null]> = [
    ['PowerShell: git -C "C:/Projects/sentinel-api" log --format="%h %ad" --date=format:"%m-%d" -4', 'git log'],
    ["Bash: git -C \"C:/Projects/accesspatch\" log --reverse --format='%ad %s' | head -4", 'git log'],
    ["Bash: git -C \"C:/Projects/audit\" log --since=24.hours --format='%ad %s' | head -20", 'git log'],
    ['Bash: cd "C:/Projects/CB Orange" && cat .env.example', 'cat'],
    ['Bash: npm run format', 'npm run'],
    ['Bash: rtk proxy npx biome check . 2>&1 | tail -3', 'biome check'],
    ['MCP: mcp__offlocal__dashclaw_recent_decisions', 'mcp:mcp__offlocal__dashclaw_recent_decisions'],
    ['Edit: C:\\Projects\\DashClaw\\middleware.js', 'edit'],
    ['Write: C:\\Users\\sandm\\scratch\\x.ps1', 'write'],
  ];

  for (const [goal, want] of cases) {
    it(`${JSON.stringify(goal).slice(0, 58)} -> ${want}`, () => {
      expect(commandShapeKey(goal)).toBe(want);
    });
  }

  it('collapses the same verb across different repos and flags to ONE key', () => {
    const keys = new Set(
      cases.filter(([, w]) => w === 'git log').map(([g]) => commandShapeKey(g)),
    );
    expect(keys.size).toBe(1);
  });

  it('returns null (never budget) when nothing usable can be read', () => {
    expect(commandShapeKey('')).toBeNull();
    expect(commandShapeKey('   ')).toBeNull();
    expect(commandShapeKey(null)).toBeNull();
    expect(commandShapeKey(undefined)).toBeNull();
    expect(commandShapeKey(42)).toBeNull();
    // Only a quoted path — no bare command word to key on.
    expect(commandShapeKey('Bash: "C:/weird/path.exe"')).toBeNull();
  });

  it('does not let a varying flag value split the key', () => {
    const a = commandShapeKey("Bash: git log --since='2026-08-14 00:00'");
    const b = commandShapeKey('Bash: git log --since=24.hours --oneline');
    expect(a).toBe('git log');
    expect(b).toBe(a);
  });
});

describe('tuningCanMove — the seam that stranded the incident policy', () => {
  it('is FALSE for a risk_threshold policy at the cap: tuning has no move', () => {
    // The exact org policy: {"threshold":100,"action":"require_approval"}.
    // next = min(100 + 10, 95) = 95, and 95 > 100 is false, so tuning never
    // proposes. Loosening must therefore NOT defer to it.
    expect(tuningCanMove('risk_threshold', { threshold: 100 })).toBe(false);
    expect(tuningCanMove('risk_threshold', { threshold: 95 })).toBe(false);
  });

  it('is TRUE below the cap, so loosening still defers where tuning works', () => {
    expect(tuningCanMove('risk_threshold', { threshold: 80 })).toBe(true);
    expect(tuningCanMove('risk_threshold', {})).toBe(true); // default 80
  });

  it('is FALSE for every non-risk_threshold type (loosening owns those)', () => {
    expect(tuningCanMove('require_approval', { threshold: 100 })).toBe(false);
    expect(tuningCanMove('protected_path', {})).toBe(false);
  });

  it('is FALSE for a non-numeric threshold rather than throwing', () => {
    expect(tuningCanMove('risk_threshold', { threshold: 'high' })).toBe(false);
  });
});

describe('deriveBudgetProposals', () => {
  const policy = (over: Partial<LooseningPolicyRow> = {}): LooseningPolicyRow => ({
    id: 'gp_1',
    name: 'Block mass-destructive commands (rm -rf class)',
    policy_type: 'risk_threshold',
    rules: JSON.stringify({ threshold: 100, action: 'require_approval' }),
    ...over,
  });
  const volume = (fired: number, id = 'gp_1'): InterruptVolumeRow => ({
    policy_id: id,
    fired,
    example_decision_ids: ['act_gd_a', 'act_gd_b'],
  });

  it('reports a policy past the budget WITHOUT any adjudication input', () => {
    // The whole point: no approved/denied counts exist in the input at all.
    const out = deriveBudgetProposals([volume(1759)], [policy()], { budget: 50 });
    expect(out).toHaveLength(1);
    expect(out[0]!.rule).toBe(BUDGET_RULE);
    expect(out[0]!.evidence.fired).toBe(1759);
    expect(out[0]!.evidence.over_by).toBe(35.2);
    expect(out[0]!.auto_demoted).toBe(true);
  });

  it('stays silent at or below the budget', () => {
    expect(deriveBudgetProposals([volume(50)], [policy()], { budget: 50 })).toHaveLength(0);
    expect(deriveBudgetProposals([volume(1)], [policy()], { budget: 50 })).toHaveLength(0);
  });

  it('marks an ungrantable policy as NOT auto-demoted and says so', () => {
    const p = policy({ rules: JSON.stringify({ threshold: 100, ungrantable: true }) });
    const out = deriveBudgetProposals([volume(1759)], [p], { budget: 50 });
    expect(out[0]!.ungrantable).toBe(true);
    expect(out[0]!.auto_demoted).toBe(false);
    expect(out[0]!.summary).toContain('ungrantable');
  });

  it('a budget of 0 disables the rule entirely', () => {
    expect(deriveBudgetProposals([volume(99999)], [policy()], { budget: 0 })).toHaveLength(0);
  });

  it('ignores volume for a policy that is not active', () => {
    // policies[] is the ACTIVE set; a row with no matching policy is dropped.
    const out = deriveBudgetProposals([volume(1759, 'gp_gone')], [policy()], { budget: 50 });
    expect(out).toHaveLength(0);
  });

  it('ids are content-stable, so a dismissal stays dismissed', () => {
    const a = deriveBudgetProposals([volume(1759)], [policy()], { budget: 50 })[0]!;
    const b = deriveBudgetProposals([volume(2000)], [policy()], { budget: 50 })[0]!;
    expect(a.id).toBe(b.id);
    expect(a.id).toBe(budgetProposalId('gp_1'));
    expect(a.id).toMatch(/^lp_[a-f0-9]{16}$/);
  });

  it('sorts loudest first', () => {
    const out = deriveBudgetProposals(
      [volume(100, 'gp_1'), volume(900, 'gp_2')],
      [policy(), policy({ id: 'gp_2', name: 'Other' })],
      { budget: 50 },
    );
    expect(out.map((p) => p.policy_id)).toEqual(['gp_2', 'gp_1']);
  });

  it('tolerates malformed stored rules instead of throwing', () => {
    const p = policy({ rules: '{not json' });
    const out = deriveBudgetProposals([volume(1759)], [p], { budget: 50 });
    // Unparseable rules means ungrantable is unreadable -> treated as false ->
    // auto-demote allowed. Acceptable: the guard re-reads ungrantable from the
    // live policy row itself and is the actual enforcement gate.
    expect(out).toHaveLength(1);
  });

  it('defaults to the shipped budget when none is passed', () => {
    const justOver = INTERRUPTION_BUDGET_DEFAULTS.perWindow + 1;
    expect(deriveBudgetProposals([volume(justOver)], [policy()])).toHaveLength(1);
    expect(deriveBudgetProposals([volume(INTERRUPTION_BUDGET_DEFAULTS.perWindow)], [policy()])).toHaveLength(0);
  });
});
