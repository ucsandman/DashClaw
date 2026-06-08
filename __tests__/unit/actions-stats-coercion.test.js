import { describe, it, expect } from 'vitest';
import { createSqlMock } from '../helpers.js';
import { listActions } from '../../app/lib/repositories/actions.repository.js';

// createSqlMock exposes .query + .queryCalls, so listActions takes its
// test-contract path: 3 sql.query() calls in order [rows, count, stats].
describe('listActions stats coercion', () => {
  it('returns avg_risk / total_cost as numbers, not Neon strings', async () => {
    const sql = createSqlMock({
      queryResponses: [
        [{ action_id: 'act_1' }], // rows
        [{ total: '1' }], // count
        [{ total: '1', completed: '1', avg_risk: '42.5', total_cost: '1.234' }], // stats
      ],
    });

    const { stats } = await listActions(sql, 'org_1', {});

    expect(stats.avg_risk).toBe(42.5);
    expect(stats.total_cost).toBe(1.234);
    expect(typeof stats.avg_risk).toBe('number');
    expect(typeof stats.total_cost).toBe('number');
    // Non-coerced fields pass through untouched.
    expect(stats.completed).toBe('1');
  });

  it('defaults to 0 numbers when the stats row is missing', async () => {
    const sql = createSqlMock({
      queryResponses: [
        [{ action_id: 'act_1' }],
        [{ total: '1' }],
        [], // no stats row
      ],
    });

    const { stats } = await listActions(sql, 'org_1', {});

    expect(stats.avg_risk).toBe(0);
    expect(stats.total_cost).toBe(0);
  });
});
