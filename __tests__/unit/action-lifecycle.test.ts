import { describe, it, expect } from 'vitest';

// Action approval + execution lifecycle (action_records.status) as an explicit
// state machine: the table, its invariants, every illegal and legal edge, and
// SQL parity. The repositories keep their literal SQL gates (other tests pin
// that text); the parity block below captures the SQL they actually emit and
// holds each literal state set to the table, so SQL and table cannot drift.

import {
  ACTION_ACTORS,
  ACTION_CREATE_STATES,
  ACTION_EDGE_ACTORS,
  ACTION_STATES,
  ACTION_STATES_REFUSING_OUTCOME,
  ACTION_STATE_LABELS,
  ACTION_TERMINAL_STATES,
  ACTION_TRANSITIONS,
  IllegalTransitionError,
  allowedFrom,
  assertTransition,
  canTransition,
  illegalTransitionBody,
  nextStates,
  statusForDecision,
  type ActionActor,
  type ActionEdge,
  type ActionState,
} from '../../app/lib/action-lifecycle';
import { ACTION_STATUSES } from '../../app/lib/validate.js';
import {
  createActionRecord,
  expireOverdueApproval,
  recordApproval,
  recordBulkApprovals,
  setActionOutcome,
  sweepExpiredApprovals,
  sweepLostOutcomesForOrg,
  updateActionOutcome,
} from '../../app/lib/repositories/actions.repository';
import { cancelAction } from '../../app/lib/repositories/actions.repository.execution';
import { actionInsertValuesByColumn } from './helpers/action-insert-values.js';

type Row = Record<string, unknown>;
type Call = { text: string; values: unknown[] };

// Tagged-template + .query mock: records the joined SQL text and bound values
// of every call; responses come from a FIFO queue (default: empty result).
function makeSql(responses: Row[][] = []) {
  const calls: Call[] = [];
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?');
    if (text.trim() === '') return Promise.resolve([]);
    calls.push({ text, values });
    return Promise.resolve(responses.shift() ?? []);
  }) as ((strings: TemplateStringsArray, ...values: unknown[]) => Promise<Row[]>) & {
    query: (text: string, params?: unknown[]) => Promise<Row[]>;
    calls: Call[];
  };
  sql.query = (text: string, params: unknown[] = []) => {
    calls.push({ text, values: params });
    return Promise.resolve(responses.shift() ?? []);
  };
  sql.calls = calls;
  return sql;
}

/** The quoted literals inside the first capture group of `re` in `text`. */
function quotedSet(text: string, re: RegExp): string[] {
  const match = text.match(re);
  if (!match || match[1] === undefined) throw new Error(`pattern ${re} not found in SQL:\n${text}`);
  return [...match[1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1] as string).sort();
}

/** Every literal of `AND status = '<x>'` in `text`, deduplicated. */
function statusEqualsGates(text: string): string[] {
  return [...new Set([...text.matchAll(/AND status = '([a-z_]+)'/g)].map((m) => m[1] as string))].sort();
}

const sorted = (values: readonly string[]) => [...values].sort();

const EDGES: Array<[ActionState, ActionState]> = ACTION_STATES.flatMap((from) =>
  ACTION_TRANSITIONS[from].map((to) => [from, to] as [ActionState, ActionState]),
);
const isEdge = (from: ActionState, to: ActionState) => ACTION_TRANSITIONS[from].includes(to);

// Every ordered pair that is neither a table edge nor an identity request.
const ILLEGAL_PAIRS: Array<[ActionState, ActionState]> = ACTION_STATES.flatMap((from) =>
  ACTION_STATES.filter((to) => to !== from && !isEdge(from, to)).map((to) => [from, to] as [ActionState, ActionState]),
);

describe('action lifecycle table invariants', () => {
  it('ACTION_STATES is the create enum plus the two server-only values, and partial is not a state', () => {
    expect(sorted(ACTION_STATES)).toEqual(sorted([...ACTION_STATUSES, 'expired', 'unknown']));
    expect(ACTION_STATES).toHaveLength(9);
    expect((ACTION_STATES as readonly string[]).includes('partial')).toBe(false);
  });

  it('ACTION_CREATE_STATES equals validate.js ACTION_STATUSES, in order', () => {
    expect([...ACTION_CREATE_STATES]).toEqual([...ACTION_STATUSES]);
  });

  it('every state is reachable from a create state', () => {
    const seen = new Set<ActionState>(ACTION_CREATE_STATES);
    const queue: ActionState[] = [...ACTION_CREATE_STATES];
    while (queue.length > 0) {
      const from = queue.shift() as ActionState;
      for (const to of ACTION_TRANSITIONS[from]) {
        if (!seen.has(to)) { seen.add(to); queue.push(to); }
      }
    }
    expect(sorted([...seen])).toEqual(sorted(ACTION_STATES));
  });

  it('the terminal set is exactly the states with no outgoing edge', () => {
    expect([...ACTION_TERMINAL_STATES]).toEqual(['blocked', 'completed', 'failed', 'cancelled', 'expired', 'unknown']);
    expect([...ACTION_TERMINAL_STATES]).toEqual(ACTION_STATES.filter((s) => ACTION_TRANSITIONS[s].length === 0));
    for (const state of ACTION_TERMINAL_STATES) {
      expect(ACTION_TRANSITIONS[state]).toEqual([]);
      expect(nextStates(state)).toEqual([]);
    }
  });

  it('ACTION_EDGE_ACTORS has one non-empty entry per edge, naming only known actors', () => {
    expect(Object.keys(ACTION_EDGE_ACTORS).sort()).toEqual(EDGES.map(([f, t]) => `${f}>${t}`).sort());
    for (const [from, to] of EDGES) {
      const actors = ACTION_EDGE_ACTORS[`${from}>${to}` as ActionEdge] ?? [];
      expect(actors.length, `${from}>${to}`).toBeGreaterThan(0);
      for (const actor of actors) expect(ACTION_ACTORS).toContain(actor);
    }
    expect(EDGES).toHaveLength(11);
  });

  it('every state has a non-empty operator label', () => {
    expect(Object.keys(ACTION_STATE_LABELS).sort()).toEqual(sorted(ACTION_STATES));
    for (const state of ACTION_STATES) expect(ACTION_STATE_LABELS[state].trim().length).toBeGreaterThan(0);
  });

  it('approve and deny map onto the edges operators and chat webhooks hold from pending_approval', () => {
    expect(statusForDecision('allow')).toBe('running');
    expect(statusForDecision('deny')).toBe('failed');
    for (const actor of ['user', 'webhook'] as const) {
      expect(nextStates('pending_approval', actor)).toContain(statusForDecision('allow'));
      expect(nextStates('pending_approval', actor)).toContain(statusForDecision('deny'));
    }
  });

  it('the outcome-refusing states are known states, include expired, and give an agent no completed/failed edge', () => {
    for (const state of ACTION_STATES_REFUSING_OUTCOME) {
      expect(ACTION_STATES).toContain(state);
      expect(nextStates(state, 'agent')).not.toContain('completed');
      expect(nextStates(state, 'agent')).not.toContain('failed');
    }
    expect([...ACTION_STATES_REFUSING_OUTCOME]).toContain('expired');
  });

  it('the non-terminal create set is running, pending and pending_approval (the former create.ts list)', async () => {
    const open = ACTION_STATES.filter((s) => !ACTION_TERMINAL_STATES.includes(s));
    expect(sorted(open)).toEqual(['pending', 'pending_approval', 'running']);
    // createActionRecord stamps close_source 'direct' only on a row born terminal.
    for (const status of ACTION_CREATE_STATES) {
      const sql = makeSql([[{ action_id: 'act_1' }]]);
      await createActionRecord(sql, {
        orgId: 'org1',
        action_id: 'act_1',
        data: { agent_id: 'a1', action_type: 'deploy', declared_goal: 'g' },
        actionStatus: status,
        signature: null,
        verified: false,
        timestamp_start: '2026-07-04T00:00:00Z',
      });
      const closeSource = actionInsertValuesByColumn(sql.calls[0]!).close_source;
      expect(closeSource, status).toBe(open.includes(status) ? null : 'direct');
    }
  });
});

describe('illegal transitions are refused', () => {
  it('there are 62 non-identity pairs outside the table', () => {
    expect(ILLEGAL_PAIRS).toHaveLength(9 * 9 - 11 - 8);
  });

  it.each(ILLEGAL_PAIRS)('%s -> %s', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
    for (const actor of ACTION_ACTORS) expect(canTransition(from, to, actor)).toBe(false);
    let thrown: unknown;
    try { assertTransition(from, to); } catch (err) { thrown = err; }
    expect(thrown).toBeInstanceOf(IllegalTransitionError);
    expect(thrown).toMatchObject({
      name: 'IllegalTransitionError',
      code: 'illegal_transition',
      current: from,
      requested: to,
      allowed: nextStates(from),
    });
  });

  it.each([
    ['running', 'pending_approval', 'agent', 'agent PATCH re-queues an approved action; reachable from MCP dashclaw_record'],
    ['running', 'pending', 'agent', 'agent PATCH; accepted before'],
    ['running', 'blocked', 'agent', 'agent PATCH; accepted before'],
    ['running', 'expired', 'system', 'expiry only applies while awaiting approval'],
    ['pending_approval', 'completed', 'agent', 'not released for execution'],
    ['pending_approval', 'cancelled', 'user', 'cancel is for released actions'],
    ['pending_approval', 'pending', 'agent', 'no edge'],
    ['pending_approval', 'blocked', 'agent', 'blocked is a create-time verdict'],
    ['pending_approval', 'unknown', 'cron', 'the outcome sweep never flips pending_approval'],
    ['pending_approval', 'running', 'agent', 'only an operator or chat approver may approve'],
    ['pending_approval', 'failed', 'agent', 'only an operator or chat approver may deny'],
    ['pending_approval', 'expired', 'user', 'expiry is system-only'],
    ['running', 'unknown', 'agent', 'unknown is sweep-only'],
    ['pending', 'running', 'agent', 'no edge'],
    ['pending', 'pending_approval', 'agent', 'no edge'],
    ['pending', 'cancelled', 'user', 'cancel is running-only'],
    ['failed', 'running', 'user', 'approve after deny'],
    ['expired', 'running', 'user', 'late approve'],
    ['cancelled', 'completed', 'agent', 'PATCH after cancel'],
    ['completed', 'cancelled', 'user', 'cancel after completion'],
    ['unknown', 'completed', 'agent', 'late PATCH after the sweep'],
    ['blocked', 'running', 'user', 'blocked is final'],
    ['blocked', 'pending_approval', 'agent', 'blocked is final'],
  ] as Array<[ActionState, ActionState, ActionActor, string]>)('%s -> %s by %s is refused (%s)', (from, to, actor) => {
    expect(canTransition(from, to, actor)).toBe(false);
    expect(() => assertTransition(from, to, actor)).toThrow(IllegalTransitionError);
  });

  it.each(ACTION_TERMINAL_STATES.map((s) => [s]))('terminal %s refuses every other state for every actor', (from) => {
    for (const to of ACTION_STATES.filter((s) => s !== from)) {
      expect(canTransition(from, to)).toBe(false);
      for (const actor of ACTION_ACTORS) expect(canTransition(from, to, actor)).toBe(false);
    }
  });

  it('refuses unknown and NULL values on either side', () => {
    expect(canTransition(null, 'running')).toBe(false);
    expect(canTransition(undefined, 'completed')).toBe(false);
    expect(canTransition('partial', 'completed')).toBe(false);
    expect(canTransition('running', 'partial')).toBe(false);
    expect(canTransition('running', 'lost_confirmation')).toBe(false);
    expect(nextStates(null)).toEqual([]);
    expect(nextStates('partial')).toEqual([]);
    expect(allowedFrom('partial')).toEqual([]);
    expect(() => assertTransition(null, 'running')).toThrow(IllegalTransitionError);
  });

  it('expired accepts no agent outcome', () => {
    expect([...ACTION_STATES_REFUSING_OUTCOME]).toContain('expired');
  });
});

describe('legal transitions are accepted', () => {
  const EDGE_ACTOR_CASES = EDGES.flatMap(([from, to]) =>
    (ACTION_EDGE_ACTORS[`${from}>${to}` as ActionEdge] ?? []).map((actor) => [from, to, actor] as [ActionState, ActionState, ActionActor]),
  );

  it.each(EDGE_ACTOR_CASES)('%s -> %s by %s', (from, to, actor) => {
    expect(canTransition(from, to, actor)).toBe(true);
    expect(canTransition(from, to)).toBe(true);
    expect(() => assertTransition(from, to, actor)).not.toThrow();
    expect(nextStates(from, actor)).toContain(to);
  });

  it.each([
    ['pending_approval', ['user', 'webhook'], ['running', 'failed']],
    ['pending_approval', ['system'], ['expired']],
    ['running', ['agent'], ['running', 'completed', 'failed', 'cancelled']],
    ['running', ['system'], ['completed', 'failed']],
    ['running', ['cron'], ['completed', 'failed', 'unknown']],
    ['running', ['user'], ['cancelled']],
    ['pending', ['agent'], ['completed', 'failed']],
    ['pending', ['cron'], ['completed', 'failed', 'unknown']],
  ] as Array<[ActionState, ActionActor[], ActionState[]]>)('nextStates(%s) for %s is %s', (from, actors, expected) => {
    for (const actor of actors) expect([...nextStates(from, actor)]).toEqual(expected);
  });

  it('nextStates with no actor is the whole row of the table', () => {
    expect([...nextStates('pending_approval')]).toEqual(['running', 'failed', 'expired']);
    expect([...nextStates('running')]).toEqual(['running', 'completed', 'failed', 'cancelled', 'unknown']);
    expect([...nextStates('pending')]).toEqual(['completed', 'failed', 'unknown']);
  });

  it.each(ACTION_STATES.map((s) => [s]))('identity %s -> %s is a no-op success for every actor', (state) => {
    expect(canTransition(state, state)).toBe(true);
    for (const actor of ACTION_ACTORS) {
      expect(canTransition(state, state, actor)).toBe(true);
      expect(() => assertTransition(state, state, actor)).not.toThrow();
    }
    // Identity is not a "next state": only running lists itself (the progress edge).
    expect(nextStates(state).includes(state)).toBe(state === 'running');
  });
});

describe('refusal contract body', () => {
  it('carries error, message, current, requested and allowed', () => {
    const body = illegalTransitionBody('running', 'pending_approval', 'agent');
    expect(body).toEqual({
      error: 'illegal_transition',
      message: expect.any(String),
      current: 'running',
      requested: 'pending_approval',
      allowed: ['running', 'completed', 'failed', 'cancelled'],
    });
    expect(body.message).toContain(ACTION_STATE_LABELS.running);
    expect(body.message).toContain(ACTION_STATE_LABELS.pending_approval);
  });

  it('names a terminal state as final and allows nothing', () => {
    const body = illegalTransitionBody('cancelled', 'completed', 'agent');
    expect(body.allowed).toEqual([]);
    expect(body.message).toMatch(/final/);
  });

  it('a NULL current is reported as null', () => {
    expect(illegalTransitionBody(null, 'running').current).toBeNull();
    expect(new IllegalTransitionError(undefined, 'running').current).toBeNull();
  });
});

describe('SQL parity: every literal lifecycle gate equals the table', () => {
  it('setActionOutcome lifecycle CASE == allowedFrom(completed|failed, agent)', async () => {
    const sql = makeSql([[{ action_id: 'act_1', outcome_status: 'completed' }]]);
    await setActionOutcome(sql, 'org_1', 'act_1', { status: 'completed' });
    const open = quotedSet(sql.calls[0]!.text, /status\s+=\s+CASE WHEN status IS NULL OR status IN \(([^)]*)\)/);
    expect(open).toEqual(sorted(allowedFrom('completed', 'agent')));
    expect(open).toEqual(sorted(allowedFrom('failed', 'agent')));
  });

  it('sweepLostOutcomesForOrg primary CASE == allowedFrom(unknown, cron); backfill == allowedFrom(completed|failed|unknown, cron)', async () => {
    const sql = makeSql([[], []]);
    await sweepLostOutcomesForOrg(sql, 'org_1', 15);
    expect(sql.calls).toHaveLength(2);
    const primary = quotedSet(sql.calls[0]!.text, /status\s+=\s+CASE WHEN status IS NULL OR status IN \(([^)]*)\)\s+THEN 'unknown'/);
    expect(primary).toEqual(sorted(allowedFrom('unknown', 'cron')));
    const backfill = quotedSet(sql.calls[1]!.text, /AND \(status IS NULL OR status IN \(([^)]*)\)\)/);
    expect(backfill).toEqual(sorted(allowedFrom('completed', 'cron')));
    expect(backfill).toEqual(sorted(allowedFrom('failed', 'cron')));
    expect(backfill).toEqual(sorted(allowedFrom('unknown', 'cron')));
  });

  it("expireOverdueApproval and sweepExpiredApprovals gate on 'pending_approval' == allowedFrom(expired, system)", async () => {
    const one = makeSql([[]]);
    await expireOverdueApproval(one, 'org_1', 'act_1');
    expect(one.calls[0]!.text).toContain("SET status = 'expired'");
    expect(statusEqualsGates(one.calls[0]!.text)).toEqual(sorted(allowedFrom('expired', 'system')));

    const many = makeSql([[]]);
    await sweepExpiredApprovals(many, 'org_1');
    expect(many.calls[0]!.text).toContain("SET status = 'expired'");
    expect(statusEqualsGates(many.calls[0]!.text)).toEqual(sorted(allowedFrom('expired', 'system')));
  });

  it("recordApproval and recordBulkApprovals gate on 'pending_approval' == allowedFrom(running|failed, user)", async () => {
    const one = makeSql([[]]);
    await recordApproval(one, 'org_1', 'act_1', { newStatus: 'failed', errorMessage: 'no', decision: 'deny', userId: 'u1' });
    const update = one.calls.find((c) => c.text.includes('UPDATE action_records'))!;
    expect(update.values).toContain('failed');
    expect(statusEqualsGates(update.text)).toEqual(sorted(allowedFrom('running', 'user')));
    expect(statusEqualsGates(update.text)).toEqual(sorted(allowedFrom('failed', 'user')));

    const bulk = makeSql([[]]);
    await recordBulkApprovals(bulk, 'org_1', ['act_1'], { newStatus: 'running', errorMessage: null, decision: 'allow', userId: 'u1', safeReasoning: '' });
    expect(statusEqualsGates(bulk.calls[0]!.text)).toEqual(sorted(allowedFrom('running', 'user')));
    expect(statusEqualsGates(bulk.calls[0]!.text)).toEqual(sorted(allowedFrom('failed', 'user')));
  });

  it("cancelAction gates on 'running' == allowedFrom(cancelled, user|agent)", async () => {
    const sql = makeSql([[], []]);
    await cancelAction(sql, { orgId: 'org_1', actionId: 'act_1', reason: 'not needed' });
    expect(sql.calls[0]!.text).toContain("SET status = 'cancelled'");
    expect(statusEqualsGates(sql.calls[0]!.text)).toEqual(sorted(allowedFrom('cancelled', 'user')));
    expect(statusEqualsGates(sql.calls[0]!.text)).toEqual(sorted(allowedFrom('cancelled', 'agent')));
  });

  it("the PATCH close gate 'running' is the agent's from-state for every status PATCH may close with", async () => {
    for (const to of ['running', 'completed', 'failed', 'cancelled'] as const) {
      expect(allowedFrom(to, 'agent')).toContain('running');
    }
    // updateActionOutcome binds the gate and the derived close-status list.
    const sql = makeSql([[{ action_id: 'act_1' }], [{ action_id: 'act_1', status: 'completed' }]]);
    await updateActionOutcome(sql, 'org_1', 'act_1', { status: 'completed' }, { gateStatus: 'running', closeSource: 'outcome' });
    const update = sql.calls[1]!;
    expect(update.values).toContain('running');
    const closeList = update.values.find((v) => Array.isArray(v));
    expect(closeList).toEqual([...ACTION_TERMINAL_STATES]);
  });
});
