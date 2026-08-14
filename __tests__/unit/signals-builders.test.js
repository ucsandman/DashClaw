import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  buildStalePresenceSignals,
  buildAutonomySpikeSignals,
  buildHighImpactSignals,
  buildRepeatedFailureSignals,
  buildAssumptionDriftSignals,
  buildStaleAssumptionSignals,
  buildStaleRunningSignals,
  buildStaleApprovalSignals,
  buildIntegrationMismatchSignals,
  buildStalledSessionSignals,
  buildBranchStaleSignals,
  buildMcpDegradedSignals,
  buildGreenInsufficientSignals,
} from '../../app/lib/signals';

const NOW = new Date('2026-07-05T12:00:00Z');
const hoursAgo = (h) => new Date(NOW.getTime() - h * 3600000).toISOString();
const daysAgo = (d) => hoursAgo(d * 24);
const minutesAgo = (m) => new Date(NOW.getTime() - m * 60000).toISOString();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('severity thresholds', () => {
  it('agent_silent: red only while assigned to a task', () => {
    const rows = [
      { agent_id: 'a1', last_heartbeat_at: minutesAgo(30), current_task_id: 'act_1' },
      { agent_id: 'a2', last_heartbeat_at: minutesAgo(30), current_task_id: null },
    ];
    const [red, amber] = buildStalePresenceSignals(rows);
    expect(red.severity).toBe('red');
    expect(amber.severity).toBe('amber');
  });

  it('autonomy_spike: red strictly above 2x the org threshold', () => {
    const rows = [
      { agent_id: 'a1', action_count: '201' },
      { agent_id: 'a2', action_count: '200' },
    ];
    const [red, amber] = buildAutonomySpikeSignals(rows, 100);
    expect(red.severity).toBe('red');
    expect(amber.severity).toBe('amber');
  });

  it('high_impact_low_oversight: red at risk_score >= 90', () => {
    const rows = [
      { agent_id: 'a1', risk_score: '90', timestamp_start: hoursAgo(1) },
      { agent_id: 'a2', risk_score: '89', timestamp_start: hoursAgo(1) },
    ];
    const [red, amber] = buildHighImpactSignals(rows);
    expect(red.severity).toBe('red');
    expect(amber.severity).toBe('amber');
  });

  it('repeated_failures: red strictly above 5 failures', () => {
    const [red, amber] = buildRepeatedFailureSignals([
      { agent_id: 'a1', failure_count: '6' },
      { agent_id: 'a2', failure_count: '5' },
    ]);
    expect(red.severity).toBe('red');
    expect(amber.severity).toBe('amber');
  });

  it('assumption_drift: red at 4+ invalidations', () => {
    const [red, amber] = buildAssumptionDriftSignals([
      { agent_id: 'a1', invalidation_count: '4' },
      { agent_id: 'a2', invalidation_count: '3' },
    ]);
    expect(red.severity).toBe('red');
    expect(amber.severity).toBe('amber');
  });

  it('stale_assumption: red strictly above 30 days', () => {
    const [red, amber] = buildStaleAssumptionSignals([
      { assumption_id: 's1', assumption: 'x', created_at: daysAgo(31) },
      { assumption_id: 's2', assumption: 'y', created_at: daysAgo(30) },
    ]);
    expect(red.severity).toBe('red');
    expect(amber.severity).toBe('amber');
  });

  it('stale_assumption: surfaces the grouped occurrence count in the detail', () => {
    const [grouped, single] = buildStaleAssumptionSignals([
      { assumption_id: 's1', assumption: 'x', created_at: daysAgo(35), occurrence_count: '6' },
      { assumption_id: 's2', assumption: 'y', created_at: daysAgo(35) },
    ]);
    expect(grouped.detail).toContain('recorded 6 times');
    expect(single.detail).not.toContain('recorded');
  });

  it('stale_running_action: red strictly above 24 hours', () => {
    const [red, amber] = buildStaleRunningSignals([
      { action_id: 'a1', timestamp_start: hoursAgo(25) },
      { action_id: 'a2', timestamp_start: hoursAgo(24) },
    ]);
    expect(red.severity).toBe('red');
    expect(amber.severity).toBe('amber');
  });

  it('approval_backlog: red at 4+ hours pending', () => {
    const [red, amber] = buildStaleApprovalSignals([
      { action_id: 'a1', timestamp_start: hoursAgo(4) },
      { action_id: 'a2', timestamp_start: hoursAgo(2) },
    ]);
    expect(red.severity).toBe('red');
    expect(amber.severity).toBe('amber');
  });

  // Rows arrive pre-aggregated per agent (see the agent_sessions query).
  it('session_stalled: red at 4+ hours idle; null input yields no signals', () => {
    const [red, amber] = buildStalledSessionSignals([
      { agent_id: 'a1', stalled_count: 1, oldest_activity: hoursAgo(4), sample_session_id: 's1' },
      { agent_id: 'a2', stalled_count: 1, oldest_activity: hoursAgo(3), sample_session_id: 's2' },
    ]);
    expect(red.severity).toBe('red');
    expect(red.session_id).toBe('s1');
    expect(amber.severity).toBe('amber');
    expect(buildStalledSessionSignals(null)).toEqual([]);
  });

  // Regression: 266 stalled sessions used to emit 266 separate criticals behind
  // a `LIMIT 10` with no ORDER BY, so dismissing them was unwinnable whack-a-mole.
  it('session_stalled: one signal per agent, count in the label', () => {
    const signals = buildStalledSessionSignals([
      { agent_id: 'forge-openclaw', stalled_count: 134, oldest_activity: hoursAgo(45), sample_session_id: 'sess_old' },
    ]);
    expect(signals).toHaveLength(1);
    expect(signals[0].label).toContain('134 sessions stalled');
    expect(signals[0].label).toContain('forge-openclaw');
    expect(signals[0].detail).toContain('sess_old');
    expect(signals[0].severity).toBe('red');
  });

  // Severity and the reported age track the OLDEST session, so a growing
  // backlog can only escalate.
  it('session_stalled: age comes from the oldest session in the group', () => {
    const [s] = buildStalledSessionSignals([
      { agent_id: 'a1', stalled_count: 3, oldest_activity: hoursAgo(9), sample_session_id: 's9' },
    ]);
    expect(s.label).toContain('oldest 9h');
    expect(s.detected_at).toBe(hoursAgo(9));
  });
});

describe('integration_mismatch', () => {
  it('returns nothing when either input query failed (null)', () => {
    expect(buildIntegrationMismatchSignals(null, [])).toEqual([]);
    expect(buildIntegrationMismatchSignals([], null)).toEqual([]);
  });

  it('error status is red; missing credentials is amber only after the health cron has run', () => {
    const connections = [
      { provider: 'github', agent_id: 'a1' },
      { provider: 'slack', agent_id: 'a1' },
    ];
    const health = [{ provider: 'github', status: 'error', checked_at: hoursAgo(1) }];
    const signals = buildIntegrationMismatchSignals(connections, health);
    expect(signals).toHaveLength(2);
    expect(signals[0]).toMatchObject({ severity: 'red', provider: 'github' });
    expect(signals[1]).toMatchObject({ severity: 'amber', provider: 'slack' });
  });

  it('stays silent about unchecked providers before any health record exists', () => {
    const signals = buildIntegrationMismatchSignals([{ provider: 'slack', agent_id: 'a1' }], []);
    expect(signals).toEqual([]);
  });
});

describe('guard-decision intel builders', () => {
  it('branch_stale: red at 5+ commits behind, one signal per agent, malformed context skipped', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const ctx = (behind) => JSON.stringify({ intel: { branch: { freshness: 'stale', name: 'feat', commits_behind: behind } } });
    const signals = buildBranchStaleSignals([
      { id: 1, agent_id: 'a1', context: ctx(5), created_at: hoursAgo(1) },
      { id: 2, agent_id: 'a1', context: ctx(9), created_at: hoursAgo(1) }, // deduped
      { id: 3, agent_id: 'a2', context: ctx(2), created_at: hoursAgo(1) },
      { id: 4, agent_id: 'a3', context: '{not json', created_at: hoursAgo(1) },
    ]);
    expect(signals).toHaveLength(2);
    expect(signals[0].severity).toBe('red');
    expect(signals[1].severity).toBe('amber');
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('mcp_degraded: auth_required is red, one signal per server', () => {
    const ctx = (server, status) => JSON.stringify({ intel: { mcp: { server, status, healthy: false } } });
    const signals = buildMcpDegradedSignals([
      { id: 1, agent_id: 'a1', context: ctx('gh', 'auth_required'), created_at: hoursAgo(1) },
      { id: 2, agent_id: 'a2', context: ctx('gh', 'auth_required'), created_at: hoursAgo(1) }, // deduped
      { id: 3, agent_id: 'a1', context: ctx('slack', 'timeout'), created_at: hoursAgo(1) },
    ]);
    expect(signals).toHaveLength(2);
    expect(signals[0].severity).toBe('red');
    expect(signals[1].severity).toBe('amber');
  });

  it('green_insufficient: fires only on Green-contract reasons, one per agent', () => {
    const signals = buildGreenInsufficientSignals([
      { id: 1, agent_id: 'a1', reason: 'Green contract requires level=full', context: '{}', created_at: hoursAgo(1) },
      { id: 2, agent_id: 'a1', reason: 'Green contract requires level=full', context: '{}', created_at: hoursAgo(1) }, // deduped
      { id: 3, agent_id: 'a2', reason: 'risk threshold', context: '{}', created_at: hoursAgo(1) },
    ]);
    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({ severity: 'red', agent_id: 'a1' });
  });
});
