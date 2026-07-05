/**
 * Pure-engine tests for the loosening-proposal engine (owner roadmap v4.5:
 * proposals that relax). Spec:
 * docs/superpowers/specs/2026-07-05-loosening-direction.md
 *
 * No mocks — deriveLooseningProposals/looseningProposalId/policyEnvelope are
 * pure functions over outcome rows + active-policy rows.
 */
import { describe, expect, it } from 'vitest';
import {
  deriveLooseningProposals,
  looseningProposalId,
  policyEnvelope,
  RELAX_RULE,
  DEACTIVATE_RULE,
  LOOSENING_DEFAULTS,
  type InterruptOutcomeRow,
  type LooseningPolicyRow,
} from '@/lib/posture/loosening';

function outcome(
  policyId: string,
  actionType: string,
  fired: number,
  approved: number,
  denied: number,
  overrides: Partial<InterruptOutcomeRow> = {},
): InterruptOutcomeRow {
  return {
    policy_id: policyId,
    action_type: actionType,
    fired,
    approved,
    denied,
    pending: 0,
    example_decision_ids: Array.from({ length: Math.min(fired, 5) }, (_, i) => `act_gd_${policyId}_${i}`),
    ...overrides,
  };
}

function policy(
  id: string,
  policyType: string,
  rules: Record<string, unknown>,
  overrides: Partial<LooseningPolicyRow> = {},
): LooseningPolicyRow {
  return { id, name: `policy ${id}`, policy_type: policyType, rules: JSON.stringify(rules), active: 1, updated_at: null, ...overrides };
}

const WINDOW = { windowDays: 30 };

describe('relax_policy_scope — the carve-out grain', () => {
  it('an envelope type at 100% override with volume proposes removal, keeping the rest', () => {
    const p = policy('gp_a', 'require_approval', { action_types: ['deploy.prod', 'db.migrate'] });
    const proposals = deriveLooseningProposals(
      [outcome('gp_a', 'deploy.prod', 12, 10, 0)],
      [p],
      WINDOW,
    );
    expect(proposals).toHaveLength(1);
    const prop = proposals[0]!;
    expect(prop.rule).toBe(RELAX_RULE);
    expect(prop.action_type).toBe('deploy.prod');
    expect(prop.patch).toEqual({
      rules: { action_types: ['db.migrate'] },
    });
    expect(prop.evidence.override_rate).toBe(1);
    expect(prop.evidence.example_decision_ids).toHaveLength(5);
  });

  it('carving preserves the other rule keys (target_prefix etc.)', () => {
    const p = policy('gp_a', 'require_approval', {
      action_types: ['deploy.prod', 'db.migrate'],
      target_prefix: 'prod/',
      _tightened: true,
    });
    const proposals = deriveLooseningProposals([outcome('gp_a', 'deploy.prod', 12, 10, 0)], [p], WINDOW);
    expect(proposals[0]?.patch).toEqual({
      rules: { action_types: ['db.migrate'], target_prefix: 'prod/', _tightened: true },
    });
  });

  it('override rate 0.949 does NOT propose; 0.95 does (boundary)', () => {
    const p = policy('gp_a', 'require_approval', { action_types: ['a.b', 'c.d'] });
    // 18/19 ≈ 0.947 — below the bar.
    const below = deriveLooseningProposals([outcome('gp_a', 'a.b', 20, 18, 1)], [p], WINDOW);
    expect(below).toHaveLength(0);
    // 19/20 = 0.95 — at the bar.
    const at = deriveLooseningProposals([outcome('gp_a', 'a.b', 21, 19, 1)], [p], WINDOW);
    expect(at).toHaveLength(1);
  });

  it('minFired and minResolved both gate (defaults 10 / 5)', () => {
    const p = policy('gp_a', 'require_approval', { action_types: ['a.b', 'c.d'] });
    // fired 9 < 10 — even at 100% approval.
    expect(deriveLooseningProposals([outcome('gp_a', 'a.b', 9, 9, 0)], [p], WINDOW)).toHaveLength(0);
    // resolved 4 < 5 — plenty fired, few resolved.
    expect(deriveLooseningProposals([outcome('gp_a', 'a.b', 15, 4, 0)], [p], WINDOW)).toHaveLength(0);
    // both bars met.
    expect(deriveLooseningProposals([outcome('gp_a', 'a.b', 10, 5, 0)], [p], WINDOW)).toHaveLength(1);
    expect(LOOSENING_DEFAULTS.minFired).toBe(10);
    expect(LOOSENING_DEFAULTS.minResolved).toBe(5);
  });

  it('a type NOT in the envelope cannot carve — it falls through to the policy grain', () => {
    const p = policy('gp_a', 'require_approval', { action_types: ['x.y', 'c.d'] });
    const proposals = deriveLooseningProposals([outcome('gp_a', 'a.b', 12, 10, 0)], [p], WINDOW);
    // No surgical fix exists (the evidence type is outside the envelope, e.g.
    // after an edit), but the policy-grain truth stands: always approved.
    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.rule).toBe(DEACTIVATE_RULE);
  });
});

describe('deactivate_policy — the policy grain', () => {
  it('a policy with no envelope (protected_path shape) proposes deactivation', () => {
    const p = policy('gp_pp', 'protected_path', { paths: ['prod/**'], action: 'require_approval' });
    const proposals = deriveLooseningProposals([outcome('gp_pp', 'apply', 15, 12, 0)], [p], WINDOW);
    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.rule).toBe(DEACTIVATE_RULE);
    expect(proposals[0]?.action_type).toBeNull();
    expect(proposals[0]?.patch).toEqual({ active: false });
  });

  it('carving that would EMPTY the envelope falls through to deactivation', () => {
    const p = policy('gp_a', 'require_approval', { action_types: ['deploy.prod'] });
    const proposals = deriveLooseningProposals([outcome('gp_a', 'deploy.prod', 12, 10, 0)], [p], WINDOW);
    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.rule).toBe(DEACTIVATE_RULE);
  });

  it('when EVERY envelope type qualifies, deactivation is proposed instead of N carve-outs', () => {
    const p = policy('gp_a', 'require_approval', { action_types: ['a.b', 'c.d'] });
    const proposals = deriveLooseningProposals(
      [outcome('gp_a', 'a.b', 12, 10, 0), outcome('gp_a', 'c.d', 12, 10, 0)],
      [p],
      WINDOW,
    );
    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.rule).toBe(DEACTIVATE_RULE);
  });

  it('mixed evidence spread across untyped rows aggregates at the policy grain', () => {
    const p = policy('gp_rl', 'rate_limit', { max_actions: 650, window_seconds: 60, action: 'require_approval' });
    const proposals = deriveLooseningProposals(
      [outcome('gp_rl', '', 8, 4, 0), outcome('gp_rl', 'batch.write', 7, 3, 0)],
      [p],
      WINDOW,
    );
    // totals: fired 15 ≥ 10, resolved 7 ≥ 5, rate 1.0.
    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.rule).toBe(DEACTIVATE_RULE);
    expect(proposals[0]?.evidence.fired).toBe(15);
  });

  it('a mostly-DENIED policy never proposes (the keep_policy direction belongs to tuning)', () => {
    const p = policy('gp_a', 'require_approval', { action_types: ['a.b'] });
    const proposals = deriveLooseningProposals([outcome('gp_a', 'a.b', 20, 2, 15)], [p], WINDOW);
    expect(proposals).toHaveLength(0);
  });
});

describe('ownership + hygiene', () => {
  it('risk_threshold policies are excluded — tuning owns that direction', () => {
    const p = policy('gp_rt', 'risk_threshold', { threshold: 60, action: 'require_approval' });
    const proposals = deriveLooseningProposals([outcome('gp_rt', 'a.b', 20, 20, 0)], [p], WINDOW);
    expect(proposals).toHaveLength(0);
  });

  it('carve-outs and deactivation are never BOTH proposed for one policy', () => {
    const p = policy('gp_a', 'require_approval', { action_types: ['a.b', 'c.d', 'e.f'] });
    const proposals = deriveLooseningProposals(
      [outcome('gp_a', 'a.b', 12, 10, 0), outcome('gp_a', 'c.d', 12, 10, 0)],
      [p],
      WINDOW,
    );
    // 2 of 3 envelope types qualify — two carve-outs, no deactivate.
    expect(proposals).toHaveLength(2);
    expect(proposals.every((x) => x.rule === RELAX_RULE)).toBe(true);
  });

  it('evidence rows for unknown policies are ignored', () => {
    const proposals = deriveLooseningProposals([outcome('gp_missing', 'a.b', 20, 20, 0)], [], WINDOW);
    expect(proposals).toHaveLength(0);
  });

  it('updated_at inside the window clips window_started_at', () => {
    const now = new Date('2026-07-05T12:00:00.000Z');
    const updated = '2026-07-01T00:00:00.000Z';
    const p = policy('gp_a', 'require_approval', { action_types: ['a.b', 'c.d'] }, { updated_at: updated });
    const proposals = deriveLooseningProposals([outcome('gp_a', 'a.b', 12, 10, 0)], [p], { windowDays: 30, now });
    expect(proposals[0]?.evidence.window_started_at).toBe(updated);
  });

  it('ids are content-stable and rule/policy/action-type-scoped', () => {
    expect(looseningProposalId(RELAX_RULE, 'gp_a', 'x.y')).toBe(looseningProposalId(RELAX_RULE, 'gp_a', 'x.y'));
    expect(looseningProposalId(RELAX_RULE, 'gp_a', 'x.y')).not.toBe(looseningProposalId(RELAX_RULE, 'gp_a', 'x.z'));
    expect(looseningProposalId(RELAX_RULE, 'gp_a', 'x.y')).not.toBe(looseningProposalId(DEACTIVATE_RULE, 'gp_a', 'x.y'));
    expect(looseningProposalId(DEACTIVATE_RULE, 'gp_a')).toMatch(/^lp_[a-f0-9]{16}$/);
  });

  it('policyEnvelope rejects non-arrays, empties, and non-string members', () => {
    expect(policyEnvelope({})).toBeNull();
    expect(policyEnvelope({ action_types: 'a.b' })).toBeNull();
    expect(policyEnvelope({ action_types: [] })).toBeNull();
    expect(policyEnvelope({ action_types: [1, '', 'a.b'] })).toEqual(['a.b']);
  });
});
