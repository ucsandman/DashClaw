import { describe, it, expect } from 'vitest';
import * as actionsRepository from '@/lib/repositories/actions.repository';
import * as messagesContextRepository from '@/lib/repositories/messagesContext.repository';
import * as orgsTeamRepository from '@/lib/repositories/orgsTeam.repository';

function createSqlMock({ taggedResponses = [], queryResponses = [] } = {}) {
  const taggedCalls = [];
  const queryCalls = [];

  const sql = (strings, ...values) => {
    taggedCalls.push({
      text: String.raw({ raw: strings }, ...Array(values.length).fill('?')),
      values,
    });
    if (taggedResponses.length === 0) return Promise.resolve([]);
    return Promise.resolve(taggedResponses.shift());
  };

  sql.query = async (text, params = []) => {
    queryCalls.push({ text, params });
    if (queryResponses.length === 0) return [];
    return queryResponses.shift();
  };

  sql.taggedCalls = taggedCalls;
  sql.queryCalls = queryCalls;
  return sql;
}

describe('actions repository contract', () => {
  it('listActions scopes by org and returns total as integer', async () => {
    const sql = createSqlMock({
      queryResponses: [
        [{ action_id: 'a1' }],
        [{ total: '2' }],
        // The real stats query always SELECTs avg_risk/total_cost (COALESCE);
        // the repo coerces those Neon string aggregates to numbers.
        [{ total: '2', completed: '1', avg_risk: '55.5', total_cost: '12.34' }],
      ],
    });

    const result = await actionsRepository.listActions(sql, 'org_1', {
      agent_id: 'agent_1',
      status: 'running',
      risk_min: '70',
      limit: 10,
      offset: 5,
    });

    expect(result.actions).toEqual([{ action_id: 'a1' }]);
    expect(result.total).toBe(2);
    expect(result.stats).toEqual({ total: '2', completed: '1', avg_risk: 55.5, total_cost: 12.34 });
    expect(sql.queryCalls).toHaveLength(3);
    expect(sql.queryCalls[0].text).toContain('FROM action_records');
    expect(sql.queryCalls[0].params).toEqual(['org_1', 'agent_1', 'running', 70, 10, 5]);
    expect(sql.queryCalls[1].text).toContain('COUNT(*) as total');
    expect(sql.queryCalls[2].text).toContain('COUNT(*) FILTER');
  });

  it('hasAgentAction returns boolean existence result', async () => {
    const sql = createSqlMock({ taggedResponses: [[{ exists: 1 }], []] });

    await expect(actionsRepository.hasAgentAction(sql, 'org_1', 'agent_1')).resolves.toBe(true);
    await expect(actionsRepository.hasAgentAction(sql, 'org_1', 'agent_2')).resolves.toBe(false);
  });

  it('createActionRecord returns inserted row', async () => {
    const inserted = { action_id: 'action_1', org_id: 'org_1' };
    const sql = createSqlMock({ taggedResponses: [[inserted]] });

    const result = await actionsRepository.createActionRecord(sql, {
      orgId: 'org_1',
      action_id: 'action_1',
      data: {
        agent_id: 'agent_1',
        action_type: 'sync',
        declared_goal: 'sync records',
      },
      actionStatus: 'running',
      costEstimate: 0,
      signature: null,
      verified: 0,
      timestamp_start: '2026-02-14T00:00:00.000Z',
    });

    expect(result).toEqual(inserted);
    expect(sql.taggedCalls).toHaveLength(1);
    expect(sql.taggedCalls[0].text).toContain('INSERT INTO action_records');
  });

  it('getActionWithRelations returns null when action does not exist', async () => {
    const sql = createSqlMock({ taggedResponses: [[], [], []] });
    await expect(actionsRepository.getActionWithRelations(sql, 'org_1', 'action_1')).resolves.toBeNull();
  });

  it('updateActionOutcome returns null when action does not exist', async () => {
    const sql = createSqlMock({ taggedResponses: [[]] });
    await expect(
      actionsRepository.updateActionOutcome(sql, 'org_1', 'action_1', { status: 'completed' })
    ).resolves.toBeNull();
  });

  it('updateActionOutcome updates fields when action exists', async () => {
    const sql = createSqlMock({
      taggedResponses: [[{ action_id: 'action_1' }]],
      queryResponses: [[{ action_id: 'action_1', status: 'completed' }]],
    });

    const result = await actionsRepository.updateActionOutcome(sql, 'org_1', 'action_1', {
      status: 'completed',
      duration_ms: 42,
    });

    expect(result).toEqual({ action_id: 'action_1', status: 'completed' });
    expect(sql.queryCalls).toHaveLength(1);
    expect(sql.queryCalls[0].text).toContain('UPDATE action_records SET');
    // Param shape is unchanged — the implicit-outcome CASE expressions
    // re-use the existing status param ($1) and do not add new bindings.
    expect(sql.queryCalls[0].params).toEqual(['completed', 42, 'action_1', 'org_1']);
  });

  it('updateActionOutcome implicitly sets outcome_status when status terminates (legacy PATCH path)', async () => {
    const sql = createSqlMock({
      taggedResponses: [[{ action_id: 'action_1' }]],
      queryResponses: [[{ action_id: 'action_1', status: 'completed', outcome_status: 'completed' }]],
    });

    await actionsRepository.updateActionOutcome(sql, 'org_1', 'action_1', {
      status: 'completed',
    });

    const queryText = sql.queryCalls[0].text;
    // The compat-path SQL must wire outcome_status + outcome_at via CASE
    // expressions that re-use the status param. The CASE preserves the
    // one-shot rule by gating on outcome_status = 'pending'.
    expect(queryText).toMatch(/outcome_status\s*=\s*CASE/);
    expect(queryText).toMatch(/outcome_at\s*=\s*CASE/);
    expect(queryText).toMatch(/outcome_status\s*=\s*'pending'/);
    expect(queryText).toContain("'completed'");
    expect(queryText).toContain("'failed'");
    expect(queryText).toContain("'cancelled'");
    expect(queryText).toContain("'blocked'");
  });

  it('updateActionOutcome skips outcome implicit-set when status not provided', async () => {
    const sql = createSqlMock({
      taggedResponses: [[{ action_id: 'action_1' }]],
      queryResponses: [[{ action_id: 'action_1' }]],
    });

    await actionsRepository.updateActionOutcome(sql, 'org_1', 'action_1', {
      duration_ms: 100,
    });

    const queryText = sql.queryCalls[0].text;
    // No status update -> no outcome_status CASE clause emitted.
    expect(queryText).not.toMatch(/outcome_status\s*=\s*CASE/);
    expect(queryText).not.toMatch(/outcome_at\s*=\s*CASE/);
  });
});

describe('messages/context repository contract', () => {
  it('listMessages applies inbox scope and pagination', async () => {
    const sql = createSqlMock({ queryResponses: [[{ id: 'msg_1' }]] });

    const rows = await messagesContextRepository.listMessages(sql, 'org_1', {
      agentId: 'agent_1',
      direction: 'inbox',
      limit: 5,
      offset: 1,
    });

    expect(rows).toEqual([{ id: 'msg_1' }]);
    expect(sql.queryCalls).toHaveLength(1);
    expect(sql.queryCalls[0].text).toContain('FROM agent_messages');
    expect(sql.queryCalls[0].text).toContain("status != 'archived'");
    expect(sql.queryCalls[0].params).toEqual(['org_1', 'agent_1', 'agent_1', 5, 1]);
  });

  it('getUnreadMessageCount supports scoped and global reads', async () => {
    const sql = createSqlMock({
      queryResponses: [[{ count: 3 }]],
      taggedResponses: [[{ count: 7 }]],
    });

    await expect(messagesContextRepository.getUnreadMessageCount(sql, 'org_1', 'agent_1')).resolves.toBe(3);
    await expect(messagesContextRepository.getUnreadMessageCount(sql, 'org_1')).resolves.toBe(7);
  });

  it('createMessage inserts row and supports broadcast defaults', async () => {
    const inserted = { id: 'msg_1', status: 'sent' };
    const sql = createSqlMock({ taggedResponses: [[inserted]] });

    const result = await messagesContextRepository.createMessage(sql, {
      id: 'msg_1',
      orgId: 'org_1',
      thread_id: null,
      from_agent_id: 'agent_1',
      to_agent_id: null,
      message_type: 'info',
      subject: null,
      body: 'hello',
      urgent: false,
      doc_ref: null,
      now: '2026-02-14T00:00:00.000Z',
    });

    expect(result).toEqual(inserted);
    expect(sql.taggedCalls).toHaveLength(1);
    expect(sql.taggedCalls[0].text).toContain('INSERT INTO agent_messages');
    expect(sql.taggedCalls[0].values).toContain('[]');
  });

  it('archiveMessage returns true only when message is updated', async () => {
    const sql = createSqlMock({ taggedResponses: [[{ id: 'msg_1' }], []] });

    await expect(messagesContextRepository.archiveMessage(sql, 'org_1', 'msg_1', 'now')).resolves.toBe(true);
    await expect(messagesContextRepository.archiveMessage(sql, 'org_1', 'msg_2', 'now')).resolves.toBe(false);
  });

  it('listContextThreads scopes to org and optional filters', async () => {
    const sql = createSqlMock({ queryResponses: [[{ id: 'thread_1' }]] });

    const rows = await messagesContextRepository.listContextThreads(sql, 'org_1', {
      agentId: 'agent_1',
      status: 'active',
      limit: 10,
    });

    expect(rows).toEqual([{ id: 'thread_1' }]);
    expect(sql.queryCalls).toHaveLength(1);
    expect(sql.queryCalls[0].text).toContain('FROM context_threads');
    expect(sql.queryCalls[0].params).toEqual(['org_1', 'agent_1', 'active', 10]);
  });

  it('upsertContextThread returns first row from upsert query', async () => {
    const sql = createSqlMock({
      taggedResponses: [[{ id: 'thread_1', name: 'planning' }]],
    });

    const row = await messagesContextRepository.upsertContextThread(sql, {
      id: 'thread_1',
      orgId: 'org_1',
      agent_id: 'agent_1',
      name: 'planning',
      summary: 'daily planning',
      now: '2026-02-14T00:00:00.000Z',
    });

    expect(row).toEqual({ id: 'thread_1', name: 'planning' });
    expect(sql.taggedCalls[0].text).toContain('INSERT INTO context_threads');
    expect(sql.taggedCalls[0].text).toContain('ON CONFLICT');
  });
});

describe('org/team repository contract', () => {
  it('getTeamOrgAndMembers returns organization and member list', async () => {
    const sql = createSqlMock({
      taggedResponses: [[{ id: 'org_1', name: 'Org One' }], [{ id: 'u1' }, { id: 'u2' }]],
    });

    const result = await orgsTeamRepository.getTeamOrgAndMembers(sql, 'org_1');
    expect(result.org).toEqual({ id: 'org_1', name: 'Org One' });
    expect(result.members).toEqual([{ id: 'u1' }, { id: 'u2' }]);
  });

  it('getTeamOrgAndMembers returns null org when missing', async () => {
    const sql = createSqlMock({ taggedResponses: [[], []] });
    const result = await orgsTeamRepository.getTeamOrgAndMembers(sql, 'org_1');
    expect(result.org).toBeNull();
    expect(result.members).toEqual([]);
  });
});
