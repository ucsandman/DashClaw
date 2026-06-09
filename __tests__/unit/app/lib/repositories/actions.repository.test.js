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
});
