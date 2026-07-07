import { describe, expect, it } from 'vitest';
import { buildAgentDefense } from '@/lib/agent-defense';

// Golden vectors for the agent's-advocate rollup (pure shaping, no IO).
// Honesty invariant under test throughout: missing evidence renders as
// not_recorded / linked:false — never a fabricated "clean".

const action = (overrides = {}) => ({
  action_id: 'act_1',
  action_type: 'deploy',
  declared_goal: 'deploy the release',
  reasoning: 'tests are green',
  authorization_scope: 'ci',
  trigger: 'schedule',
  guard_decision_id: 'act_gd_1',
  ...overrides,
});

const decision = (overrides = {}) => ({
  id: 'act_gd_1',
  decision: 'allow',
  reason: null,
  matched_policies: JSON.stringify(['pol_1']),
  context: JSON.stringify({
    action_type: 'deploy',
    _risk_breakdown: { final: 42 },
    _shields: { prompt_injection: 'clean' },
  }),
  evidence: null,
  risk_score: 42,
  action_type: 'deploy',
  ...overrides,
});

const assumption = (overrides = {}) => ({ validated: 0, invalidated: 0, ...overrides });

describe('buildAgentDefense', () => {
  it('full rollup: linked decision with _shields', () => {
    const d = buildAgentDefense(action(), decision(), [
      assumption({ validated: 1 }),
      assumption({ invalidated: 1, validated: 1 }), // invalidated wins
      assumption(),
    ]);
    expect(d.declared).toEqual({
      goal: 'deploy the release',
      reasoning: 'tests are green',
      authorization_scope: 'ci',
      trigger: 'schedule',
    });
    expect(d.assumed).toEqual({ total: 3, validated: 1, invalidated: 1, open: 1 });
    expect(d.decision).toEqual({
      linked: true,
      id: 'act_gd_1',
      decision: 'allow',
      reason: null,
      matched_policies: ['pol_1'],
      risk_score: 42,
      risk_breakdown: { final: 42 },
    });
    expect(d.shields.prompt_injection.status).toBe('clean');
    expect(d.shields.non_fabrication).toEqual({ evaluated: false });
  });

  it('legacy decision without _shields → prompt_injection not_recorded', () => {
    const legacy = decision({ context: JSON.stringify({ _risk_breakdown: { final: 10 } }) });
    const d = buildAgentDefense(action(), legacy, []);
    expect(d.shields.prompt_injection.status).toBe('not_recorded');
    expect(d.decision.linked).toBe(true);
  });

  it('no guard_decision_id → linked:false and no shield claims', () => {
    const d = buildAgentDefense(action({ guard_decision_id: null }), null, []);
    expect(d.decision).toEqual({ linked: false });
    expect(d.shields.prompt_injection.status).toBe('not_recorded');
    expect(d.shields.non_fabrication).toEqual({ evaluated: false });
  });

  it('non-fabrication evidence rolls up verdict, violation count, and receipt presence', () => {
    const withEvidence = decision({
      evidence: JSON.stringify([
        { policy_id: 'pol_nf', verdict: 'pass', violations: [], receipt: { sig: 'abc' } },
        { policy_id: 'pol_nf2', verdict: 'block', violations: [{ code: 'v1' }, { code: 'v2' }] },
      ]),
    });
    const d = buildAgentDefense(action(), withEvidence, []);
    expect(d.shields.non_fabrication).toEqual({
      evaluated: true,
      verdict: 'block',
      violations: 2,
      receipt: true,
    });
  });


  it('malformed context/evidence/matched_policies JSON degrades, never throws', () => {
    const broken = decision({
      context: '{not json',
      evidence: '[broken',
      matched_policies: 'also not json',
      risk_score: 'NaN-ish',
    });
    const d = buildAgentDefense(action(), broken, []);
    expect(d.decision).toMatchObject({
      linked: true,
      matched_policies: [],
      risk_score: null,
      risk_breakdown: null,
    });
    expect(d.shields.prompt_injection.status).toBe('not_recorded');
    expect(d.shields.non_fabrication).toEqual({ evaluated: false });
  });

  it('driver-parsed (already-object) jsonb columns are accepted as-is', () => {
    const parsed = decision({
      matched_policies: ['pol_1', 42, 'pol_2'], // non-strings filtered
      context: { _shields: { prompt_injection: 'warned' }, _risk_breakdown: { final: 7 } },
    });
    const d = buildAgentDefense(action(), parsed, []);
    expect(d.decision.matched_policies).toEqual(['pol_1', 'pol_2']);
    expect(d.shields.prompt_injection.status).toBe('warned');
    expect(d.decision.risk_breakdown).toEqual({ final: 7 });
  });

  it('null declared fields render as null, not empty strings', () => {
    const bare = buildAgentDefense(
      action({ declared_goal: null, reasoning: '', authorization_scope: undefined, trigger: null }),
      null,
      [],
    );
    expect(bare.declared).toEqual({ goal: null, reasoning: null, authorization_scope: null, trigger: null });
  });
});
