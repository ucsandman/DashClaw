import { describe, it, expect } from 'vitest';
import { buildUnits, applyFindingStates, buildAdjustments, buildIntentSourceSignal } from '../../app/lib/posture/signals';
import type { GovernableUnit, PostureFinding } from '../../app/lib/posture/types';

const cap = (over: Partial<GovernableUnit> = {}): GovernableUnit => ({
  key: 'stripe-pay', surfaceType: 'capability', riskLevel: 'high', reversible: false,
  hasSpendExposure: false, requiresApproval: true, observedCount: 0, dimension: 'spend', ...over,
});
const action = (over: Partial<GovernableUnit> = {}): GovernableUnit => ({
  key: 'action_type:deploy', surfaceType: 'action_type', riskLevel: 'medium', reversible: true,
  hasSpendExposure: false, requiresApproval: false, observedCount: 5, dimension: 'enforcement', ...over,
});

describe('buildUnits', () => {
  it('merges capability and action units, keeping both', () => {
    const units = buildUnits([cap()], [action()], new Set());
    expect(units.map((u) => u.key).sort()).toEqual(['action_type:deploy', 'stripe-pay']);
  });

  it('flips hasSpendExposure on a unit whose key matches an active x402 provider slug', () => {
    const units = buildUnits([cap({ key: 'stripe-pay', hasSpendExposure: false })], [], new Set(['stripe-pay']));
    expect(units.find((u) => u.key === 'stripe-pay')!.hasSpendExposure).toBe(true);
  });

  it('leaves spend exposure unchanged when no x402 slug matches', () => {
    const units = buildUnits([cap({ key: 'internal-tool', hasSpendExposure: false })], [], new Set(['some-other-provider']));
    expect(units.find((u) => u.key === 'internal-tool')!.hasSpendExposure).toBe(false);
  });

  it('does not downgrade an already spend-exposed unit', () => {
    const units = buildUnits([cap({ key: 'internal-tool', hasSpendExposure: true })], [], new Set());
    expect(units.find((u) => u.key === 'internal-tool')!.hasSpendExposure).toBe(true);
  });

  it('bumps observedCount when a capability and action share a key', () => {
    const units = buildUnits([cap({ key: 'shared', observedCount: 0 })], [action({ key: 'shared', observedCount: 7 })], new Set());
    expect(units).toHaveLength(1);
    expect(units[0]!.observedCount).toBe(7);
    expect(units[0]!.surfaceType).toBe('capability'); // capability stays authoritative
  });
});

const finding = (over: Partial<PostureFinding> = {}): PostureFinding => ({
  key: 'enforcement:action_type:deploy:create_policy_draft',
  dimension: 'enforcement',
  severity: 'high',
  title: 'Destructive deploy actions reach allow ungoverned',
  evidence: { observedCount: 38, exampleActionIds: ['act_1'] },
  scoreDelta: 5,
  fix: { type: 'create_policy_draft', policyType: 'risk_threshold', rules: {} },
  status: 'open',
  ...over,
});

describe('applyFindingStates', () => {
  it('carries a stored snooze forward so the finding is no longer open', () => {
    const states = new Map([[finding().key, { status: 'snoozed' }]]);
    const merged = applyFindingStates([finding()], states);
    expect(merged[0]!.status).toBe('snoozed');
  });

  it('leaves findings with no stored state as open (identity when map is empty)', () => {
    const input = [finding()];
    const merged = applyFindingStates(input, new Map());
    expect(merged).toBe(input); // short-circuits — same reference, no copy
    expect(merged[0]!.status).toBe('open');
  });

  it('only restamps the matching key', () => {
    const a = finding({ key: 'a', status: 'open' });
    const b = finding({ key: 'b', status: 'open' });
    const merged = applyFindingStates([a, b], new Map([['a', { status: 'resolved' }]]));
    expect(merged.find((f) => f.key === 'a')!.status).toBe('resolved');
    expect(merged.find((f) => f.key === 'b')!.status).toBe('open');
  });

  it('ignores an unknown/garbage stored status (fails closed to the derived status)', () => {
    const merged = applyFindingStates([finding()], new Map([[finding().key, { status: 'bogus_status' }]]));
    expect(merged[0]!.status).toBe('open');
  });

  it('attaches the stored decision metadata to quieted findings (v3.1 attribution)', () => {
    const states = new Map([[finding().key, {
      status: 'accepted_risk',
      actor: 'op@example.com',
      note: 'read-only surface',
      updatedAt: '2026-07-01T00:00:00Z',
    }]]);
    const merged = applyFindingStates([finding()], states);
    expect(merged[0]!.status).toBe('accepted_risk');
    expect(merged[0]!.statusMeta).toEqual({
      actor: 'op@example.com',
      note: 'read-only surface',
      updatedAt: '2026-07-01T00:00:00Z',
    });
  });
});

describe('buildAdjustments', () => {
  const row = (over: Record<string, unknown> = {}) => ({
    id: 'act_gd_1', risk_score: 80, action_type: 'deploy', agent_id: 'claude-code',
    created_at: '2026-07-01T00:00:00Z', ...over,
  });

  it('turns a risky allow row into an incident', () => {
    const adj = buildAdjustments([row()]);
    expect(adj.incidents).toHaveLength(1);
    expect(adj.incidents[0]).toMatchObject({ unitKey: 'action_type:deploy', actionId: 'act_gd_1' });
  });

  it('drops synthetic rows even if a caller bypasses the SQL exclusion (v3.1 defense-in-depth)', () => {
    const adj = buildAdjustments([
      row({ id: 'act_gd_smoke1', agent_id: 'smoke-risky-abc123' }),
      row({ id: 'act_gd_smoke2', agent_id: 'claude-code', action_type: 'smoke.risky' }),
      row({ id: 'act_gd_real' }),
    ]);
    expect(adj.incidents.map((i) => i.actionId)).toEqual(['act_gd_real']);
  });
});

// Evidence-first guard (v4.63.0, spec §6): reads the same decision rows
// buildAdjustments already consumes — no new query shape.
describe('buildIntentSourceSignal', () => {
  const row = (over: Record<string, unknown> = {}) => ({
    action_type: 'deploy', context: { intent_source: 'evidence' }, ...over,
  });

  it('counts evidence and declared rows into the aggregate mix', () => {
    const { enforcementMix } = buildIntentSourceSignal([
      row({ context: { intent_source: 'evidence' } }),
      row({ context: { intent_source: 'declared' } }),
      row({ context: { intent_source: 'declared' } }),
    ]);
    expect(enforcementMix).toEqual({ evidence: 1, declared: 2 });
  });

  it('the most recent row per action_type wins the per-unit signal (rows arrive DESC)', () => {
    const { byUnitKey } = buildIntentSourceSignal([
      row({ action_type: 'deploy', context: { intent_source: 'evidence' } }), // most recent
      row({ action_type: 'deploy', context: { intent_source: 'declared' } }), // older, ignored
    ]);
    expect(byUnitKey.get('action_type:deploy')).toBe('evidence');
  });

  it('rows with no intent_source (pre-upgrade decisions) contribute no signal', () => {
    const { byUnitKey, enforcementMix } = buildIntentSourceSignal([
      row({ context: {} }),
      row({ context: null }),
      row({ context: '{"other":"field"}' }),
    ]);
    expect(byUnitKey.size).toBe(0);
    expect(enforcementMix).toEqual({ evidence: 0, declared: 0 });
  });

  it('parses a stringified context JSON column the same as an object', () => {
    const { byUnitKey } = buildIntentSourceSignal([
      row({ action_type: 'migrate', context: '{"intent_source":"declared"}' }),
    ]);
    expect(byUnitKey.get('action_type:migrate')).toBe('declared');
  });

  it('malformed context JSON is treated as no signal, not a throw', () => {
    expect(() => buildIntentSourceSignal([row({ context: '{not json' })])).not.toThrow();
  });
});
