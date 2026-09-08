import { describe, expect, it, vi } from 'vitest';
import { createSqlMock } from '../helpers.js';
import {
  cancelAction,
  getActionCancelFacts,
} from '../../app/lib/repositories/actions.repository.execution.js';

function makeQuerySqlMock(responses) {
  const queue = [...responses];
  const queryCalls = [];
  return {
    queryCalls,
    query: vi.fn((text, params) => {
      queryCalls.push([text, params]);
      const result = queue.shift() ?? [];
      return Promise.resolve(result);
    }),
  };
}

describe('cancelAction', () => {
  it('cancels a never-executed action and stamps the reason', async () => {
    const sql = makeQuerySqlMock([[{ action_id: 'act_1', agent_id: 'agent_1' }]]);

    const result = await cancelAction(sql, {
      orgId: 'org_1',
      actionId: 'act_1',
      reason: 'probe never executed the destructive branch',
    });

    expect(result).toEqual({
      ok: true,
      action_id: 'act_1',
      agent_id: 'agent_1',
      status: 'cancelled',
    });
    const [text, params] = sql.queryCalls[0];
    expect(text).toContain("SET status = 'cancelled'");
    expect(text).toContain("close_source = 'direct'");
    expect(text).toContain('execution_claimed_at IS NULL');
    expect(params).toEqual([
      'org_1',
      'act_1',
      'probe never executed the destructive branch',
    ]);
  });

  it('trims and caps the reason at 4000 chars', async () => {
    const sql = makeQuerySqlMock([[{ action_id: 'act_1', agent_id: null }]]);

    await cancelAction(sql, { orgId: 'org_1', actionId: 'act_1', reason: `  ${'x'.repeat(5000)}  ` });

    const [, params] = sql.queryCalls[0];
    expect(params[2]).toHaveLength(4000);
    expect(params[2].startsWith('x')).toBe(true);
  });

  it('refuses a blank reason at the repository level', async () => {
    const sql = createSqlMock({ queryResponses: [] });
    const result = await cancelAction(sql, { orgId: 'org_1', actionId: 'act_x', reason: '   ' });
    expect(result).toEqual({ ok: false, code: 'REASON_REQUIRED' });
    expect(sql.queryCalls).toHaveLength(0); // no write attempted
  });

  it('refuses a claimed action with NOT_CANCELLABLE and reports the claim', async () => {
    const sql = makeQuerySqlMock([
      [],
      [{
        action_id: 'act_2',
        agent_id: 'agent_2',
        status: 'running',
        outcome_status: 'pending',
        claimed: true,
      }],
    ]);

    const result = await cancelAction(sql, { orgId: 'org_1', actionId: 'act_2', reason: 'too late' });

    expect(result.ok).toBe(false);
    expect(result.code).toBe('NOT_CANCELLABLE');
    expect(result.claimed).toBe(true);
    expect(result.status).toBe('running');
  });

  it('refuses an already-terminal action with NOT_CANCELLABLE', async () => {
    const sql = makeQuerySqlMock([
      [],
      [{
        action_id: 'act_3',
        agent_id: 'agent_3',
        status: 'completed',
        outcome_status: 'completed',
        claimed: true,
      }],
    ]);

    const result = await cancelAction(sql, { orgId: 'org_1', actionId: 'act_3', reason: 'x' });

    expect(result).toMatchObject({ ok: false, code: 'NOT_CANCELLABLE', status: 'completed' });
  });

  it('returns NOT_FOUND for an unknown action', async () => {
    const sql = makeQuerySqlMock([[], []]);

    const result = await cancelAction(sql, { orgId: 'org_1', actionId: 'act_nope', reason: 'x' });

    expect(result).toEqual({ ok: false, code: 'NOT_FOUND' });
  });
});

describe('getActionCancelFacts', () => {
  it('returns null when the action is unknown', async () => {
    const sql = makeQuerySqlMock([[]]);
    expect(await getActionCancelFacts(sql, 'org_1', 'act_nope')).toBeNull();
  });

  it('returns the lifecycle facts for a known action', async () => {
    const row = {
      action_id: 'act_1',
      agent_id: 'agent_1',
      status: 'running',
      outcome_status: 'pending',
      claimed: false,
    };
    const sql = makeQuerySqlMock([[row]]);
    expect(await getActionCancelFacts(sql, 'org_1', 'act_1')).toEqual(row);
  });
});
