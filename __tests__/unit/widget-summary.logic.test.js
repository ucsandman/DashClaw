import { describe, it, expect } from 'vitest';
import {
  computeWidgetPosture,
  sanitizeRecentAction,
  pickTopSignals,
  countSignals,
  countActiveAgents,
  buildWidgetSummary,
  truncate,
} from '@/lib/widget/summary.js';

const SENSITIVE = [
  'reasoning',
  'authorization_scope',
  'artifacts_created',
  'side_effects',
  'model',
  'cost_estimate',
  'error_message',
];

describe('computeWidgetPosture', () => {
  it('elevated on a red signal', () => {
    expect(computeWidgetPosture({ redSignals: 1 })).toBe('elevated');
  });
  it('elevated on a blocked action', () => {
    expect(computeWidgetPosture({ blockedActions: 2 })).toBe('elevated');
  });
  it('elevated on a high-risk action', () => {
    expect(computeWidgetPosture({ highRiskActions: 1 })).toBe('elevated');
  });
  it('approval when only pending', () => {
    expect(computeWidgetPosture({ pendingApprovals: 3 })).toBe('approval');
  });
  it('active when only running', () => {
    expect(computeWidgetPosture({ runningActions: 2 })).toBe('active');
  });
  it('calm when nothing is happening', () => {
    expect(computeWidgetPosture({})).toBe('calm');
  });
  it('precedence: elevated outranks approval', () => {
    expect(computeWidgetPosture({ redSignals: 1, pendingApprovals: 5 })).toBe('elevated');
  });
  it('precedence: approval outranks active', () => {
    expect(computeWidgetPosture({ pendingApprovals: 1, runningActions: 9 })).toBe('approval');
  });
  it('coerces string inputs (pg numeric strings)', () => {
    expect(computeWidgetPosture({ runningActions: '4' })).toBe('active');
  });
});

describe('truncate', () => {
  it('returns short strings unchanged', () => {
    expect(truncate('hello', 80)).toBe('hello');
  });
  it('collapses internal whitespace/newlines', () => {
    expect(truncate('a\n\n b   c', 80)).toBe('a b c');
  });
  it('caps length including the ellipsis', () => {
    const out = truncate('x'.repeat(200), 80);
    expect(out.length).toBeLessThanOrEqual(80);
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('sanitizeRecentAction', () => {
  const raw = {
    action_id: 'act_1',
    agent_id: 'a1',
    agent_name: 'Agent One',
    action_type: 'email_send',
    declared_goal: 'send the quarterly update',
    output_summary: 'Sent the email',
    status: 'completed',
    risk_score: '42',
    outcome_status: 'completed',
    timestamp_start: '2026-06-06T00:00:00Z',
    reasoning: 'SECRET chain of thought',
    authorization_scope: 'scope',
    artifacts_created: ['a.txt'],
    side_effects: ['sent'],
    model: 'opus',
    cost_estimate: '9.99',
    error_message: 'boom',
  };

  it('exposes exactly the whitelisted keys', () => {
    const out = sanitizeRecentAction(raw);
    expect(Object.keys(out).sort()).toEqual([
      'actionId',
      'actionType',
      'agentName',
      'outcomeStatus',
      'riskScore',
      'status',
      'summary',
      'ts',
    ]);
  });

  it('omits every sensitive key', () => {
    const out = sanitizeRecentAction(raw);
    for (const k of SENSITIVE) {
      expect(out).not.toHaveProperty(k);
    }
  });

  it('truncates summary to <=80 and collapses newlines', () => {
    expect(sanitizeRecentAction({ output_summary: 'line1\nline2  with   spaces' }).summary).toBe(
      'line1 line2 with spaces',
    );
    const long = sanitizeRecentAction({ declared_goal: 'y'.repeat(300) });
    expect(long.summary.length).toBeLessThanOrEqual(80);
  });

  it('falls back to declared_goal when no output_summary', () => {
    expect(sanitizeRecentAction({ declared_goal: 'the goal' }).summary).toBe('the goal');
  });

  it('coerces risk score and yields null when absent', () => {
    expect(sanitizeRecentAction({ risk_score: '42' }).riskScore).toBe(42);
    expect(sanitizeRecentAction({}).riskScore).toBeNull();
  });

  it('agentName falls back to agent_id', () => {
    expect(sanitizeRecentAction({ agent_id: 'a9' }).agentName).toBe('a9');
  });
});

describe('pickTopSignals', () => {
  const signals = [
    { severity: 'amber', label: 'A', detail: 'a', agent_id: 'x', detected_at: 't1' },
    { severity: 'red', label: 'R', detail: 'r'.repeat(300), agent_id: 'y', detected_at: 't2' },
    { severity: 'amber', label: 'B', detail: 'b', detected_at: 't3' },
  ];

  it('puts red first and caps at n', () => {
    const top = pickTopSignals(signals, 2);
    expect(top).toHaveLength(2);
    expect(top[0].severity).toBe('red');
    expect(top[0].label).toBe('R');
  });

  it('truncates detail to <=100', () => {
    expect(pickTopSignals(signals, 1)[0].detail.length).toBeLessThanOrEqual(100);
  });

  it('returns [] for no signals', () => {
    expect(pickTopSignals([], 2)).toEqual([]);
  });
});

describe('countSignals', () => {
  it('counts red / amber / total', () => {
    expect(countSignals([{ severity: 'red' }, { severity: 'amber' }, { severity: 'amber' }])).toEqual({
      red: 1,
      amber: 2,
      total: 3,
    });
  });
});

describe('countActiveAgents', () => {
  const now = 1_700_000_000_000;
  it('counts only agents active within the window', () => {
    const agents = [
      { last_active: new Date(now - 60_000).toISOString() }, // 1 min ago
      { last_active: new Date(now - 60 * 60_000).toISOString() }, // 1 h ago (stale)
      { last_active: null },
      {},
    ];
    expect(countActiveAgents(agents, now)).toBe(1);
  });
});

describe('buildWidgetSummary', () => {
  const now = Date.UTC(2026, 5, 6, 12, 0, 0);

  it('composes the documented shape and coerces numeric strings', () => {
    const out = buildWidgetSummary({
      recent: {
        actions: [{ action_id: 'a', output_summary: 'hi', risk_score: '10', reasoning: 'secret' }],
        stats: { running: '2' },
      },
      pendingApprovals: 0,
      signals: [{ severity: 'amber', label: 'L', detail: 'd' }],
      spendUsd: 1.5,
      agents: [{ last_active: new Date(now - 1000).toISOString() }],
      now,
    });

    expect(Object.keys(out).sort()).toEqual([
      'generatedAt',
      'metrics',
      'pendingApprovals',
      'recentActions',
      'signals',
      'status',
      'topSignals',
    ]);
    expect(out.status).toBe('active'); // running 2 (and an amber signal)
    expect(out.metrics).toEqual({ activeAgents: 1, pendingApprovals: 0, elevated: 1, spend: 1.5 });
    expect(out.signals).toEqual({ red: 0, amber: 1, total: 1 });
    expect(out.recentActions).toHaveLength(1);
    expect(out.recentActions[0]).not.toHaveProperty('reasoning');
    expect(out.generatedAt).toBe(new Date(now).toISOString());
  });

  it('a red signal makes posture elevated over a pending approval', () => {
    const out = buildWidgetSummary({
      recent: { actions: [], stats: {} },
      pendingApprovals: 4,
      signals: [{ severity: 'red' }],
      spendUsd: null,
      agents: [],
      now,
    });
    expect(out.status).toBe('elevated');
    expect(out.metrics.spend).toBeNull();
    expect(out.metrics.pendingApprovals).toBe(4);
  });

  it('caps recentActions at 10', () => {
    const actions = Array.from({ length: 25 }, (_, i) => ({ action_id: `a${i}`, output_summary: 's' }));
    const out = buildWidgetSummary({
      recent: { actions, stats: {} },
      pendingApprovals: 0,
      signals: [],
      spendUsd: null,
      agents: [],
      now,
    });
    expect(out.recentActions.length).toBeLessThanOrEqual(10);
  });

  it('exposes a sanitized pendingApprovals list from pendingActions', () => {
    const out = buildWidgetSummary({
      recent: { actions: [], stats: {} },
      pendingApprovals: 2,
      pendingActions: [
        {
          action_id: 'p1',
          agent_name: 'bot',
          action_type: 'email_send',
          declared_goal: 'send refund',
          status: 'pending_approval',
          reasoning: 'secret chain of thought',
        },
      ],
      signals: [],
      spendUsd: null,
      agents: [],
      now,
    });
    expect(out.pendingApprovals).toHaveLength(1);
    expect(out.pendingApprovals[0].actionId).toBe('p1');
    expect(out.pendingApprovals[0]).not.toHaveProperty('reasoning');
    expect(out.metrics.pendingApprovals).toBe(2);
  });
});
