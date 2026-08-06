import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mocks for modules imported transitively by computeSignals ──────────
const { mockFloodState, mockCost } = vi.hoisted(() => ({
  mockFloodState: vi.fn(async () => ({})),
  mockCost: vi.fn(async () => ({
    attribution: { attributed_count: 100, total_count: 100, coverage_pct: 100 },
  })),
}));

vi.mock('../../app/lib/approval-flood', () => ({ getFloodState: mockFloodState, FLEET_KEY: '_fleet' }));
vi.mock('../../app/lib/repositories/actions.repository', () => ({ getCostAggregation: mockCost }));
vi.mock('../../app/lib/db.js', () => ({ getSql: vi.fn() }));
vi.mock('../../app/lib/webhooks.js', () => ({ fireWebhooksForOrg: vi.fn() }));
vi.mock('../../app/lib/notifications.js', () => ({ sendSignalAlertEmail: vi.fn() }));
vi.mock('../../app/lib/audit.js', () => ({ logActivity: vi.fn() }));
vi.mock('../../app/lib/timing-safe.js', () => ({ timingSafeCompare: vi.fn() }));
vi.mock('../../app/lib/events.js', () => ({ EVENTS: {}, publishOrgEvent: vi.fn() }));
vi.mock('../../app/lib/repositories/signals.repository.js', () => ({
  getExistingSignalHashes: vi.fn(),
  upsertSignalSnapshots: vi.fn(),
}));

import { computeSignals } from '../../app/lib/signals';

beforeEach(() => vi.clearAllMocks());

// ── SQL mock factory ───────────────────────────────────────────────────────────
//
// Routes tagged-template calls by QUERY TEXT, not call index. The signals
// wave runs all queries in a single Promise.all; call order is not guaranteed
// across JS engine implementations, so index routing is fragile. Text routing
// is stable as long as the query contains its distinguishing fragment.
//
// Distinguishing fragments (from app/lib/signals.ts):
//   agent_sessions     → stalledSessions   (session_stalled)
//   INTERVAL '1 hour' + LIMIT 20           → recentDecisions  (branch_stale)
//   INTERVAL '30 minutes'                  → recentMcpDecisions (mcp_degraded)
//   decision IN ('block', 'warn')          → greenDecisions   (green_insufficient)
//   DASHCLAW_AUTONOMY_SPIKE_THRESHOLD      → settings row (config wave)
//   everything else                        → []
//
function makeIntelSql({ stalledSessions = [], recentDecisions = [], recentMcpDecisions = [], greenDecisions = [], executedDespiteRows = [] } = {}) {
  const fn = function (strings, ...values) {
    const text = strings.join(' ');

    if (text.includes('DASHCLAW_AUTONOMY_SPIKE_THRESHOLD')) {
      return Promise.resolve([]);
    }
    // executed_despite_block: uniquely selects executed_despite IS NOT NULL.
    if (text.includes('executed_despite IS NOT NULL')) {
      return Promise.resolve(executedDespiteRows).catch(() => null);
    }
    if (text.includes('agent_sessions')) {
      return Promise.resolve(stalledSessions).catch(() => null);
    }
    // green_insufficient: uniquely has `decision IN ('block', 'warn')` — check before
    // the generic '1 hour' guard-decisions branch to avoid overlap.
    if (text.includes("decision IN ('block', 'warn')")) {
      return Promise.resolve(greenDecisions).catch(() => null);
    }
    // branch_stale: guard_decisions + 1-hour window + LIMIT 20 (no decision IN filter)
    if (text.includes('guard_decisions') && text.includes("'1 hour'") && text.includes('LIMIT 20')) {
      return Promise.resolve(recentDecisions).catch(() => null);
    }
    // mcp_degraded: guard_decisions + 30-minute window
    if (text.includes('guard_decisions') && text.includes("'30 minutes'")) {
      return Promise.resolve(recentMcpDecisions).catch(() => null);
    }

    // All other queries return empty (autonomy spikes, high-impact, etc.)
    return Promise.resolve([]);
  };

  // sql.query (parameterized form) — not used by the intel queries but required
  // by the SqlClient type contract.
  fn.query = vi.fn(async () => []);
  return fn;
}

// Helper: a guard_decisions row whose context contains the given intel object.
function makeDecision({ id = 'dec_1', agent_id = 'agent_x', intel, reason, created_at = '2026-06-12T10:00:00Z' } = {}) {
  return {
    id,
    agent_id,
    context: JSON.stringify({ intel }),
    reason: reason ?? null,
    created_at,
  };
}

// ── session_stalled ────────────────────────────────────────────────────────────
describe('session_stalled signal', () => {
  // now - 2.5 hours
  const last2h30m = new Date(Date.now() - 2.5 * 3600 * 1000).toISOString();
  // now - 4.5 hours
  const last4h30m = new Date(Date.now() - 4.5 * 3600 * 1000).toISOString();

  it('emits amber when session stalled for 2–3h (< 4h)', async () => {
    const sql = makeIntelSql({
      stalledSessions: [{ id: 'sess_1', agent_id: 'agent_a', status: 'running', last_activity: last2h30m }],
    });
    const signals = await computeSignals('org1', null, sql);
    const s = signals.find((sig) => sig.type === 'session_stalled');
    expect(s).toBeTruthy();
    expect(s.severity).toBe('amber');
    expect(s.agent_id).toBe('agent_a');
    expect(s.session_id).toBe('sess_1');
  });

  it('emits red when session stalled 4h or more', async () => {
    const sql = makeIntelSql({
      stalledSessions: [{ id: 'sess_2', agent_id: 'agent_b', status: 'running', last_activity: last4h30m }],
    });
    const signals = await computeSignals('org1', null, sql);
    const s = signals.find((sig) => sig.type === 'session_stalled');
    expect(s).toBeTruthy();
    expect(s.severity).toBe('red');
    expect(s.agent_id).toBe('agent_b');
  });

  it('emits no session_stalled signal when no stalled sessions', async () => {
    const sql = makeIntelSql({ stalledSessions: [] });
    const signals = await computeSignals('org1', null, sql);
    expect(signals.find((sig) => sig.type === 'session_stalled')).toBeUndefined();
  });

  it('signal carries detected_at from last_activity', async () => {
    const sql = makeIntelSql({
      stalledSessions: [{ id: 'sess_3', agent_id: 'agent_c', status: 'running', last_activity: last2h30m }],
    });
    const signals = await computeSignals('org1', null, sql);
    const s = signals.find((sig) => sig.type === 'session_stalled');
    expect(s.detected_at).toBe(last2h30m);
  });
});

// ── branch_stale ───────────────────────────────────────────────────────────────
describe('branch_stale signal', () => {
  it('emits amber when branch is stale but < 5 commits behind', async () => {
    const dec = makeDecision({
      agent_id: 'agent_d',
      intel: { branch: { freshness: 'stale', commits_behind: 3, name: 'feat/x' } },
    });
    const sql = makeIntelSql({ recentDecisions: [dec] });
    const signals = await computeSignals('org1', null, sql);
    const s = signals.find((sig) => sig.type === 'branch_stale');
    expect(s).toBeTruthy();
    expect(s.severity).toBe('amber');
    expect(s.agent_id).toBe('agent_d');
  });

  it('emits red when branch is 5 or more commits behind', async () => {
    const dec = makeDecision({
      agent_id: 'agent_e',
      intel: { branch: { freshness: 'stale', commits_behind: 5, name: 'feat/y' } },
    });
    const sql = makeIntelSql({ recentDecisions: [dec] });
    const signals = await computeSignals('org1', null, sql);
    const s = signals.find((sig) => sig.type === 'branch_stale');
    expect(s).toBeTruthy();
    expect(s.severity).toBe('red');
    expect(s.agent_id).toBe('agent_e');
  });

  it('does not emit branch_stale when freshness is not stale', async () => {
    const dec = makeDecision({
      agent_id: 'agent_f',
      intel: { branch: { freshness: 'fresh', commits_behind: 10, name: 'main' } },
    });
    const sql = makeIntelSql({ recentDecisions: [dec] });
    const signals = await computeSignals('org1', null, sql);
    expect(signals.find((sig) => sig.type === 'branch_stale')).toBeUndefined();
  });

  it('deduplicates — one signal per agent even with multiple decisions', async () => {
    const dec1 = makeDecision({ id: 'dec_1', agent_id: 'agent_g', intel: { branch: { freshness: 'stale', commits_behind: 6 } } });
    const dec2 = makeDecision({ id: 'dec_2', agent_id: 'agent_g', intel: { branch: { freshness: 'stale', commits_behind: 7 } } });
    const sql = makeIntelSql({ recentDecisions: [dec1, dec2] });
    const signals = await computeSignals('org1', null, sql);
    expect(signals.filter((sig) => sig.type === 'branch_stale')).toHaveLength(1);
  });

  it('emits no branch_stale signal when no recent decisions', async () => {
    const sql = makeIntelSql({ recentDecisions: [] });
    const signals = await computeSignals('org1', null, sql);
    expect(signals.find((sig) => sig.type === 'branch_stale')).toBeUndefined();
  });
});

// ── observe_mode ───────────────────────────────────────────────────────────────
// Rides on the same recentDecisions batch as branch_stale. The agent's LATEST
// decision (rows are newest-first) decides its posture.
describe('observe_mode signal', () => {
  const decisionWithMode = (id, agent_id, mode, created_at) => ({
    id,
    agent_id,
    context: JSON.stringify(mode === undefined ? {} : { enforcement_mode: mode }),
    reason: null,
    created_at,
  });

  it('emits red for an agent whose latest decision reports observe (F0: standing unenforced posture is never amber)', async () => {
    const sql = makeIntelSql({
      recentDecisions: [decisionWithMode('dec_1', 'agent_obs', 'observe', '2026-06-12T10:00:00Z')],
    });
    const signals = await computeSignals('org1', null, sql);
    const s = signals.find((sig) => sig.type === 'observe_mode');
    expect(s).toBeTruthy();
    expect(s.severity).toBe('red');
    expect(s.agent_id).toBe('agent_obs');
    expect(s.label).toContain('observe mode');
  });

  it('does not emit when the latest decision is enforce, even with older observe rows', async () => {
    // Newest-first ordering: the enforce row is the agent's current posture.
    const sql = makeIntelSql({
      recentDecisions: [
        decisionWithMode('dec_2', 'agent_flip', 'enforce', '2026-06-12T10:05:00Z'),
        decisionWithMode('dec_1', 'agent_flip', 'observe', '2026-06-12T10:00:00Z'),
      ],
    });
    const signals = await computeSignals('org1', null, sql);
    expect(signals.find((sig) => sig.type === 'observe_mode')).toBeUndefined();
  });

  it('treats decisions without the field as unreported, never observe', async () => {
    const sql = makeIntelSql({
      recentDecisions: [decisionWithMode('dec_1', 'agent_sdk', undefined, '2026-06-12T10:00:00Z')],
    });
    const signals = await computeSignals('org1', null, sql);
    expect(signals.find((sig) => sig.type === 'observe_mode')).toBeUndefined();
  });

  it('one signal per agent, multiple observe agents each get one', async () => {
    const sql = makeIntelSql({
      recentDecisions: [
        decisionWithMode('dec_3', 'agent_a', 'observe', '2026-06-12T10:02:00Z'),
        decisionWithMode('dec_2', 'agent_a', 'observe', '2026-06-12T10:01:00Z'),
        decisionWithMode('dec_1', 'agent_b', 'observe', '2026-06-12T10:00:00Z'),
      ],
    });
    const signals = await computeSignals('org1', null, sql);
    expect(signals.filter((sig) => sig.type === 'observe_mode')).toHaveLength(2);
  });
});

// ── executed_despite_block ─────────────────────────────────────────────────────
// F0 (governance gap audit 2026-08-05): action rows where PostToolUse
// witnessed a block/require_approval verdict fail to stop execution.
describe('executed_despite_block signal', () => {
  const witnessRow = (action_id, agent_id, executed_despite, declared_goal = 'delete the canary dir') => ({
    action_id,
    agent_id,
    agent_name: agent_id,
    declared_goal,
    executed_despite,
    timestamp_start: '2026-08-06T10:00:00Z',
  });

  it('emits red per witnessed row, carrying action_id and agent_id', async () => {
    const sql = makeIntelSql({
      executedDespiteRows: [
        witnessRow('act_1', 'agent_obs', 'block'),
        witnessRow('act_2', 'agent_obs', 'require_approval'),
      ],
    });
    const signals = await computeSignals('org1', null, sql);
    const s = signals.filter((sig) => sig.type === 'executed_despite_block');
    expect(s).toHaveLength(2);
    expect(s.every((sig) => sig.severity === 'red')).toBe(true);
    expect(s[0].action_id).toBe('act_1');
    expect(s[0].agent_id).toBe('agent_obs');
    expect(s[0].label).toContain('block');
    expect(s[1].label).toContain('approval gate');
  });

  it('emits nothing when no rows carry the witness stamp', async () => {
    const sql = makeIntelSql({ executedDespiteRows: [] });
    const signals = await computeSignals('org1', null, sql);
    expect(signals.find((sig) => sig.type === 'executed_despite_block')).toBeUndefined();
  });
});

// ── mcp_degraded ───────────────────────────────────────────────────────────────
describe('mcp_degraded signal', () => {
  it('emits amber for degraded MCP server with non-auth_required status', async () => {
    const dec = makeDecision({
      agent_id: 'agent_h',
      intel: { mcp: { healthy: false, server: 'github-mcp', status: 'timeout', error: 'Connection timed out' } },
    });
    const sql = makeIntelSql({ recentMcpDecisions: [dec] });
    const signals = await computeSignals('org1', null, sql);
    const s = signals.find((sig) => sig.type === 'mcp_degraded');
    expect(s).toBeTruthy();
    expect(s.severity).toBe('amber');
    expect(s.agent_id).toBe('agent_h');
  });

  it('emits red when MCP status is auth_required', async () => {
    const dec = makeDecision({
      agent_id: 'agent_i',
      intel: { mcp: { healthy: false, server: 'jira-mcp', status: 'auth_required', error: null } },
    });
    const sql = makeIntelSql({ recentMcpDecisions: [dec] });
    const signals = await computeSignals('org1', null, sql);
    const s = signals.find((sig) => sig.type === 'mcp_degraded');
    expect(s).toBeTruthy();
    expect(s.severity).toBe('red');
    expect(s.agent_id).toBe('agent_i');
  });

  it('does not emit mcp_degraded when MCP server is healthy', async () => {
    const dec = makeDecision({
      agent_id: 'agent_j',
      intel: { mcp: { healthy: true, server: 'slack-mcp', status: 'ok' } },
    });
    const sql = makeIntelSql({ recentMcpDecisions: [dec] });
    const signals = await computeSignals('org1', null, sql);
    expect(signals.find((sig) => sig.type === 'mcp_degraded')).toBeUndefined();
  });

  it('deduplicates — one signal per MCP server even with multiple decisions', async () => {
    const dec1 = makeDecision({ id: 'dec_3', agent_id: 'agent_k', intel: { mcp: { healthy: false, server: 'tools-mcp', status: 'timeout' } } });
    const dec2 = makeDecision({ id: 'dec_4', agent_id: 'agent_l', intel: { mcp: { healthy: false, server: 'tools-mcp', status: 'timeout' } } });
    const sql = makeIntelSql({ recentMcpDecisions: [dec1, dec2] });
    const signals = await computeSignals('org1', null, sql);
    expect(signals.filter((sig) => sig.type === 'mcp_degraded')).toHaveLength(1);
  });

  it('emits no mcp_degraded signal when no recent MCP decisions', async () => {
    const sql = makeIntelSql({ recentMcpDecisions: [] });
    const signals = await computeSignals('org1', null, sql);
    expect(signals.find((sig) => sig.type === 'mcp_degraded')).toBeUndefined();
  });
});

// ── green_insufficient ─────────────────────────────────────────────────────────
describe('green_insufficient signal', () => {
  it('emits red when a block/warn decision cites Green contract', async () => {
    const dec = makeDecision({
      agent_id: 'agent_m',
      reason: 'Green contract not met: required full but observed none',
      intel: { green: { observed_level: 'none' } },
    });
    const sql = makeIntelSql({ greenDecisions: [dec] });
    const signals = await computeSignals('org1', null, sql);
    const s = signals.find((sig) => sig.type === 'green_insufficient');
    expect(s).toBeTruthy();
    expect(s.severity).toBe('red');
    expect(s.agent_id).toBe('agent_m');
  });

  it('always emits red — never amber', async () => {
    const dec = makeDecision({
      agent_id: 'agent_n',
      reason: 'Green contract insufficient',
      intel: { green: { observed_level: 'partial' } },
    });
    const sql = makeIntelSql({ greenDecisions: [dec] });
    const signals = await computeSignals('org1', null, sql);
    const s = signals.find((sig) => sig.type === 'green_insufficient');
    expect(s.severity).toBe('red');
  });

  it('does not emit green_insufficient when reason does not mention Green contract', async () => {
    const dec = makeDecision({
      agent_id: 'agent_o',
      reason: 'Policy rule: require_approval triggered',
      intel: { green: { observed_level: 'full' } },
    });
    const sql = makeIntelSql({ greenDecisions: [dec] });
    const signals = await computeSignals('org1', null, sql);
    expect(signals.find((sig) => sig.type === 'green_insufficient')).toBeUndefined();
  });

  it('deduplicates — one signal per agent even with multiple decisions', async () => {
    const dec1 = makeDecision({ id: 'dec_5', agent_id: 'agent_p', reason: 'Green contract insufficient', intel: { green: {} } });
    const dec2 = makeDecision({ id: 'dec_6', agent_id: 'agent_p', reason: 'Green contract not met', intel: { green: {} } });
    const sql = makeIntelSql({ greenDecisions: [dec1, dec2] });
    const signals = await computeSignals('org1', null, sql);
    expect(signals.filter((sig) => sig.type === 'green_insufficient')).toHaveLength(1);
  });

  it('emits no green_insufficient signal when no relevant decisions', async () => {
    const sql = makeIntelSql({ greenDecisions: [] });
    const signals = await computeSignals('org1', null, sql);
    expect(signals.find((sig) => sig.type === 'green_insufficient')).toBeUndefined();
  });

  it('label reflects observed_level from context intel', async () => {
    const dec = makeDecision({
      agent_id: 'agent_q',
      reason: 'Green contract not satisfied',
      intel: { green: { observed_level: 'smoke' } },
    });
    const sql = makeIntelSql({ greenDecisions: [dec] });
    const signals = await computeSignals('org1', null, sql);
    const s = signals.find((sig) => sig.type === 'green_insufficient');
    expect(s.label).toContain('smoke');
  });
});
