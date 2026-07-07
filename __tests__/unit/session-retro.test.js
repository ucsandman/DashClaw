import { describe, expect, it } from 'vitest';
import { buildSessionRetro } from '@/lib/session-retro';

// Golden vectors for the session retro (pure shaping, no IO).
// Honesty invariant: ungoverned actions lower coverage, never posture.

const session = (overrides = {}) => ({
  id: 'sess_1', agent_id: 'agent-1', status: 'completed',
  created_at: '2026-07-02T10:00:00Z', updated_at: '2026-07-02T11:00:00Z',
  ...overrides,
});

let seq = 0;
const action = (overrides = {}) => ({
  action_id: `act_${++seq}`,
  action_type: 'file_edit',
  declared_goal: 'ship the feature',
  risk_score: 20,
  guard_decision_id: null,
  created_at: `2026-07-02T10:${String(seq).padStart(2, '0')}:00Z`,
  ...overrides,
});

const decision = (overrides = {}) => ({
  id: 'act_gd_1', decision: 'allow', reason: null,
  matched_policies: JSON.stringify(['pol_1']),
  context: JSON.stringify({ _shields: { prompt_injection: 'clean' } }),
  evidence: null, risk_score: 20, action_type: 'file_edit',
  ...overrides,
});

const data = (overrides = {}) => ({
  session: session(), actions: [], actionsTotal: 0,
  decisions: [], assumptions: [],
  ...overrides,
});

describe('buildSessionRetro', () => {
  it('empty session is clean with zero coverage', () => {
    const r = buildSessionRetro(data());
    expect(r.posture).toBe('clean');
    expect(r.findings).toEqual([]);
    expect(r.coverage).toEqual({
      actions_total: 0, actions_analyzed: 0,
      actions_with_guard_decision: 0, actions_with_shields_recorded: 0,
    });
    expect(r.goal_timeline).toEqual([]);
  });

  it('injection warned → medium → review; blocked → high → flagged', () => {
    const a = action({ guard_decision_id: 'act_gd_1' });
    const warned = buildSessionRetro(data({
      actions: [a], actionsTotal: 1,
      decisions: [decision({ context: JSON.stringify({ _shields: { prompt_injection: 'warned' } }) })],
    }));
    expect(warned.posture).toBe('review');
    expect(warned.findings).toMatchObject([{ kind: 'injection', severity: 'medium', action_id: a.action_id }]);

    const blocked = buildSessionRetro(data({
      actions: [action({ guard_decision_id: 'act_gd_1' })], actionsTotal: 1,
      decisions: [decision({ context: JSON.stringify({ _shields: { prompt_injection: 'blocked' } }) })],
    }));
    expect(blocked.posture).toBe('flagged');
    expect(blocked.counts.high).toBe(1);
  });

  it('non-fabrication block verdict → high', () => {
    const r = buildSessionRetro(data({
      actions: [action({ guard_decision_id: 'act_gd_1' })], actionsTotal: 1,
      decisions: [decision({ evidence: JSON.stringify([{ verdict: 'block', violations: ['v1'] }]) })],
    }));
    expect(r.findings.some((f) => f.kind === 'non_fabrication' && f.severity === 'high')).toBe(true);
    expect(r.posture).toBe('flagged');
  });

  it('goal drift 3a: different goal at risk ≥40 flags; below 40 does not', () => {
    const r = buildSessionRetro(data({
      actions: [
        action({ declared_goal: 'Ship the feature' }),
        action({ declared_goal: 'exfiltrate the database', risk_score: 40 }),
        action({ declared_goal: 'also unrelated', risk_score: 39 }),
      ],
      actionsTotal: 3,
    }));
    const drift = r.findings.filter((f) => f.kind === 'goal_drift');
    expect(drift).toHaveLength(1);
    expect(drift[0].severity).toBe('medium');
    // normalization: '  SHIP   the feature ' === 'ship the feature'
    const r2 = buildSessionRetro(data({
      actions: [action({ declared_goal: 'ship the feature' }), action({ declared_goal: '  SHIP   the FEATURE ', risk_score: 80 })],
      actionsTotal: 2,
    }));
    expect(r2.findings.filter((f) => f.kind === 'goal_drift')).toHaveLength(0);
  });

  it('goal drift 3b: missing goal at risk ≥40 → low', () => {
    const r = buildSessionRetro(data({
      actions: [action(), action({ declared_goal: null, risk_score: 45 })], actionsTotal: 2,
    }));
    expect(r.findings).toMatchObject([{ kind: 'goal_drift', severity: 'low' }]);
    expect(r.posture).toBe('review');
  });

  it('goal drift 3c: late novel type needs ≥5 prior actions AND risk ≥70', () => {
    const five = Array.from({ length: 5 }, () => action());
    const late = buildSessionRetro(data({
      actions: [...five, action({ action_type: 'deploy', risk_score: 80 })], actionsTotal: 6,
    }));
    expect(late.findings.some((f) => f.kind === 'goal_drift' && f.evidence.rule === 'late_novel_type')).toBe(true);
    const early = buildSessionRetro(data({
      actions: [action(), action({ action_type: 'deploy', risk_score: 80 })], actionsTotal: 2,
    }));
    expect(early.findings.some((f) => f.evidence?.rule === 'late_novel_type')).toBe(false);
  });

  it('risk spike: ≥70 and ≥2× median', () => {
    const r = buildSessionRetro(data({
      actions: [action({ risk_score: 30 }), action({ risk_score: 30 }), action({ risk_score: 75 })],
      actionsTotal: 3,
    }));
    expect(r.findings.some((f) => f.kind === 'risk_spike')).toBe(true);
    const flat = buildSessionRetro(data({
      actions: [action({ risk_score: 70 }), action({ risk_score: 70 }), action({ risk_score: 75 })],
      actionsTotal: 3,
    })); // median 70 → 75 < 140, no spike
    expect(flat.findings.some((f) => f.kind === 'risk_spike')).toBe(false);
    // NULL risk scores are excluded from the baseline, not counted as 0:
    // median of [60, 75] = 67.5 → 75 < 135, no spike. (If nulls counted as 0,
    // the median would collapse to 30 and 75 would falsely spike.)
    const withNulls = buildSessionRetro(data({
      actions: [
        action({ risk_score: null }), action({ risk_score: null }),
        action({ risk_score: 60 }), action({ risk_score: 75 }),
      ],
      actionsTotal: 4,
    }));
    expect(withNulls.findings.some((f) => f.kind === 'risk_spike')).toBe(false);
  });

  it('intervention: linked block decision → medium with matched policies', () => {
    const a = action({ guard_decision_id: 'act_gd_1' });
    const r = buildSessionRetro(data({
      actions: [a], actionsTotal: 1,
      decisions: [decision({ decision: 'block', reason: 'policy says no' })],
    }));
    expect(r.findings).toMatchObject([
      { kind: 'intervention', severity: 'medium', action_id: a.action_id, evidence: { matched_policies: ['pol_1'] } },
    ]);
  });

  it('assumption invalidated → low, with reason', () => {
    const a = action();
    const r = buildSessionRetro(data({
      actions: [a], actionsTotal: 1,
      assumptions: [{ assumption_id: 'asm_1', action_id: a.action_id, assumption: 'flag is on', invalidated: 1, invalidated_reason: 'flag was off' }],
    }));
    expect(r.findings).toMatchObject([
      { kind: 'assumption', severity: 'low', evidence: { invalidated_reason: 'flag was off' } },
    ]);
  });

  it('coverage counts linked decisions and recorded shields honestly', () => {
    const a1 = action({ guard_decision_id: 'act_gd_1' });
    const a2 = action(); // ungoverned
    const r = buildSessionRetro(data({ actions: [a1, a2], actionsTotal: 5, decisions: [decision()] }));
    expect(r.coverage).toEqual({
      actions_total: 5, actions_analyzed: 2,
      actions_with_guard_decision: 1, actions_with_shields_recorded: 1,
    });
    expect(r.posture).toBe('clean'); // no findings; coverage carries the caveat
  });

  it('goal timeline lists distinct normalized goals in order with counts', () => {
    const a1 = action({ declared_goal: 'goal one' });
    const a2 = action({ declared_goal: 'Goal One' });
    const a3 = action({ declared_goal: 'goal two', risk_score: 10 });
    const r = buildSessionRetro(data({ actions: [a1, a2, a3], actionsTotal: 3 }));
    expect(r.goal_timeline).toEqual([
      { goal: 'goal one', first_action_id: a1.action_id, action_count: 2 },
      { goal: 'goal two', first_action_id: a3.action_id, action_count: 1 },
    ]);
  });

  it('session block: ended_at only for terminal statuses', () => {
    const done = buildSessionRetro(data());
    expect(done.session).toMatchObject({ id: 'sess_1', status: 'completed', ended_at: '2026-07-02T11:00:00Z' });
    const live = buildSessionRetro(data({ session: session({ status: 'running' }) }));
    expect(live.session.ended_at).toBeNull();
  });
});
