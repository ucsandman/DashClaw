/**
 * v4.2 coverage truth — close_source stamping (durable closure provenance).
 *
 * The stamp is computed in SQL (a CASE in the update path, a COALESCE in the
 * outcome path, a bound literal at create), so a tagged-template mock can't
 * evaluate it — these tests pin that the repository threads the correct
 * provenance value + gate into the write for each of the three closure paths.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createActionRecord,
  createBlockedActionRecord,
  updateActionOutcome,
  setActionOutcome,
} from '../../app/lib/repositories/actions.repository.js';
import { actionInsertValuesByColumn } from './helpers/action-insert-values.js';

function makeCapturingSqlMock(responses) {
  const queue = [...responses];
  const calls = [];
  const sql = vi.fn((strings, ...values) => {
    calls.push({ text: strings.join('?'), values });
    return Promise.resolve(queue.shift() ?? []);
  });
  sql.calls = calls;
  return sql;
}

const basePayload = (actionStatus) => ({
  orgId: 'org_1',
  action_id: 'act_1',
  data: { agent_id: 'a1', action_type: 'deploy', declared_goal: 'ship' },
  actionStatus,
  costEstimate: 0,
  signature: null,
  verified: false,
  timestamp_start: '2026-07-04T00:00:00Z',
  riskScore: 10,
});

beforeEach(() => vi.clearAllMocks());

describe('createActionRecord — direct close on terminal-at-create', () => {
  it("stamps 'direct' when the row is born terminal (e.g. completed)", async () => {
    const sql = makeCapturingSqlMock([[{ action_id: 'act_1' }]]);
    await createActionRecord(sql, basePayload('completed'));
    expect(actionInsertValuesByColumn(sql.calls[0]).close_source).toBe('direct');
    expect(sql.calls[0].text).toContain('close_source');
  });

  it('leaves close_source NULL for a still-running create', async () => {
    const sql = makeCapturingSqlMock([[{ action_id: 'act_1' }]]);
    await createActionRecord(sql, basePayload('running'));
    expect(actionInsertValuesByColumn(sql.calls[0]).close_source).toBeNull();
  });

  it('leaves close_source NULL for pending_approval', async () => {
    const sql = makeCapturingSqlMock([[{ action_id: 'act_1' }]]);
    await createActionRecord(sql, basePayload('pending_approval'));
    expect(actionInsertValuesByColumn(sql.calls[0]).close_source).toBeNull();
  });

  it("createBlockedActionRecord stamps 'direct' (blocked rows are born terminal)", async () => {
    const sql = makeCapturingSqlMock([[{ action_id: 'act_1' }]]);
    await createBlockedActionRecord(sql, {
      orgId: 'org_1',
      action_id: 'act_1',
      data: { agent_id: 'a1', action_type: 'deploy' },
      guardDecision: { reason: 'nope', matched_policies: [] },
      signature: null,
      verified: false,
      timestamp_start: '2026-07-04T00:00:00Z',
      riskScore: 90,
    });
    expect(actionInsertValuesByColumn(sql.calls[0]).close_source).toBe('direct');
  });
});

describe('updateActionOutcome — stop_autoclose vs outcome close', () => {
  it("threads 'stop_autoclose' + the running gate into the close write", async () => {
    // 1st call: existence SELECT; 2nd call: the gated UPDATE.
    const sql = makeCapturingSqlMock([[{ action_id: 'act_1' }], [{ action_id: 'act_1', close_source: 'stop_autoclose' }]]);
    await updateActionOutcome(sql, 'org_1', 'act_1', { status: 'completed' }, { gateStatus: 'running', closeSource: 'stop_autoclose' });
    const update = sql.calls[1];
    expect(update.text).toContain('close_source');
    expect(update.values).toContain('stop_autoclose');
    expect(update.values).toContain('running'); // gate
  });

  it("threads 'outcome' into a normal completion close", async () => {
    const sql = makeCapturingSqlMock([[{ action_id: 'act_1' }], [{ action_id: 'act_1', close_source: 'outcome' }]]);
    await updateActionOutcome(sql, 'org_1', 'act_1', { status: 'completed' }, { gateStatus: 'running', closeSource: 'outcome' });
    expect(sql.calls[1].values).toContain('outcome');
  });

  it('does not stamp close_source when no closeSource intent is supplied (late token update)', async () => {
    const sql = makeCapturingSqlMock([[{ action_id: 'act_1' }], [{ action_id: 'act_1' }]]);
    await updateActionOutcome(sql, 'org_1', 'act_1', { tokens_in: 500 });
    // The CASE guards on `${closeSource}::text IS NOT NULL`; the bound value is null.
    expect(sql.calls[1].values).toContain(null);
    expect(sql.calls[1].values).not.toContain('outcome');
    expect(sql.calls[1].values).not.toContain('stop_autoclose');
  });

  it('only stamps on a terminal transition — the CASE guards the new status', async () => {
    const sql = makeCapturingSqlMock([[{ action_id: 'act_1' }], [{ action_id: 'act_1' }]]);
    await updateActionOutcome(sql, 'org_1', 'act_1', { status: 'completed' }, { gateStatus: 'running', closeSource: 'outcome' });
    expect(sql.calls[1].text).toContain('ANY(');
  });
});

describe('setActionOutcome — durable-finality outcome close', () => {
  it("stamps close_source via COALESCE(close_source, 'outcome')", async () => {
    const sql = makeCapturingSqlMock([[
      {
        action_id: 'act_1',
        outcome_status: 'completed',
        outcome_at: '2026-07-04T00:00:01Z',
        outcome_summary: 'done',
        outcome_error: null,
        outcome_progress: null,
        created_at: '2026-07-04T00:00:00Z',
        elapsed_ms: '1000',
      },
    ]]);
    const result = await setActionOutcome(sql, 'org_1', 'act_1', { status: 'completed', summary: 'done' });
    expect(result.ok).toBe(true);
    expect(sql.calls[0].text).toContain("COALESCE(close_source, 'outcome')");
  });
});
