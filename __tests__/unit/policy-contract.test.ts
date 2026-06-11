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
    const c = buildContract(asRows('claude-code'), { gp_2: 3 });
    expect(c.governed).toBe(true);
    expect(c.mode_id).toBe('claude-code');
    // x402 approval threshold is an editable interrupt sentence
    const spend = c.interrupts.find((s) => s.editable?.param === 'approval_threshold');
    if (!spend) throw new Error('x402 interrupt sentence not found');
    expect(spend.text).toContain('$5.00');
    expect(spend.fired_7d).toBe(3);
    // deploy/migrate + destructive + protected paths + runaway loop are interrupts
    expect(c.interrupts.length).toBeGreaterThanOrEqual(4);
    // warn_action_type + risk-warn + burst are silent
    expect(c.silent.some((s) => s.text.toLowerCase().includes('api'))).toBe(true);
    // block tier carries risk-100 and max-spend
    expect(c.blocks.some((s) => s.editable?.param === 'max_spend_usd')).toBe(true);
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
    expect(c.custom).toHaveLength(1);
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

  it('x402 with garbage approval_threshold renders $0.00 not $NaN', () => {
    const rows = [
      { id: 'gp_x', name: 'Spend limit', policy_type: 'x402_spend_limit', rules: JSON.stringify({ approval_threshold: 'garbage', max_spend_usd: 50 }), active: 1 as const },
    ];
    const c = buildContract(rows, {});
    const interrupt = c.interrupts.find((s) => s.editable?.param === 'approval_threshold');
    if (!interrupt) throw new Error('x402 interrupt sentence not found');
    expect(interrupt.text).not.toContain('NaN');
    expect(interrupt.text).toContain('$0.00');
  });

  it('require_approval with missing action_types lands in custom', () => {
    const rows = [
      { id: 'gp_ra', name: 'Approve all', policy_type: 'require_approval', rules: JSON.stringify({}), active: 1 as const },
    ];
    const c = buildContract(rows, {});
    expect(c.custom.some((x) => x.policy_id === 'gp_ra')).toBe(true);
    expect(c.interrupts.some((s) => s.text.includes('action is one of'))).toBe(false);
  });
});
