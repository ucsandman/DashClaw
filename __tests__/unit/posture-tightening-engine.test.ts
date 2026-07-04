/**
 * Pure-engine tests for the tightening-proposal engine (owner roadmap v3.2:
 * findings become proposals). Spec:
 * docs/superpowers/specs/2026-07-03-findings-become-proposals-design.md
 *
 * No mocks — deriveTighteningProposals/governedActionTypes/tighteningProposalId
 * are pure functions over rows + active-policy rows.
 */
import { describe, expect, it } from 'vitest';
import {
  deriveTighteningProposals,
  governedActionTypes,
  tighteningFindingKey,
  tighteningProposalId,
  TIGHTENING_RULE,
  type ActivePolicyRow,
  type UngovernedDecisionRow,
} from '@/lib/posture/tightening';
import { stableKey } from '@/lib/posture/model';
import { validatePolicy } from '@/lib/validate.js';

function row(
  id: string,
  riskScore: number,
  actionType: string | null,
  overrides: Partial<UngovernedDecisionRow> = {},
): UngovernedDecisionRow {
  return { id, risk_score: riskScore, action_type: actionType, agent_id: null, created_at: null, ...overrides };
}

function rows(n: number, riskScore: number, actionType: string, startAt = 0): UngovernedDecisionRow[] {
  return Array.from({ length: n }, (_, i) => row(`act_gd_${startAt + i}`, riskScore, actionType));
}

describe('deriveTighteningProposals — grouping by (action_type × riskLevel bucket)', () => {
  it('rows at risk 55 (high) and 80 (critical) for the same action_type yield TWO proposals', () => {
    const input = [...rows(3, 55, 'bash.exec'), ...rows(3, 80, 'bash.exec')];
    const proposals = deriveTighteningProposals(input, [], { windowDays: 7 });
    expect(proposals).toHaveLength(2);
    expect(proposals.map((p) => p.risk_level).sort()).toEqual(['critical', 'high']);
    for (const p of proposals) expect(p.action_type).toBe('bash.exec');
  });
});

describe('deriveTighteningProposals — minObserved', () => {
  it('default minObserved=3: 2 rows does NOT propose', () => {
    const proposals = deriveTighteningProposals(rows(2, 60, 'code.edit'), [], { windowDays: 7 });
    expect(proposals).toHaveLength(0);
  });

  it('default minObserved=3: 3 rows DOES propose', () => {
    const proposals = deriveTighteningProposals(rows(3, 60, 'code.edit'), [], { windowDays: 7 });
    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.evidence.observed_count).toBe(3);
  });

  it('opts.minObserved overrides the default (2 rows propose at minObserved:2)', () => {
    const proposals = deriveTighteningProposals(rows(2, 60, 'code.edit'), [], {
      windowDays: 7,
      minObserved: 2,
    });
    expect(proposals).toHaveLength(1);
  });
});

describe('deriveTighteningProposals — row filtering', () => {
  it('skips rows with null/empty action_type and rows below risk 50', () => {
    const input = [
      row('a1', 60, 'deploy'),
      row('a2', 60, 'deploy'),
      row('a3', 60, null), // null action_type
      row('a4', 60, ''), // empty action_type
      row('a5', 40, 'deploy'), // below risk 50
    ];
    // minObserved:2 so exactly the two valid 'deploy' rows are enough, and no
    // more, proving the other three rows were dropped rather than counted.
    const proposals = deriveTighteningProposals(input, [], { windowDays: 7, minObserved: 2 });
    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.action_type).toBe('deploy');
    expect(proposals[0]?.evidence.observed_count).toBe(2);
  });
});

describe('governedActionTypes / suppression', () => {
  const activeRow = (policy_type: string, rules: unknown): ActivePolicyRow => ({ policy_type, rules });

  it('an active require_approval policy (rules as JSON string) suppresses the proposal', () => {
    const policies = [activeRow('require_approval', JSON.stringify({ action_types: ['a'] }))];
    const proposals = deriveTighteningProposals(rows(3, 60, 'a'), policies, { windowDays: 7 });
    expect(proposals).toHaveLength(0);
  });

  it('an active block_action_type policy (rules as a parsed object) suppresses the proposal', () => {
    const policies = [activeRow('block_action_type', { action_types: ['b'] })];
    const proposals = deriveTighteningProposals(rows(3, 60, 'b'), policies, { windowDays: 7 });
    expect(proposals).toHaveLength(0);
  });

  it('an active warn_action_type policy also suppresses', () => {
    const policies = [activeRow('warn_action_type', { action_types: ['c'] })];
    const proposals = deriveTighteningProposals(rows(3, 60, 'c'), policies, { windowDays: 7 });
    expect(proposals).toHaveLength(0);
  });

  it('an active risk_threshold policy does NOT suppress (not a governing type)', () => {
    const policies = [activeRow('risk_threshold', { action_types: ['d'] })];
    const proposals = deriveTighteningProposals(rows(3, 60, 'd'), policies, { windowDays: 7 });
    expect(proposals).toHaveLength(1);
  });

  it('tolerates malformed rules JSON without throwing, and does not suppress', () => {
    const policies = [activeRow('warn_action_type', '{not valid json')];
    expect(() => governedActionTypes(policies)).not.toThrow();
    const proposals = deriveTighteningProposals(rows(3, 60, 'e'), policies, { windowDays: 7 });
    expect(proposals).toHaveLength(1);
  });

  it('governedActionTypes ignores non-array / missing action_types', () => {
    const policies = [
      activeRow('require_approval', {}),
      activeRow('require_approval', { action_types: 'not-an-array' }),
      activeRow('require_approval', null),
    ];
    expect(governedActionTypes(policies)).toEqual(new Set());
  });
});

describe('content-stable id', () => {
  it('is stable regardless of row ids/order and matches tp_<16hex>', () => {
    const a = deriveTighteningProposals(
      [row('id1', 55, 'f'), row('id2', 55, 'f'), row('id3', 55, 'f')],
      [],
      { windowDays: 7 },
    );
    const b = deriveTighteningProposals(
      [row('idZ', 55, 'f'), row('idY', 55, 'f'), row('idX', 55, 'f')],
      [],
      { windowDays: 7 },
    );
    expect(a[0]?.id).toBe(b[0]?.id);
    expect(a[0]?.id).toMatch(/^tp_[a-f0-9]{16}$/);
    expect(a[0]?.id).toBe(tighteningProposalId('f', 'high'));
  });

  it('rule is always the govern_ungoverned_allow constant', () => {
    const [p] = deriveTighteningProposals(rows(3, 55, 'g'), [], { windowDays: 7 });
    expect(p?.rule).toBe(TIGHTENING_RULE);
    expect(TIGHTENING_RULE).toBe('govern_ungoverned_allow');
  });
});

describe('finding_key mirrors the v3.1 posture incident key', () => {
  it('equals model.stableKey and the tighteningFindingKey helper', () => {
    const [p] = deriveTighteningProposals(rows(3, 55, 'h'), [], { windowDays: 7 });
    expect(p?.finding_key).toBe(stableKey(['enforcement', 'incident', 'action_type:h', 'high']));
    expect(p?.finding_key).toBe(tighteningFindingKey('h', 'high'));
  });
});

describe('evidence', () => {
  it('observed_count is truthful, example_decision_ids capped at 5, risk_min/risk_max correct', () => {
    const input = [
      row('e1', 55, 'i'),
      row('e2', 60, 'i'),
      row('e3', 65, 'i'),
      row('e4', 70, 'i'),
      row('e5', 74, 'i'),
      row('e6', 74, 'i'),
      row('e7', 50, 'i'),
    ];
    const [p] = deriveTighteningProposals(input, [], { windowDays: 7 });
    expect(p?.evidence.observed_count).toBe(7);
    expect(p?.evidence.example_decision_ids).toHaveLength(5);
    expect(p?.evidence.example_decision_ids).toEqual(['e1', 'e2', 'e3', 'e4', 'e5']);
    expect(p?.evidence.risk_min).toBe(50);
    expect(p?.evidence.risk_max).toBe(74);
    expect(p?.evidence.window_days).toBe(7);
  });
});

describe('patch validates', () => {
  it('every proposal patch passes validatePolicy with no errors', () => {
    const proposals = deriveTighteningProposals(
      [...rows(3, 55, 'bash.exec'), ...rows(3, 80, 'deploy')],
      [],
      { windowDays: 7 },
    );
    expect(proposals.length).toBeGreaterThan(0);
    for (const p of proposals) {
      const result = validatePolicy({
        name: p.patch.name,
        policy_type: p.patch.policy_type,
        rules: JSON.stringify(p.patch.rules),
      }) as { valid: boolean; errors: string[] };
      expect(result.valid, `patch for ${p.action_type}/${p.risk_level} invalid: ${result.errors?.join('; ')}`).toBe(true);
    }
  });
});

describe('sort order', () => {
  it('sorts critical before high, then observed_count desc within a level', () => {
    const input = [
      ...rows(3, 60, 'low-count-high'), // high, observed 3
      ...rows(5, 60, 'high-count-high'), // high, observed 5
      ...rows(4, 80, 'only-critical'), // critical, observed 4
    ];
    const proposals = deriveTighteningProposals(input, [], { windowDays: 7 });
    expect(proposals).toHaveLength(3);
    expect(proposals[0]?.risk_level).toBe('critical');
    expect(proposals[1]?.risk_level).toBe('high');
    expect(proposals[2]?.risk_level).toBe('high');
    expect(proposals[1]?.action_type).toBe('high-count-high');
    expect(proposals[1]?.evidence.observed_count).toBe(5);
    expect(proposals[2]?.action_type).toBe('low-count-high');
    expect(proposals[2]?.evidence.observed_count).toBe(3);
  });
});
