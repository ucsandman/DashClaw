import { describe, it, expect, vi } from 'vitest';
import { signalDismissKey } from '@/lib/signal-hash';

// Two dismissal defects that made the muted set wrong rather than merely stale:
//
//   1. mcp_degraded is minted once per MCP SERVER, but its dismiss key reduced
//      to (type, agent) — so muting one server muted every other degraded
//      server, and the mute stopped matching as soon as a different agent's
//      decision row was the one that reported the server.
//   2. computeSignals filled the `muted` sink BEFORE applying the agent_id
//      post-filter, so an agent-scoped read listed (and offered Restore on)
//      other agents' dismissals.

const mockListDismissKeys = vi.fn(async () => []);
vi.mock('@/lib/repositories/signal-dismissals.repository', () => ({
  listDismissKeys: (...a) => mockListDismissKeys(...a),
  addDismissals: vi.fn(),
}));

const { computeSignals } = await import('@/lib/signals.js');

// Routes tagged-template calls by QUERY TEXT (same approach as
// signals-intel.test.js): the signal queries run in one Promise.all, so call
// order is not stable enough to route by index.
function makeSql({ stalledSessions = [], recentMcpDecisions = [] } = {}) {
  const fn = function (strings) {
    const text = strings.join(' ');
    if (text.includes('DASHCLAW_AUTONOMY_SPIKE_THRESHOLD')) return Promise.resolve([]);
    if (text.includes('agent_sessions')) return Promise.resolve(stalledSessions);
    if (text.includes('guard_decisions') && text.includes("'30 minutes'")) {
      return Promise.resolve(recentMcpDecisions);
    }
    return Promise.resolve([]);
  };
  fn.query = vi.fn(async () => []);
  return fn;
}

// A guard_decisions row reporting one degraded MCP server.
function mcpRow({ id, agent_id, server, created_at = '2026-08-14T10:00:00.000Z' }) {
  return {
    id,
    agent_id,
    context: JSON.stringify({ intel: { mcp: { healthy: false, server, status: 'timeout', error: null } } }),
    created_at,
  };
}

const TWO_SERVERS = [
  mcpRow({ id: 'dec_1', agent_id: 'agent_a', server: 'github-mcp' }),
  mcpRow({ id: 'dec_2', agent_id: 'agent_b', server: 'jira-mcp' }),
];

describe('mcp_degraded dismiss key', () => {
  it('emits one signal per server, each carrying its server name', async () => {
    const signals = await computeSignals('org_1', null, makeSql({ recentMcpDecisions: TWO_SERVERS }));
    const mcp = signals.filter((s) => s.type === 'mcp_degraded');
    expect(mcp.map((s) => s.mcp_server).sort()).toEqual(['github-mcp', 'jira-mcp']);
  });

  // The collision: both servers reduced to `mcp_degraded:<agent>::::`.
  it('mutes only the dismissed server, not every degraded server', async () => {
    const baseline = await computeSignals('org_1', null, makeSql({ recentMcpDecisions: TWO_SERVERS }));
    const github = baseline.find((s) => s.mcp_server === 'github-mcp');
    expect(github).toBeTruthy();

    mockListDismissKeys.mockResolvedValueOnce([signalDismissKey(github)]);
    const after = await computeSignals('org_1', null, makeSql({ recentMcpDecisions: TWO_SERVERS }));

    const remaining = after.filter((s) => s.type === 'mcp_degraded');
    expect(remaining).toHaveLength(1);
    expect(remaining[0].mcp_server).toBe('jira-mcp');
  });

  // The churn: agent_id is whichever decision row happened to observe the
  // server first (ORDER BY created_at DESC LIMIT 20), so it changes on its own.
  it('stays muted when a different agent is the one reporting the server', async () => {
    const seenByA = [mcpRow({ id: 'dec_1', agent_id: 'agent_a', server: 'github-mcp' })];
    const seenByB = [mcpRow({ id: 'dec_9', agent_id: 'agent_zzz', server: 'github-mcp', created_at: '2026-08-14T11:30:00.000Z' })];

    const baseline = await computeSignals('org_1', null, makeSql({ recentMcpDecisions: seenByA }));
    const key = signalDismissKey(baseline.find((s) => s.type === 'mcp_degraded'));

    mockListDismissKeys.mockResolvedValueOnce([key]);
    const later = await computeSignals('org_1', null, makeSql({ recentMcpDecisions: seenByB }));
    expect(later.find((s) => s.type === 'mcp_degraded')).toBeUndefined();
  });

  // Persisted keys are the storage format: changing the join for any other
  // type would silently orphan every dismissal row already in the table.
  it('leaves the key format of every other signal type byte-identical', () => {
    expect(signalDismissKey({
      type: 'agent_silent', agent_id: 'a1', detected_at: '2026-08-14T10:00:00.000Z',
    })).toBe('agent_silent:a1::::2026-08-14T10:00:00.000Z');

    expect(signalDismissKey({ type: 'autonomy_spike', agent_id: 'a1', detected_at: '2026-08-14T10:00:00.000Z' }))
      .toBe('autonomy_spike:a1::::');

    expect(signalDismissKey({
      type: 'high_impact_low_oversight', agent_id: 'a2', action_id: 'act_1', detected_at: '2026-08-14T10:00:00.000Z',
    })).toBe('high_impact_low_oversight:a2:act_1:::2026-08-14T10:00:00.000Z');

    expect(signalDismissKey({ type: 'assumption_drift', agent_id: 'a3', assumption_id: 'asm_1' }))
      .toBe('assumption_drift:a3:::asm_1:');

    // mcp_degraded is the one that moves: server in the last slot, no agent.
    expect(signalDismissKey({ type: 'mcp_degraded', agent_id: 'a1', mcp_server: 'github-mcp', detected_at: '2026-08-14T10:00:00.000Z' }))
      .toBe('mcp_degraded:::::github-mcp');
  });
});

describe('computeSignals muted sink honours the agent filter', () => {
  const stalled = (agentId, sessionId) => ({
    agent_id: agentId,
    stalled_count: 1,
    oldest_activity: new Date(Date.now() - 5 * 3600 * 1000).toISOString(),
    sample_session_id: sessionId,
  });

  it('excludes other agents dismissals from the muted list', async () => {
    const rows = [stalled('agent_a', 'sess_a'), stalled('agent_b', 'sess_b')];

    const baseline = await computeSignals('org_1', null, makeSql({ stalledSessions: rows }));
    expect(baseline.filter((s) => s.type === 'session_stalled')).toHaveLength(2);
    const keys = baseline.filter((s) => s.type === 'session_stalled').map(signalDismissKey);

    mockListDismissKeys.mockResolvedValueOnce(keys);
    const muted = [];
    const signals = await computeSignals('org_1', 'agent_a', makeSql({ stalledSessions: rows }), muted);

    expect(signals).toEqual([]);
    expect(muted).toHaveLength(1);
    expect(muted[0].agent_id).toBe('agent_a');
  });

  it('still reports the filtered agent own dismissals', async () => {
    const rows = [stalled('agent_a', 'sess_a'), stalled('agent_b', 'sess_b')];
    const baseline = await computeSignals('org_1', null, makeSql({ stalledSessions: rows }));
    const mine = baseline.find((s) => s.type === 'session_stalled' && s.agent_id === 'agent_a');

    mockListDismissKeys.mockResolvedValueOnce([signalDismissKey(mine)]);
    const muted = [];
    await computeSignals('org_1', 'agent_a', makeSql({ stalledSessions: rows }), muted);

    expect(muted.map((m) => m.agent_id)).toEqual(['agent_a']);
  });
});
