import { describe, it, expect } from 'vitest';
import {
  DAY_MS,
  weekBounds,
  weeklyFromCumulative,
  isProbe,
  attachOutcomes,
  markRepeats,
  summarizeOutcomes,
  replayWhatIf,
  buildWeeks,
  runChecks,
  sabotage,
  renderMarkdown,
} from '../../scripts/lib/fleet-replay.mjs';

const START = Date.UTC(2026, 0, 5);
const at = (day) => new Date(START + day * DAY_MS).toISOString();
const ms = (day) => START + day * DAY_MS;

const ask = (id, day, over = {}) => ({
  id,
  decision: 'require_approval',
  created_at: at(day),
  agent_id: 'a1',
  action_type: 'send',
  risk_score: 75,
  matched_policies: ['p1'],
  declared_goal: 'send the weekly note',
  approvedMs: null,
  deniedMs: null,
  ...over,
});

const OLD = '2025-01-01T00:00:00.000Z';
const envelope = {
  id: 'p1', name: 'Asks', policy_type: 'require_approval', active: 1, created_at: OLD, updated_at: OLD,
  rules: JSON.stringify({ action_types: ['send', 'post'] }),
};
const other = { id: 'p2', name: 'Other', policy_type: 'protected_path', active: 1, created_at: OLD, updated_at: OLD, rules: '{}' };
const threshold = {
  id: 'p3', name: 'Risk', policy_type: 'risk_threshold', active: 1, created_at: OLD, updated_at: OLD,
  rules: JSON.stringify({ threshold: 70, action: 'require_approval' }),
};

// Twelve "send" asks, one a day; later sends on days 20 and 25; two "post" asks, the first denied.
// The denial matters: it keeps the policy as a whole under the 95% bar, so the engine carves the
// one always-approved type out instead of deactivating the policy.
const fleet = (approvedOn) => [
  ...Array.from({ length: 12 }, (_, k) => ask(`s${k}`, k + 0.5, { approvedMs: approvedOn == null ? null : ms(approvedOn(k)) })),
  ask('s20', 20.5),
  ask('s25', 25.5),
  ask('post3', 3.5, { action_type: 'post', deniedMs: ms(3.6) }),
  ask('post21', 21.5, { action_type: 'post' }),
];
const run = (asks, policies) => replayWhatIf({ asks, policies, startMs: START, endMs: ms(28), windowDays: 30 });

describe('fleet-replay time buckets', () => {
  it('weekBounds returns weeks+1 ascending boundaries ending at the end', () => {
    const b = weekBounds(ms(14), 2);
    expect(b).toEqual([START, ms(7), ms(14)]);
  });

  it('weeklyFromCumulative turns "total since each boundary" into per-week counts', () => {
    expect(weeklyFromCumulative([900, 500, 100])).toEqual([400, 400]);
  });

  it('isProbe matches only the catastrophe-floor probe: its goal prefix and no agent', () => {
    expect(isProbe({ agent_id: null, declared_goal: 'Automated probe: force push to main' })).toBe(true);
    expect(isProbe({ agent_id: 'cinder', declared_goal: 'Automated probe: force push to main' })).toBe(false);
    expect(isProbe({ agent_id: null, declared_goal: 'delete the old branch' })).toBe(false);
  });
});

describe('attachOutcomes', () => {
  it('joins action records by guard_decision_id and reads approvals and HITL denials', () => {
    const asks = [ask('d1', 1), ask('d2', 2), ask('d3', 3)];
    const actions = [
      { guard_decision_id: 'd1', approved_by: 'wes', approved_at: at(1.2), created_at: at(1) },
      { guard_decision_id: 'd2', approved_by: null, reasoning: 'no. [HITL Decision: DENY by wes]', outcome_at: at(2.3), created_at: at(2) },
      { guard_decision_id: 'zzz', approved_by: 'wes', approved_at: at(5), created_at: at(5) },
    ];
    const out = attachOutcomes(asks, actions);
    expect(out.map((a) => [a.id, a.hasRecord, a.approvedMs, a.deniedMs])).toEqual([
      ['d1', true, ms(1.2), null],
      ['d2', true, null, ms(2.3)],
      ['d3', false, null, null],
    ]);
  });

  it('records until when the request stayed open: the answer, or else its expiry', () => {
    const asks = [ask('d1', 1), ask('d2', 2), ask('d3', 3)];
    const actions = [
      { guard_decision_id: 'd1', approved_by: 'wes', approved_at: at(1.2), created_at: at(1), approval_expires_at: at(1.5) },
      { guard_decision_id: 'd2', approved_by: null, created_at: at(2), approval_expires_at: at(2.5) },
    ];
    expect(attachOutcomes(asks, actions).map((a) => a.openUntilMs)).toEqual([ms(1.2), ms(2.5), null]);
  });
});

describe('markRepeats (one ask can write two guard decisions)', () => {
  const SEC = 1 / 86_400;
  const recorded = (id, day, over = {}) => ask(id, day, { hasRecord: true, openUntilMs: ms(day) + 20 * 60_000, ...over });
  const bare = (id, day, over = {}) => ask(id, day, { hasRecord: false, openUntilMs: null, ...over });

  it('marks the bare guard call that comes just before its recorded twin', () => {
    const out = markRepeats([bare('g', 1), recorded('r', 1 + 10 * SEC)]);
    expect(out.map((a) => a.repeatOf ?? null)).toEqual(['r', null]);
  });

  it('marks an ask repeated while its request was still open, and not one after it closed', () => {
    const out = markRepeats([recorded('r', 1), bare('during', 1 + 300 * SEC), bare('after', 1 + 1800 * SEC)]);
    expect(out.map((a) => a.repeatOf ?? null)).toEqual([null, 'r', null]);
  });

  it('pairs one bare call per recorded ask, the earliest', () => {
    const out = markRepeats([bare('g2', 1 + 5 * SEC), bare('g1', 1), recorded('r', 1 + 10 * SEC)]);
    expect(out.map((a) => [a.id, a.repeatOf ?? null])).toEqual([['g2', null], ['g1', 'r'], ['r', null]]);
  });

  it('leaves a bare call alone when it leads by over two minutes or the agent, type or goal differs', () => {
    const out = markRepeats([
      bare('late', 1 - 200 * SEC),
      bare('agent', 1, { agent_id: 'a2' }),
      bare('type', 1, { action_type: 'post' }),
      bare('goal', 1, { declared_goal: 'send the monthly note' }),
      recorded('r', 1 + 10 * SEC),
    ]);
    expect(out.filter((a) => a.repeatOf).map((a) => a.id)).toEqual([]);
  });

  it('never marks a probe, or asks that nothing recorded', () => {
    const out = markRepeats([
      bare('p', 1, { agent_id: null, declared_goal: 'Automated probe: drop table' }),
      bare('g', 2),
      bare('h', 2 + 5 * SEC),
    ]);
    expect(out.filter((a) => a.repeatOf)).toEqual([]);
  });
});

describe('asks, repeats and test agents', () => {
  const rows = () => [
    ask('ok', 1, { hasRecord: true, approvedMs: ms(1.1), openUntilMs: ms(1.1) }),
    ask('no', 2, { hasRecord: true, deniedMs: ms(2.1), openUntilMs: ms(2.1) }),
    ask('unanswered', 3, { hasRecord: true, openUntilMs: ms(3.1) }),
    ask('silent', 4, { hasRecord: false }),
    ask('twin', 5, { hasRecord: false, repeatOf: 'ok' }),
    ask('check', 6, { agent_id: 'deploy-check', hasRecord: true, deniedMs: ms(6.1) }),
    ask('probe', 6, { agent_id: null, declared_goal: 'Automated probe: drop table' }),
  ];

  it('summarizeOutcomes splits asks into answered, unanswered in the inbox and never opened', () => {
    expect(summarizeOutcomes(rows(), ['deploy-check'])).toEqual({
      asks: 4, approved: 1, denied: 1, unanswered: 1, neverOpened: 1, repeats: 1, tests: 1,
    });
  });

  it('buildWeeks keeps repeats and test agents out of the ask count', () => {
    const [week] = buildWeeks({
      bounds: weekBounds(ms(7), 1), weeklyDecisions: [1000], askRows: rows(), removed: new Set(), agentsPerWeek: [2], testAgents: ['deploy-check'],
    });
    expect(week).toMatchObject({ asks: 4, repeats: 1, tests: 1, probes: 1, per1000: 4, whatIfAsks: 4 });
  });

  it('runChecks accounts for every fetched row, whatever kind it is', () => {
    const d = {
      bounds: weekBounds(ms(7), 1), weeklyDecisions: [1000], typeTotals: { allow: 993, require_approval: 7 },
      askRows: rows(), apiAskTotal: 7, removed: new Set(), agentDecisionSum: 900, testAgents: ['deploy-check'],
    };
    d.weeks = buildWeeks({ ...d, agentsPerWeek: [2] });
    const checks = runChecks(d);
    expect(checks.filter((c) => !c.ok)).toEqual([]);
    expect(checks.find((c) => c.name === 'weekly_asks_sum').detail).toMatch(/7 rows placed in weeks .*7 rows fetched/);
  });
});

describe('replayWhatIf (the real loosening and tuning engines, day by day)', () => {
  it('carves an always-approved action type out on the day the proposal appears, and removes later asks of that type', () => {
    const r = run(fleet((k) => k + 0.6), [envelope, other]);
    expect(r.accepted).toEqual([
      expect.objectContaining({ rule: 'relax_policy_scope', policy_id: 'p1', action_type: 'send', dayMs: ms(10) }),
    ]);
    expect([...r.removed].sort()).toEqual(['s10', 's11', 's20', 's25']);
  });

  it('proposes nothing when nobody answered the asks', () => {
    const r = run(fleet(null), [envelope, other]);
    expect(r.accepted).toEqual([]);
    expect(r.removed.size).toBe(0);
  });

  it('uses only approvals that had happened by that day', () => {
    const r = run(fleet(() => 14.5), [envelope, other]);
    expect(r.accepted.map((a) => a.dayMs)).toEqual([ms(15)]);
    expect([...r.removed].sort()).toEqual(['s20', 's25']);
  });

  it('keeps an ask when another policy that matched it was never relaxed', () => {
    const asks = [...fleet((k) => k + 0.6), ask('both', 22.5, { matched_policies: ['p1', 'p2'] })];
    const r = run(asks, [envelope, other]);
    expect(r.removed.has('both')).toBe(false);
    expect(r.removed.has('s20')).toBe(true);
  });

  it('raises a risk threshold through the tuning engine and removes only asks under the new line', () => {
    const asks = [
      ...Array.from({ length: 10 }, (_, k) => ask(`t${k}`, k + 0.5, { matched_policies: ['p3'], approvedMs: ms(k + 0.6) })),
      ask('low', 12.5, { matched_policies: ['p3'], risk_score: 75 }),
      ask('high', 13.5, { matched_policies: ['p3'], risk_score: 85 }),
    ];
    const r = run(asks, [threshold]);
    expect(r.accepted).toEqual([
      expect.objectContaining({ rule: 'raise_risk_threshold', policy_id: 'p3', dayMs: ms(10), detail: '70 to 80' }),
    ]);
    expect([...r.removed]).toEqual(['low']);
  });
});

const cleanData = () => {
  const bounds = weekBounds(ms(14), 2);
  const askRows = [
    ask('w0a', 1), ask('w0p', 2, { agent_id: null, declared_goal: 'Automated probe: drop table' }),
    ask('w1a', 8), ask('w1b', 9), ask('w1c', 10),
  ];
  const weeklyDecisions = [1000, 2000];
  const removed = new Set(['w1c']);
  return {
    bounds,
    weeklyDecisions,
    typeTotals: { allow: 2900, warn: 94, require_approval: 5, block: 1 },
    askRows,
    apiAskTotal: 5,
    removed,
    agentsPerWeek: [3, 4],
    agentDecisionSum: 2990,
    weeks: buildWeeks({ bounds, weeklyDecisions, askRows, removed, agentsPerWeek: [3, 4] }),
  };
};

describe('buildWeeks', () => {
  it('counts approval asks apart from probes and gives both rates per 1,000 decisions', () => {
    const { weeks } = cleanData();
    expect(weeks).toEqual([
      { startMs: START, endMs: ms(7), decisions: 1000, asks: 1, probes: 1, repeats: 0, tests: 0, per1000: 1, agents: 3, whatIfAsks: 1, whatIfPer1000: 1 },
      { startMs: ms(7), endMs: ms(14), decisions: 2000, asks: 3, probes: 0, repeats: 0, tests: 0, per1000: 1.5, agents: 4, whatIfAsks: 2, whatIfPer1000: 1 },
    ]);
  });
});

describe('runChecks and sabotage', () => {
  it('passes every check on consistent data and reports the counts it compared', () => {
    const checks = runChecks(cleanData());
    expect(checks.filter((c) => !c.ok)).toEqual([]);
    expect(checks.map((c) => c.name)).toEqual([
      'rows_match_api', 'unique_ids', 'types_sum_to_weeks', 'weekly_asks_sum', 'what_if_not_above_actual', 'agents_within_total',
    ]);
    expect(checks[0].detail).toMatch(/5 rows fetched, API counts 5/);
  });

  it('sabotaged data fails the row count, the duplicate check and the weekly sum', () => {
    const bad = runChecks(sabotage(cleanData())).filter((c) => !c.ok).map((c) => c.name);
    expect(bad).toEqual(expect.arrayContaining(['rows_match_api', 'unique_ids', 'types_sum_to_weeks']));
  });
});

describe('renderMarkdown', () => {
  it('leads with the rate and prints one row per week plus the checks', () => {
    const d = cleanData();
    const md = renderMarkdown({
      generatedAt: '2026-01-19T00:00:00.000Z', windowDays: 30, weeks: d.weeks, accepted: [], checks: runChecks(d),
      outcomes: { asks: 4, approved: 1, denied: 1, unanswered: 1, neverOpened: 1, repeats: 2, tests: 1, incompletePairs: 0 },
      testAgents: ['deploy-check'], blocks: 1, policyCount: 3,
    });
    expect(md).toMatch(/^# Fleet replay/);
    expect(md).toMatch(/1\.33 approval asks per 1,000 governed actions/);
    expect(md).toMatch(/Median week: 1\.25 per 1,000\./);
    expect(md).toMatch(/Of 4 approval asks, 2 were answered: 1 approved by a human and 1 denied\. 1 reached the approvals inbox and got no answer\. 1 never opened a request: the agent asked the guard and did not follow up, so nobody was prompted\./);
    expect(md).toMatch(/Guard decisions that repeat an ask above and are counted once: 2\./);
    expect(md).toMatch(/Asks left out as test traffic \(deploy-check\): 1\./);
    expect(md).toMatch(/\| 2026-01-05 \| 1,000 \| 1 \| 1 \| 1 \| 3 \| 1 \| 1 \|/);
    expect(md).toMatch(/6 of 6 checks passed/);
  });
});
