import { describe, it, expect, vi } from 'vitest';
import { computeSignals } from '@/lib/signals.js';

function createSignalSqlMock(responses, { spikeThreshold = null } = {}) {
  // computeSignals first reads the autonomy-spike threshold setting, then runs
  // the signal queries. The config read is recognized by text and answered
  // separately so the signal-query responses stay index-aligned.
  let callIndex = 0;
  return (strings, ...values) => {
    const text = strings.join(' ');
    if (text.includes('DASHCLAW_AUTONOMY_SPIKE_THRESHOLD')) {
      return Promise.resolve(spikeThreshold == null ? [] : [{ value: String(spikeThreshold) }]);
    }
    const result = responses[callIndex] || [];
    callIndex++;
    return Promise.resolve(result);
  };
}

describe('computeSignals', () => {
  it('returns empty array for clean org', async () => {
    const sql = createSignalSqlMock([[], [], [], [], [], [], []]);
    const signals = await computeSignals('org_1', null, sql);
    expect(signals).toEqual([]);
  });

  it('detects autonomy_spike with amber severity', async () => {
    const sql = createSignalSqlMock([
      [{ agent_id: 'a1', agent_name: 'Bot', action_count: '150' }],
      [], [], [], [], [], [],
    ]);
    const signals = await computeSignals('org_1', null, sql);
    expect(signals).toHaveLength(1);
    expect(signals[0].type).toBe('autonomy_spike');
    expect(signals[0].severity).toBe('amber');
    expect(signals[0].agent_id).toBe('a1');
  });

  it('detects autonomy_spike with red severity above 2x the threshold', async () => {
    const sql = createSignalSqlMock([
      [{ agent_id: 'a1', agent_name: 'Bot', action_count: '250' }],
      [], [], [], [], [], [],
    ]);
    const signals = await computeSignals('org_1', null, sql);
    expect(signals[0].severity).toBe('red');
  });

  it('autonomy_spike threshold is configurable via org setting', async () => {
    // With the threshold set to 25, 60 decisions/hr is red (> 2x) and the detail
    // reflects the configured value, not the default 100.
    const sql = createSignalSqlMock(
      [[{ agent_id: 'a1', agent_name: 'Bot', action_count: '60' }], [], [], [], [], [], []],
      { spikeThreshold: 25 },
    );
    const signals = await computeSignals('org_1', null, sql);
    expect(signals[0].type).toBe('autonomy_spike');
    expect(signals[0].severity).toBe('red');
    expect(signals[0].detail).toContain('threshold of 25');
  });

  it('detects high_impact_low_oversight with amber severity', async () => {
    const sql = createSignalSqlMock([
      [],
      [{ action_id: 'act_1', agent_id: 'a1', agent_name: 'Bot', declared_goal: 'Deploy prod', risk_score: '75', action_type: 'deploy' }],
      [], [], [], [], [],
    ]);
    const signals = await computeSignals('org_1', null, sql);
    expect(signals[0].type).toBe('high_impact_low_oversight');
    expect(signals[0].severity).toBe('amber');
  });

  it('propagates source timestamps to detected_at (no Date.now fabrication)', async () => {
    const t = '2026-04-08T14:00:00.000Z';
    const sql = createSignalSqlMock([
      [{ agent_id: 'a1', agent_name: 'Bot', action_count: '150', last_seen: t }],
      [{ action_id: 'act_1', agent_id: 'a1', agent_name: 'Bot', declared_goal: 'X', risk_score: '95', action_type: 'd', timestamp_start: t }],
      [{ agent_id: 'a2', agent_name: 'Bot', failure_count: '4', last_seen: t }],
      [{ agent_id: 'a3', agent_name: 'Bot', invalidation_count: '3', last_seen: t }],
    ]);
    const signals = await computeSignals('org_1', null, sql);
    const byType = Object.fromEntries(signals.map((s) => [s.type, s]));
    expect(byType.high_impact_low_oversight?.detected_at).toBe(t);
    expect(byType.autonomy_spike?.detected_at).toBe(t);
    expect(byType.repeated_failures?.detected_at).toBe(t);
    expect(byType.assumption_drift?.detected_at).toBe(t);
  });

  it('detects high_impact_low_oversight with red severity for risk >= 90', async () => {
    const sql = createSignalSqlMock([
      [],
      [{ action_id: 'act_1', agent_id: 'a1', agent_name: 'Bot', declared_goal: 'Nuke prod', risk_score: '95', action_type: 'deploy' }],
      [], [], [], [], [],
    ]);
    const signals = await computeSignals('org_1', null, sql);
    expect(signals[0].severity).toBe('red');
  });

  it('detects repeated_failures', async () => {
    const sql = createSignalSqlMock([
      [], [],
      [{ agent_id: 'a1', agent_name: 'Bot', failure_count: '4' }],
      [], [], [], [],
    ]);
    const signals = await computeSignals('org_1', null, sql);
    expect(signals[0].type).toBe('repeated_failures');
    expect(signals[0].severity).toBe('amber');
  });

  it('detects repeated_failures red severity for >5', async () => {
    const sql = createSignalSqlMock([
      [], [],
      [{ agent_id: 'a1', agent_name: 'Bot', failure_count: '8' }],
      [], [], [], [],
    ]);
    const signals = await computeSignals('org_1', null, sql);
    expect(signals[0].severity).toBe('red');
  });

  it('detects assumption_drift', async () => {
    const sql = createSignalSqlMock([
      [], [], [],
      [{ agent_id: 'a1', agent_name: 'Bot', invalidation_count: '3' }],
    ]);
    const signals = await computeSignals('org_1', null, sql);
    expect(signals[0].type).toBe('assumption_drift');
    expect(signals[0].severity).toBe('amber');
  });

  it('detects assumption_drift red for >= 4 invalidations', async () => {
    const sql = createSignalSqlMock([
      [], [], [],
      [{ agent_id: 'a1', agent_name: 'Bot', invalidation_count: '5' }],
    ]);
    const signals = await computeSignals('org_1', null, sql);
    expect(signals[0].severity).toBe('red');
  });

  it('filters by agent_id', async () => {
    const sql = createSignalSqlMock([
      [
        { agent_id: 'a1', agent_name: 'Bot1', action_count: '150' },
        { agent_id: 'a2', agent_name: 'Bot2', action_count: '120' },
      ],
      [], [], [], [], [], [],
    ]);
    const signals = await computeSignals('org_1', 'a1', sql);
    expect(signals).toHaveLength(1);
    expect(signals[0].agent_id).toBe('a1');
  });

  it('sorts red before amber', async () => {
    const sql = createSignalSqlMock([
      [{ agent_id: 'a1', agent_name: 'Bot1', action_count: '150' }],  // amber
      [{ action_id: 'act_1', agent_id: 'a1', agent_name: 'Bot1', declared_goal: 'X', risk_score: '95', action_type: 'deploy' }],  // red
      [], [], [], [], [],
    ]);
    const signals = await computeSignals('org_1', null, sql);
    expect(signals.length).toBeGreaterThanOrEqual(2);
    expect(signals[0].severity).toBe('red');
  });

  it('detects stale_assumption', async () => {
    const sql = createSignalSqlMock([
      [], [], [], [],
      [{ assumption_id: 'asm_1', assumption: 'API is stable', created_at: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString(), action_id: 'act_1', agent_id: 'a1', agent_name: 'Bot' }],
    ]);
    const signals = await computeSignals('org_1', null, sql);
    expect(signals[0].type).toBe('stale_assumption');
    expect(signals[0].severity).toBe('amber');
  });

  it('detects stale_running_action', async () => {
    const sql = createSignalSqlMock([
      [], [], [], [], [],
      [{ action_id: 'act_1', agent_id: 'a1', agent_name: 'Bot', declared_goal: 'Long task', timestamp_start: new Date(Date.now() - 10 * 60 * 60 * 1000).toISOString(), risk_score: '50' }],
    ]);
    const signals = await computeSignals('org_1', null, sql);
    expect(signals[0].type).toBe('stale_running_action');
    expect(signals[0].severity).toBe('amber');
  });

  it('detects agent_silent: amber when idle, red while holding a task', async () => {
    // stalePresence is now the 7th Promise.all query (index 6). The SQL bounds
    // silence to a recent 10m..48h window so weeks-dead agents stop firing; this
    // covers the JS mapping (severity + detected_at) for rows the query returns.
    const t = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const sql = createSignalSqlMock([
      [], [], [], [], [], [],
      [
        { agent_id: 'a1', agent_name: 'Idle', last_heartbeat_at: t, current_task_id: null, status: 'online' },
        { agent_id: 'a2', agent_name: 'Busy', last_heartbeat_at: t, current_task_id: 'act_x', status: 'online' },
      ],
    ]);
    const signals = await computeSignals('org_1', null, sql);
    const byAgent = Object.fromEntries(signals.map((s) => [s.agent_id, s]));
    expect(byAgent.a1.type).toBe('agent_silent');
    expect(byAgent.a1.severity).toBe('amber');
    expect(byAgent.a2.severity).toBe('red');
    expect(byAgent.a1.detected_at).toBe(t);
  });
});
