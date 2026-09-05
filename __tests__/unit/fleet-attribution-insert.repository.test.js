/**
 * v4.3 fleet attribution — createActionRecord persists + sanitizes the two new
 * lineage columns (harness_session_id, subagent_uuid).
 *
 * A tagged-template mock captures the bound VALUES. Assertions resolve values
 * by column name so unrelated schema additions cannot retarget them.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createActionRecord, createBlockedActionRecord, updateActionOutcome } from '../../app/lib/repositories/actions.repository.js';
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

const payload = (data) => ({
  orgId: 'org_1',
  action_id: 'act_1',
  data: { agent_id: 'a1', action_type: 'orchestration', declared_goal: 'ship', ...data },
  actionStatus: 'running',
  costEstimate: 0,
  signature: null,
  verified: false,
  timestamp_start: '2026-07-04T00:00:00Z',
  riskScore: 10,
});

beforeEach(() => vi.clearAllMocks());

describe('createActionRecord — fleet attribution columns', () => {
  it('persists harness_session_id and subagent_uuid from the payload data', async () => {
    const sql = makeCapturingSqlMock([[{ action_id: 'act_1' }]]);
    await createActionRecord(sql, payload({ harness_session_id: 'hs_abc', subagent_uuid: 'uuid_xyz' }));
    const { text } = sql.calls[0];
    const insert = actionInsertValuesByColumn(sql.calls[0]);
    expect(text).toContain('harness_session_id');
    expect(text).toContain('subagent_uuid');
    expect(insert.harness_session_id).toBe('hs_abc');
    expect(insert.subagent_uuid).toBe('uuid_xyz');
    expect(insert.close_source).toBeNull();
  });

  it('binds NULL when the fields are absent', async () => {
    const sql = makeCapturingSqlMock([[{ action_id: 'act_1' }]]);
    await createActionRecord(sql, payload({}));
    const insert = actionInsertValuesByColumn(sql.calls[0]);
    expect(insert.harness_session_id).toBeNull();
    expect(insert.subagent_uuid).toBeNull();
  });

  it('sanitizes to NULL: over-200-char and non-string values', async () => {
    const sql = makeCapturingSqlMock([[{ action_id: 'act_1' }]]);
    await createActionRecord(sql, payload({ harness_session_id: 'x'.repeat(201), subagent_uuid: 12345 }));
    const insert = actionInsertValuesByColumn(sql.calls[0]);
    expect(insert.harness_session_id).toBeNull();
    expect(insert.subagent_uuid).toBeNull();
  });

  it('accepts exactly 200 chars', async () => {
    const sql = makeCapturingSqlMock([[{ action_id: 'act_1' }]]);
    const s = 'y'.repeat(200);
    await createActionRecord(sql, payload({ harness_session_id: s }));
    expect(actionInsertValuesByColumn(sql.calls[0]).harness_session_id).toBe(s);
  });

  it('createBlockedActionRecord threads the fields through (it delegates)', async () => {
    const sql = makeCapturingSqlMock([[{ action_id: 'act_1' }]]);
    await createBlockedActionRecord(sql, {
      orgId: 'org_1',
      action_id: 'act_1',
      data: { agent_id: 'a1', action_type: 'orchestration', harness_session_id: 'hs_blocked', subagent_uuid: 'uuid_blocked' },
      guardDecision: { reason: 'nope', matched_policies: [] },
      signature: null,
      verified: false,
      timestamp_start: '2026-07-04T00:00:00Z',
      riskScore: 90,
    });
    const insert = actionInsertValuesByColumn(sql.calls[0]);
    expect(insert.harness_session_id).toBe('hs_blocked');
    expect(insert.subagent_uuid).toBe('uuid_blocked');
    expect(insert.close_source).toBe('direct');
  });
});

describe('updateActionOutcome — spawned_agent_uuid lineage stamp (outcome_progress merge)', () => {
  // Call 0 is the existence SELECT; call 1 is the UPDATE.
  const existsThenUpdate = (updateRow = { action_id: 'act_1' }) =>
    makeCapturingSqlMock([[{ action_id: 'act_1' }], [updateRow]]);

  it('merges ONLY the spawned_agent_uuid key into outcome_progress jsonb', async () => {
    const sql = existsThenUpdate();
    await updateActionOutcome(sql, 'org_1', 'act_1', { status: 'completed' }, { spawnedAgentUuid: 'uuid_spawned' });
    const update = sql.calls[1];
    expect(update.text).toContain("jsonb_build_object('spawned_agent_uuid'");
    expect(update.text).toContain("COALESCE(outcome_progress, '{}'::jsonb)");
    expect(update.values).toContain('uuid_spawned');
  });

  it('applies WITHOUT a status gate — the stamp lands on an already-terminal row', async () => {
    const sql = existsThenUpdate({ action_id: 'act_1', status: 'completed' });
    const row = await updateActionOutcome(sql, 'org_1', 'act_1', {}, { spawnedAgentUuid: 'uuid_late' });
    // No outcome fields at all — the lineage-only write still executes, ungated.
    expect(row).toEqual({ action_id: 'act_1', status: 'completed' });
    const update = sql.calls[1];
    expect(update.values).toContain('uuid_late');
    expect(update.values).not.toContain('running'); // no gate bound
  });

  it('still updates when combined with a gate (close write) — the merge CASE is independent of the gate', async () => {
    const sql = existsThenUpdate();
    await updateActionOutcome(sql, 'org_1', 'act_1', { status: 'completed' }, { gateStatus: 'running', closeSource: 'outcome', spawnedAgentUuid: 'uuid_gated' });
    const update = sql.calls[1];
    expect(update.values).toContain('uuid_gated');
    expect(update.values).toContain('running');
    expect(update.values).toContain('outcome');
  });

  it('ignores an oversized value — no lineage-only write happens', async () => {
    const sql = makeCapturingSqlMock([[{ action_id: 'act_1' }]]);
    const row = await updateActionOutcome(sql, 'org_1', 'act_1', {}, { spawnedAgentUuid: 'x'.repeat(201) });
    expect(row).toBeNull();
    expect(sql.calls).toHaveLength(1); // existence SELECT only, no UPDATE
  });

  it('ignores a non-string value — binds null so the SQL CASE no-ops', async () => {
    const sql = existsThenUpdate();
    await updateActionOutcome(sql, 'org_1', 'act_1', { tokens_in: 5 }, { spawnedAgentUuid: 12345 });
    const update = sql.calls[1];
    expect(update.values).not.toContain(12345);
    expect(update.values).not.toContain('12345');
  });

  it('no lineage option → binds null and never mentions a spawned value', async () => {
    const sql = existsThenUpdate();
    await updateActionOutcome(sql, 'org_1', 'act_1', { tokens_in: 5 });
    // The merge CASE guards on `${spawnedAgentUuid}::text IS NOT NULL`; with no
    // option the bound value is null so outcome_progress is untouched.
    expect(sql.calls[1].values).toContain(null);
  });
});
