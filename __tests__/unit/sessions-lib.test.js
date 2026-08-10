import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSqlMock } from '../helpers.js';
import { updateSession, listSessions, getSession, getSessionActions, sweepAbandonedSessions, TERMINAL_STATUSES, ABANDONED_SESSION_HOURS } from '../../app/lib/sessions.js';

// ensureTables() is gated on a globalThis flag and fires CREATE TABLE/INDEX
// round-trips on first call. Pin it true so each test exercises only the
// statement(s) under inspection deterministically.
beforeEach(() => { globalThis.__dashclaw_sessions_table_checked = true; });
afterEach(() => { globalThis.__dashclaw_sessions_table_checked = false; });

describe('updateSession — terminal summary salvage', () => {
  it('records the session_end summary as the terminal event detail', async () => {
    const sql = createSqlMock({ taggedResponses: [
      [{ id: 'sess_1', status: 'completed' }], // UPDATE ... RETURNING *
      [], // INSERT INTO session_events ... SELECT
    ] });

    await updateSession(sql, 'sess_1', 'org_1', { status: 'completed', summary: 'shipped it' });

    // The INSERT is the last tagged call; its detail value carries the summary.
    const insert = sql.taggedCalls[sql.taggedCalls.length - 1];
    expect(insert.text).toMatch(/INSERT INTO session_events/);
    expect(insert.values).toContain('shipped it');
    expect(insert.values).toContain('completed');
  });

  it('still uses blocked_reason (not summary) as detail on a blocked transition', async () => {
    const sql = createSqlMock({ taggedResponses: [
      [{ id: 'sess_1', status: 'blocked' }],
      [],
    ] });

    await updateSession(sql, 'sess_1', 'org_1', {
      status: 'blocked',
      blocked_reason: 'awaiting review',
      summary: 'should be ignored here',
    });

    const insert = sql.taggedCalls[sql.taggedCalls.length - 1];
    expect(insert.values).toContain('awaiting review');
    expect(insert.values).not.toContain('should be ignored here');
  });

  it('does not record a summary as detail for a non-terminal status', async () => {
    const sql = createSqlMock({ taggedResponses: [
      [{ id: 'sess_1', status: 'running' }],
      [],
    ] });

    await updateSession(sql, 'sess_1', 'org_1', { status: 'running', summary: 'noise' });

    const insert = sql.taggedCalls[sql.taggedCalls.length - 1];
    expect(insert.values).not.toContain('noise');
  });
});

describe('session aggregation shaping', () => {
  it('coerces numeric aggregate columns and prefers last_action_at for last_activity', async () => {
    const sql = createSqlMock({ taggedResponses: [
      // The first three responses are consumed by embedded fragments, evaluated
      // before the outer SELECT: sessionActionMatchSql x2 (one per lateral),
      // then the sessionAggregateSql wrapper. The last response is the row set.
      [], [], [],
      [{
        id: 'sess_1', org_id: 'org_1', agent_id: 'a', status: 'running',
        last_activity: '2026-06-01T00:00:00Z',
        action_count: '5', total_cost: '1.25', max_risk: '70', event_count: '3',
        last_action_at: '2026-06-04T00:00:00Z',
      }],
    ] });

    const rows = await listSessions(sql, 'org_1');
    expect(rows[0].action_count).toBe(5);
    expect(rows[0].total_cost).toBe(1.25);
    expect(rows[0].max_risk).toBe(70);
    expect(rows[0].event_count).toBe(3);
    // last_action_at wins over the stored last_activity column.
    expect(rows[0].last_activity).toBe('2026-06-04T00:00:00Z');
  });

  it('getSession joins action_records and session_events for aggregates', async () => {
    const sql = createSqlMock({ taggedResponses: [
      [], [], [], // embedded fragments: match predicate x2 + aggregate wrapper
      [{ id: 'sess_1', org_id: 'org_1', agent_id: 'a', status: 'completed', action_count: '2', total_cost: '0', max_risk: '0', event_count: '4' }],
    ] });

    const session = await getSession(sql, 'sess_1', 'org_1');
    // The embedded match-predicate fragments come first, then the aggregate
    // wrapper (carrying the joins), then the outer SELECT.
    const fragment = sql.taggedCalls[2];
    expect(fragment.text).toMatch(/LEFT JOIN LATERAL/);
    expect(fragment.text).toMatch(/action_records/);
    expect(fragment.text).toMatch(/session_events/);
    const outer = sql.taggedCalls[sql.taggedCalls.length - 1];
    expect(outer.text).toMatch(/FROM agent_sessions s/);
    expect(session.action_count).toBe(2);
    expect(session.event_count).toBe(4);
  });
});

describe('getSessionActions — shared predicate with the aggregate count', () => {
  it('uses the exact same match predicate as the # Actions aggregate', async () => {
    // Capture the aggregate's predicate fragment via getSession...
    const aggSql = createSqlMock({ taggedResponses: [[], [], [], [{ id: 'sess_1' }]] });
    await getSession(aggSql, 'sess_1', 'org_1');
    const aggregatePredicate = aggSql.taggedCalls[0].text;

    // ...and the list/count predicate fragments via getSessionActions.
    const listSql = createSqlMock({ taggedResponses: [
      [], [{ total: '7' }], // match fragment + count query
      [], [],               // match fragment + list query
    ] });
    await getSessionActions(listSql, 'sess_1', 'org_1');
    const countPredicate = listSql.taggedCalls[0].text;
    const listPredicate = listSql.taggedCalls[2].text;

    // Same fixture → equal predicates → list and count cannot disagree.
    expect(countPredicate).toBe(aggregatePredicate);
    expect(listPredicate).toBe(aggregatePredicate);
    expect(aggregatePredicate).toMatch(/ar\.session_id = s\.id/);
    expect(aggregatePredicate).toMatch(/ar\.session_id IS NULL/);

    // Both the count and the list query join action_records through the
    // session row and embed the shared predicate placeholder.
    const countQuery = listSql.taggedCalls[1].text;
    const listQuery = listSql.taggedCalls[3].text;
    for (const q of [countQuery, listQuery]) {
      expect(q).toMatch(/FROM agent_sessions s/);
      expect(q).toMatch(/JOIN action_records ar/);
    }
    expect(countQuery).toMatch(/COUNT\(\*\)::int AS total/);
    expect(listQuery).toMatch(/ORDER BY ar\.created_at DESC/);
  });

  it('returns coerced rows + total and clamps limit/offset', async () => {
    const sql = createSqlMock({ taggedResponses: [
      [], [{ total: '700' }],
      [], [{ action_id: 'act_1', risk_score: '40', cost_estimate: '0.0125', created_at: '2026-06-10T00:00:00Z' }],
    ] });

    const { actions, total } = await getSessionActions(sql, 'sess_1', 'org_1', { limit: '99999', offset: '-5' });
    expect(total).toBe(700);
    expect(actions[0].risk_score).toBe(40);
    expect(actions[0].cost_estimate).toBe(0.0125);

    // limit clamps to 200, offset floors at 0 (last two values of the list query).
    const listValues = sql.taggedCalls[3].values;
    expect(listValues[listValues.length - 2]).toBe(200);
    expect(listValues[listValues.length - 1]).toBe(0);
  });
});

describe('TERMINAL_STATUSES export', () => {
  it('includes all ended states so duration freezes correctly', () => {
    for (const s of ['finished', 'failed', 'closed', 'completed', 'cancelled']) {
      expect(TERMINAL_STATUSES).toContain(s);
    }
  });
});

describe('sweepAbandonedSessions', () => {
  it('closes running sessions past the abandonment window and logs one event each', async () => {
    const sql = createSqlMock({ taggedResponses: [
      [
        { id: 'sess_1', org_id: 'org_a', agent_id: 'agent-1' },
        { id: 'sess_2', org_id: 'org_b', agent_id: 'agent-2' },
      ], // UPDATE ... RETURNING
      [], [], // one session_events INSERT per closed session
    ] });

    const closed = await sweepAbandonedSessions(sql);
    expect(closed).toHaveLength(2);

    const update = sql.taggedCalls[0];
    expect(update.text).toMatch(/UPDATE agent_sessions/);
    expect(update.text).toMatch(/status = 'closed'/);
    expect(update.text).toMatch(/status = 'running'/);
    expect(update.values).toContain(ABANDONED_SESSION_HOURS);

    const events = sql.taggedCalls.slice(1);
    expect(events).toHaveLength(2);
    for (const ev of events) {
      expect(ev.text).toMatch(/INSERT INTO session_events/);
      expect(ev.values.join(' ')).toContain('Auto-closed by the outcome sweep');
    }
  });

  it('inserts no events when nothing is stale', async () => {
    const sql = createSqlMock({ taggedResponses: [[]] });
    const closed = await sweepAbandonedSessions(sql);
    expect(closed).toHaveLength(0);
    expect(sql.taggedCalls).toHaveLength(1);
  });
});
