// __tests__/unit/policy-contract.test.ts
import { describe, expect, it } from 'vitest';
import { buildContract } from '@/lib/policy-modes/contract';
import { compileMode } from '@/lib/policy-modes';

function asRows(modeId: string) {
  return compileMode(modeId).map((p, i) => ({
    id: `gp_${i}`,
    name: p.name,
    policy_type: p.policy_type,
    rules: JSON.stringify(p.rules),
    active: 1,
  }));
}

describe('buildContract', () => {
  it('renders the claude-code pack into interrupt/silent/block sentences', () => {
    const c = buildContract(asRows('claude-code'), {});
    expect(c.governed).toBe(true);
    expect(c.mode_id).toBe('claude-code');
    // deploy/migrate + destructive + protected paths + runaway loop are interrupts
    expect(c.interrupts.length).toBeGreaterThanOrEqual(4);
    // warn_action_type + risk-warn + burst are silent
    expect(c.silent.some((s) => s.text.toLowerCase().includes('api'))).toBe(true);
    // block tier carries the extreme-risk threshold
    expect(c.blocks.some((s) => s.text.includes('risk score reaches 100'))).toBe(true);
  });

  it('separates grants and custom rules', () => {
    const rows = [
      ...asRows('claude-code'),
      { id: 'gp_g', name: '[Grant] api → stripe', policy_type: 'allow_grant', rules: JSON.stringify({ action_type: 'api', target_prefix: 'api.stripe.com' }), active: 1 },
      { id: 'gp_c', name: 'My custom rule', policy_type: 'semantic_check', rules: JSON.stringify({ instruction: 'no PII' }), active: 1 },
    ];
    const c = buildContract(rows, {});
    expect(c.grants).toHaveLength(1);
    const grant = c.grants[0];
    if (!grant) throw new Error('grant not found');
    expect(grant.label).toBe('api → api.stripe.com');
    // claude-code's delegation_constraint policy now has a dedicated contract
    // sentence (interrupts, since its default escalate_action is
    // require_approval) — only the fixture's own unrecognized policy_type
    // falls into `custom`.
    expect(c.custom).toHaveLength(1);
    expect(c.interrupts.some((s) => s.text.includes('subagent'))).toBe(true);
  });

  it('reports ungoverned when no active policies', () => {
    expect(buildContract([], {}).governed).toBe(false);
  });

  it('protected_path with action block lands in blocks tier', () => {
    const rows = [
      { id: 'gp_pp', name: 'Protected paths blocked', policy_type: 'protected_path', rules: JSON.stringify({ action: 'block' }), active: 1 as const },
    ];
    const c = buildContract(rows, {});
    expect(c.blocks.some((s) => s.text.includes('(blocked)'))).toBe(true);
    expect(c.interrupts.some((s) => s.text.includes('protected paths'))).toBe(false);
    expect(c.silent.some((s) => s.text.includes('protected paths'))).toBe(false);
  });

  it('require_approval with missing action_types lands in custom', () => {
    const rows = [
      { id: 'gp_ra', name: 'Approve all', policy_type: 'require_approval', rules: JSON.stringify({}), active: 1 as const },
    ];
    const c = buildContract(rows, {});
    expect(c.custom.some((x) => x.policy_id === 'gp_ra')).toBe(true);
    expect(c.interrupts.some((s) => s.text.includes('action is one of'))).toBe(false);
  });

  it('role_constraint tool-level scope (allowed_tools / blocked_tools) lands in interrupts', () => {
    const rows = [
      {
        id: 'gp_role',
        name: 'Reviewer',
        policy_type: 'role_constraint',
        rules: JSON.stringify({
          allowed_tools: ['Read', 'Grep'],
          blocked_tools: ['mcp__xapi__*'],
          escalate_action: 'require_approval',
        }),
        active: 1 as const,
      },
    ];
    const c = buildContract(rows, {});
    expect(c.custom.some((x) => x.policy_id === 'gp_role')).toBe(false);
    expect(c.interrupts.some((s) => s.text.includes('Reviewer') && s.text.includes('mcp__xapi__*'))).toBe(true);
  });

  it('assumption_hold reads as a sentence, and blocks only on the operator opt-in', () => {
    const row = (rules: Record<string, unknown>) => ({
      id: 'gp_ah',
      name: 'Stale Assumption',
      policy_type: 'assumption_hold',
      rules: JSON.stringify(rules),
      active: 1 as const,
    });

    const held = buildContract([row({ window_minutes: 120, min_risk_score: 40 })], {});
    expect(held.custom.some((x) => x.policy_id === 'gp_ah')).toBe(false);
    expect(held.interrupts.some((s) =>
      s.text.includes('within 120 min of one of its assumptions being invalidated')
      && s.text.includes('risk ≥ 40'))).toBe(true);

    // Defaults still produce a sentence rather than falling into `custom`.
    const defaults = buildContract([row({})], {});
    expect(defaults.interrupts.some((s) => s.text.includes('within 60 min'))).toBe(true);

    const blocked = buildContract([row({ escalate_action: 'block' })], {});
    expect(blocked.interrupts).toHaveLength(0);
    expect(blocked.blocks.some((s) => s.text.includes('assumptions being invalidated'))).toBe(true);
  });
});
