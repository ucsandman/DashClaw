import { describe, it, expect } from 'vitest';
import { buildPolicySummary, type ActivePolicyRow, type OutcomeCounts } from '../../app/lib/policy-modes/summary';

const ZERO: OutcomeCounts = { total: 0, allow: 0, warn: 0, require_approval: 0, block: 0 };
const rules = (o: Record<string, unknown>) => JSON.stringify(o);

describe('buildPolicySummary', () => {
  it('reports ungoverned when there are no active policies', () => {
    const s = buildPolicySummary([], {}, ZERO, 47, 0);
    expect(s.governed).toBe(false);
    expect(s.primaryMode).toBeNull();
    expect(s.modes).toEqual([]);
    expect(s.enforcement).toEqual({ total: 0, warn: 0, require_approval: 0, block: 0 });
    expect(s.rules).toEqual([]);
    expect(s.shields).toHaveLength(10); // full catalog, all off (v4.63.0 adds Evidence Required)
    expect(s.shields.every((sh) => sh.on === false)).toBe(true);
    expect(s.agents.total).toBe(47);
  });

  it('resolves the primary mode from _mode tags and buckets rules by nominal decision', () => {
    const active: ActivePolicyRow[] = [
      { id: 'p1', name: '[Claude Code Mode] Block extreme-risk', policy_type: 'risk_threshold', rules: rules({ threshold: 100, action: 'block', _mode: 'claude-code' }) },
      { id: 'p2', name: '[Claude Code Mode] Warn high-risk', policy_type: 'risk_threshold', rules: rules({ threshold: 85, action: 'warn', _mode: 'claude-code' }) },
      { id: 'p3', name: '[Claude Code Mode] Pause before deploy', policy_type: 'require_approval', rules: rules({ action_types: ['deploy'], _mode: 'claude-code' }) },
    ];
    const s = buildPolicySummary(active, {}, ZERO, 5, 0);
    expect(s.governed).toBe(true);
    expect(s.primaryMode).toEqual({ id: 'claude-code', name: 'Claude Code Mode', interruptionLevel: 'low' });
    expect(s.modes).toHaveLength(1);
    expect(s.enforcement).toEqual({ total: 3, warn: 1, require_approval: 1, block: 1 });
    // severity-ordered: block, require_approval, warn
    expect(s.rules.map((r) => r.bucket)).toEqual(['block', 'require_approval', 'warn']);
  });

  it('uses the most-recently-applied mode (first in created_at DESC order) as primary and lists all modes', () => {
    const active: ActivePolicyRow[] = [
      { id: 'd1', name: '[Deploy Mode] Pause before deploy', policy_type: 'require_approval', rules: rules({ action_types: ['deploy'], _mode: 'deploy' }) },
      { id: 'c1', name: '[Claude Code Mode] Warn high-risk', policy_type: 'risk_threshold', rules: rules({ threshold: 85, action: 'warn', _mode: 'claude-code' }) },
    ];
    const s = buildPolicySummary(active, {}, ZERO, 5, 0);
    expect(s.primaryMode?.id).toBe('deploy');
    expect(s.modes.map((m) => m.id).sort()).toEqual(['claude-code', 'deploy']);
  });

  it('flags an active shield via its _shield tag and attaches fired counts by policy id', () => {
    const active: ActivePolicyRow[] = [
      { id: 'sh1', name: 'Deploy Gate', policy_type: 'require_approval', rules: rules({ action_types: ['deploy', 'migrate'], _shield: 'deploy_gate' }) },
    ];
    const counts = { sh1: { fired: 6, lastFiredAt: '2026-06-06T10:00:00Z' } };
    const s = buildPolicySummary(active, counts, ZERO, 5, 0);
    const deployGate = s.shields.find((sh) => sh.id === 'deploy_gate')!;
    expect(deployGate.on).toBe(true);
    expect(deployGate.fired30d).toBe(6);
    expect(deployGate.lastFiredAt).toBe('2026-06-06T10:00:00Z');
    // its rule row also carries the fired count
    expect(s.rules.find((r) => r.id === 'sh1')!.fired30d).toBe(6);
    // every other shield stays off with zero
    expect(s.shields.filter((sh) => sh.on)).toHaveLength(1);
  });

  it('passes decision outcome counts and pending approvals straight through', () => {
    const decisions: OutcomeCounts = { total: 100, allow: 83, warn: 10, require_approval: 5, block: 2 };
    const s = buildPolicySummary([], {}, decisions, 12, 3);
    expect(s.decisions30d).toEqual(decisions);
    expect(s.pendingApprovals).toBe(3);
  });

  it('derives scope.allAgents from the active policies agent_ids', () => {
    const unscoped: ActivePolicyRow[] = [
      { id: 'p1', name: 'X', policy_type: 'require_approval', rules: rules({ action_types: ['deploy'] }), agent_ids: null },
    ];
    expect(buildPolicySummary(unscoped, {}, ZERO, 5, 0).scope.allAgents).toBe(true);

    const scoped: ActivePolicyRow[] = [
      { id: 'p1', name: 'X', policy_type: 'require_approval', rules: rules({ action_types: ['deploy'] }), agent_ids: JSON.stringify(['agent_1']) },
    ];
    expect(buildPolicySummary(scoped, {}, ZERO, 5, 0).scope.allAgents).toBe(false);
  });
});
