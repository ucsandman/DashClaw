/**
 * Pure-engine table tests for the policy-tuning proposal loop (owner roadmap
 * item 1). Spec: docs/superpowers/specs/2026-07-01-policy-tuning-proposal-loop.md
 *
 * No mocks — buildTuningStats/deriveProposals/clampInt are pure functions.
 */
import { describe, expect, it } from 'vitest';
import {
  buildTuningStats,
  deriveProposals,
  clampInt,
  TUNING_DEFAULTS,
  type PolicyTuningStats,
} from '@/lib/policy-tuning/engine';

function makeStats(overrides: Partial<PolicyTuningStats> = {}): PolicyTuningStats {
  return {
    policy_id: 'gp_1',
    name: 'Test Policy',
    policy_type: 'risk_threshold',
    active: true,
    created_at: '2026-06-01T00:00:00.000Z',
    updated_at: '2026-06-01T00:00:00.000Z',
    rules: { threshold: 70, action: 'require_approval' },
    window_days: 30,
    window_started_at: '2026-06-01T00:00:00.000Z',
    fired: { warn: 0, allow_contained: 0, require_approval: 10, block: 0, total: 10 },
    approvals: { approved: 9, denied: 1, pending: 0 },
    override_rate: 0.9,
    approved_risk_scores: null,
    last_fired_at: null,
    fired_60d: 10,
    ...overrides,
  };
}

describe('deriveProposals — raise_risk_threshold', () => {
  it('fires at exactly the boundary (fired=minFired, resolved=minResolved, override_rate=0.9)', () => {
    const stats = makeStats({
      fired: { warn: 0, allow_contained: 0, require_approval: TUNING_DEFAULTS.minFired, block: 0, total: TUNING_DEFAULTS.minFired },
      approvals: { approved: 4, denied: 1, pending: 0 }, // resolved = 5 = minResolved
      override_rate: 0.9,
    });
    const proposals = deriveProposals([stats]);
    const raise = proposals.find((p) => p.rule === 'raise_risk_threshold');
    expect(raise).toBeDefined();
    expect(raise?.policy_id).toBe('gp_1');
  });

  it('does NOT fire one fired-count below minFired', () => {
    const stats = makeStats({
      fired: {
        warn: 0,
        allow_contained: 0,
        require_approval: TUNING_DEFAULTS.minFired - 1,
        block: 0,
        total: TUNING_DEFAULTS.minFired - 1,
      },
      approvals: { approved: 4, denied: 1, pending: 0 },
      override_rate: 0.9,
    });
    const proposals = deriveProposals([stats]);
    expect(proposals.find((p) => p.rule === 'raise_risk_threshold')).toBeUndefined();
  });

  it('does NOT fire one resolved-count below minResolved', () => {
    const stats = makeStats({
      fired: { warn: 0, allow_contained: 0, require_approval: TUNING_DEFAULTS.minFired, block: 0, total: TUNING_DEFAULTS.minFired },
      approvals: { approved: 3, denied: 1, pending: 0 }, // resolved = 4 < minResolved(5)
      override_rate: 0.9,
    });
    const proposals = deriveProposals([stats]);
    expect(proposals.find((p) => p.rule === 'raise_risk_threshold')).toBeUndefined();
  });

  it('does NOT fire at override_rate 0.89 (one unit below the 0.9 boundary)', () => {
    const stats = makeStats({
      fired: { warn: 0, allow_contained: 0, require_approval: TUNING_DEFAULTS.minFired, block: 0, total: TUNING_DEFAULTS.minFired },
      approvals: { approved: 4, denied: 1, pending: 0 },
      override_rate: 0.89,
    });
    const proposals = deriveProposals([stats]);
    expect(proposals.find((p) => p.rule === 'raise_risk_threshold')).toBeUndefined();
  });

  it('does NOT fire when rules.action is "block", even with perfect override evidence', () => {
    const stats = makeStats({
      rules: { threshold: 70, action: 'block' },
      fired: { warn: 0, allow_contained: 0, require_approval: 100, block: 0, total: 100 },
      approvals: { approved: 100, denied: 0, pending: 0 },
      override_rate: 1,
    });
    const proposals = deriveProposals([stats]);
    expect(proposals.length).toBe(0);
  });

  it('does NOT fire when rules.action is missing (default), even with perfect override evidence', () => {
    const stats = makeStats({
      rules: { threshold: 70 },
      fired: { warn: 0, allow_contained: 0, require_approval: 100, block: 0, total: 100 },
      approvals: { approved: 100, denied: 0, pending: 0 },
      override_rate: 1,
    });
    const proposals = deriveProposals([stats]);
    expect(proposals.length).toBe(0);
  });

  it('caps the proposed threshold at 95: current 90 → proposes 95', () => {
    const stats = makeStats({ rules: { threshold: 90, action: 'require_approval' } });
    const proposals = deriveProposals([stats]);
    const raise = proposals.find((p) => p.rule === 'raise_risk_threshold');
    expect(raise?.patch?.rules.threshold).toBe(95);
  });

  it('proposes nothing when current threshold is already 95 (cap reached)', () => {
    const stats = makeStats({ rules: { threshold: 95, action: 'require_approval' } });
    const proposals = deriveProposals([stats]);
    expect(proposals.find((p) => p.rule === 'raise_risk_threshold')).toBeUndefined();
  });

  it('patch.rules preserves untouched rule keys and only replaces threshold', () => {
    const stats = makeStats({ rules: { threshold: 70, action: 'require_approval', custom: 'x' } });
    const proposals = deriveProposals([stats]);
    const raise = proposals.find((p) => p.rule === 'raise_risk_threshold');
    expect(raise?.patch?.rules).toEqual({ threshold: 80, action: 'require_approval', custom: 'x' });
  });
});

describe('deriveProposals — keep_policy', () => {
  it('fires at denial rate 0.8 (informational, no patch)', () => {
    const stats = makeStats({
      policy_type: 'rate_limit',
      rules: {},
      fired: { warn: 0, allow_contained: 0, require_approval: 10, block: 0, total: 10 },
      approvals: { approved: 2, denied: 8, pending: 0 }, // denialRate = 0.8
      override_rate: 0.2,
    });
    const proposals = deriveProposals([stats]);
    const keep = proposals.find((p) => p.rule === 'keep_policy');
    expect(keep).toBeDefined();
    expect(keep?.severity).toBe('informational');
    expect(keep?.patch).toBeUndefined();
  });

  it('does NOT fire at denial rate 0.79', () => {
    const stats = makeStats({
      policy_type: 'rate_limit',
      rules: {},
      fired: { warn: 0, allow_contained: 0, require_approval: 100, block: 0, total: 100 },
      approvals: { approved: 21, denied: 79, pending: 0 }, // denialRate = 0.79
      override_rate: 0.21,
    });
    const proposals = deriveProposals([stats]);
    expect(proposals.find((p) => p.rule === 'keep_policy')).toBeUndefined();
  });

  it('is mutually exclusive with raise_risk_threshold on the same policy (raise wins via continue)', () => {
    // Deliberately inconsistent approvals vs. override_rate: this isolates the
    // `continue` after a raise match, proving keep_policy is never evaluated
    // once raise has fired for the same stats row (not just that the math of
    // override/denial rates happens to be exclusive in real data).
    const stats = makeStats({
      policy_type: 'risk_threshold',
      rules: { threshold: 70, action: 'require_approval' },
      fired: { warn: 0, allow_contained: 0, require_approval: 10, block: 0, total: 10 },
      approvals: { approved: 1, denied: 9, pending: 0 }, // denialRate = 0.9 (would also satisfy keep)
      override_rate: 0.95, // independently set field satisfies raise
    });
    const proposals = deriveProposals([stats]);
    expect(proposals.length).toBe(1);
    expect(proposals[0]?.rule).toBe('raise_risk_threshold');
  });
});

describe('deriveProposals — dead_policy', () => {
  const now = new Date('2026-07-01T00:00:00.000Z');
  function daysAgoIso(days: number): string {
    return new Date(now.getTime() - days * 86_400_000).toISOString();
  }

  it('fires when created 61 days ago and fired_60d is 0', () => {
    const stats = makeStats({
      policy_type: 'block_action_type',
      rules: {},
      created_at: daysAgoIso(61),
      fired: { warn: 0, allow_contained: 0, require_approval: 0, block: 0, total: 0 },
      approvals: { approved: 0, denied: 0, pending: 0 },
      override_rate: null,
      fired_60d: 0,
    });
    const proposals = deriveProposals([stats], { now });
    const dead = proposals.find((p) => p.rule === 'dead_policy');
    expect(dead).toBeDefined();
    expect(dead?.severity).toBe('informational');
    expect(dead?.patch).toBeUndefined();
  });

  it('does NOT fire when created only 59 days ago', () => {
    const stats = makeStats({
      policy_type: 'block_action_type',
      rules: {},
      created_at: daysAgoIso(59),
      fired: { warn: 0, allow_contained: 0, require_approval: 0, block: 0, total: 0 },
      approvals: { approved: 0, denied: 0, pending: 0 },
      override_rate: null,
      fired_60d: 0,
    });
    const proposals = deriveProposals([stats], { now });
    expect(proposals.find((p) => p.rule === 'dead_policy')).toBeUndefined();
  });

  it('does NOT fire when fired_60d is 1', () => {
    const stats = makeStats({
      policy_type: 'block_action_type',
      rules: {},
      created_at: daysAgoIso(61),
      fired: { warn: 0, allow_contained: 0, require_approval: 0, block: 0, total: 0 },
      approvals: { approved: 0, denied: 0, pending: 0 },
      override_rate: null,
      fired_60d: 1,
    });
    const proposals = deriveProposals([stats], { now });
    expect(proposals.find((p) => p.rule === 'dead_policy')).toBeUndefined();
  });

  it('emits nothing at all for an inactive policy, even if otherwise dead', () => {
    const stats = makeStats({
      active: false,
      policy_type: 'block_action_type',
      rules: {},
      created_at: daysAgoIso(61),
      fired: { warn: 0, allow_contained: 0, require_approval: 0, block: 0, total: 0 },
      approvals: { approved: 0, denied: 0, pending: 0 },
      override_rate: null,
      fired_60d: 0,
    });
    const proposals = deriveProposals([stats], { now });
    expect(proposals.length).toBe(0);
  });
});

describe('deriveProposals — fingerprint stability', () => {
  it('produces the same id twice for identical inputs', () => {
    const stats = makeStats();
    const [a] = deriveProposals([stats]);
    const [b] = deriveProposals([makeStats()]);
    expect(a?.id).toBeTruthy();
    expect(a?.id).toBe(b?.id);
  });

  it('produces a different id when the proposed threshold differs', () => {
    const low = makeStats({ rules: { threshold: 60, action: 'require_approval' } });
    const high = makeStats({ rules: { threshold: 80, action: 'require_approval' } });
    const [a] = deriveProposals([low]);
    const [b] = deriveProposals([high]);
    expect(a?.id).toBeTruthy();
    expect(b?.id).toBeTruthy();
    expect(a?.id).not.toBe(b?.id);
  });
});

describe('buildTuningStats', () => {
  const now = new Date('2026-07-01T00:00:00.000Z');

  function policyRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'gp_1',
      name: 'Test Policy',
      policy_type: 'risk_threshold',
      active: 1,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-06-25T00:00:00.000Z', // 6 days before `now`, inside a 30-day window
      rules: '{"threshold":70,"action":"require_approval"}',
      ...overrides,
    };
  }

  it('clips window_started_at at updated_at when updated_at is inside the window', () => {
    const [stats] = buildTuningStats([policyRow()], [], [], {}, 30, now);
    // window would otherwise start 30 days back (2026-06-01); updated_at
    // (2026-06-25) is later, so it wins.
    expect(stats?.window_started_at).toBe('2026-06-25T00:00:00.000Z');
  });

  it('does not clip when updated_at is outside (before) the window', () => {
    const [stats] = buildTuningStats(
      [policyRow({ updated_at: '2026-01-01T00:00:00.000Z' })],
      [],
      [],
      {},
      30,
      now,
    );
    const windowStartMs = now.getTime() - 30 * 86_400_000;
    expect(new Date(stats!.window_started_at).getTime()).toBe(windowStartMs);
  });

  it('coerces Neon string counts (cnt: "3") to numbers', () => {
    const mixRows = [
      { policy_id: 'gp_1', decision: 'require_approval', cnt: '3' as unknown as number, last_fired: '2026-06-26T00:00:00.000Z' },
    ];
    const [stats] = buildTuningStats([policyRow()], mixRows, [], {}, 30, now);
    expect(stats?.fired.require_approval).toBe(3);
    expect(stats?.fired.total).toBe(3);
    expect(typeof stats?.fired.require_approval).toBe('number');
  });

  it('override_rate is null when nothing has resolved', () => {
    const outcomeRows = [
      { policy_id: 'gp_1', approved: '0', denied: '0', pending: '2', approved_min: null, approved_p50: null, approved_max: null },
    ];
    const [stats] = buildTuningStats([policyRow()], [], outcomeRows, {}, 30, now);
    expect(stats?.override_rate).toBeNull();
  });

  it('approved_risk_scores is null when approved is 0', () => {
    const outcomeRows = [
      { policy_id: 'gp_1', approved: '0', denied: '3', pending: '0', approved_min: null, approved_p50: null, approved_max: null },
    ];
    const [stats] = buildTuningStats([policyRow()], [], outcomeRows, {}, 30, now);
    expect(stats?.approved_risk_scores).toBeNull();
  });

  it('populates approved_risk_scores when approved > 0 and scores are present', () => {
    const outcomeRows = [
      { policy_id: 'gp_1', approved: '11', denied: '1', pending: '0', approved_min: '62', approved_p50: '71', approved_max: '79' },
    ];
    const [stats] = buildTuningStats([policyRow()], [], outcomeRows, {}, 30, now);
    expect(stats?.approved_risk_scores).toEqual({ min: 62, p50: 71, max: 79 });
    expect(stats?.override_rate).toBeCloseTo(11 / 12);
  });
});

describe('clampInt', () => {
  it('falls back to the default for null', () => {
    expect(clampInt(null, 1, 100, 10)).toBe(10);
  });

  it('falls back to the default for garbage strings', () => {
    expect(clampInt('not-a-number', 1, 100, 10)).toBe(10);
  });

  it('clamps below-min values up to min', () => {
    expect(clampInt('0', 1, 100, 10)).toBe(1);
    expect(clampInt(-5, 1, 100, 10)).toBe(1);
  });

  it('clamps above-max values down to max', () => {
    expect(clampInt('999', 1, 100, 10)).toBe(100);
    expect(clampInt(500, 1, 100, 10)).toBe(100);
  });
});
