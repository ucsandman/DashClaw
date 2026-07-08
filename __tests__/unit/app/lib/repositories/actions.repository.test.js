import { describe, expect, it, vi } from 'vitest';
import {
  buildActionGraph,
  listActions,
} from '../../../../../app/lib/repositories/actions.repository.js';

function makeTaggedSqlMock(responses) {
  const queue = [...responses];
  return vi.fn(() => Promise.resolve(queue.shift() ?? []));
}

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

describe('actions.repository paired coverage', () => {
  it('returns null when the action graph root is missing', async () => {
    const sql = makeTaggedSqlMock([[]]);

    const graph = await buildActionGraph(sql, 'org_1', 'act_missing');

    expect(graph).toBeNull();
  });

  it('preserves listActions numeric stat coercion on the query-mock path', async () => {
    const sql = makeQuerySqlMock([
      [],
      [{ total: '0' }],
      [{ avg_risk: '42.5', total_cost: '3.14' }],
    ]);

    const result = await listActions(sql, 'org_1', {});

    expect(result.stats.avg_risk).toBe(42.5);
    expect(result.stats.total_cost).toBe(3.14);
  });

  it('scopes the expired list to approval_expires_at after the cleared cursor', async () => {
    const sql = makeQuerySqlMock([[], [{ total: '0' }], [{}]]);
    const cursor = '2026-07-08T06:00:00.000Z';

    await listActions(sql, 'org_1', { status: 'expired', expired_after: cursor });

    const [listText, listParams] = sql.queryCalls[0];
    expect(listText).toContain('approval_expires_at::timestamptz >');
    expect(listParams).toContain(cursor);
  });

  it('ignores an unparseable expired_after cursor', async () => {
    const sql = makeQuerySqlMock([[], [{ total: '0' }], [{}]]);

    await listActions(sql, 'org_1', { status: 'expired', expired_after: 'not-a-date' });

    const [listText] = sql.queryCalls[0];
    expect(listText).not.toContain('approval_expires_at');
  });
});
