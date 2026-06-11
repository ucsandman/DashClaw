import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCostAggregation } from '@/lib/repositories/actions.repository.js';

let sql;
beforeEach(() => { sql = vi.fn().mockResolvedValue([{ total_cost_usd: 0, total_tokens_in: 0, total_tokens_out: 0 }]); });

describe('getCostAggregation — Agent Spend excludes x402 purchases', () => {
  it('adds an action_type <> x402_purchase filter to all three rollup queries', async () => {
    await getCostAggregation(sql, 'org_1', { period: '30d' });
    const allSql = sql.mock.calls.map((c) => c[0].join(' ')).join(' || ');
    const matches = allSql.match(/action_type <> 'x402_purchase'/g) || [];
    expect(matches.length).toBe(3); // total + by_agent + by_day each exclude x402
  });

  it('stays org-scoped', async () => {
    await getCostAggregation(sql, 'org_1', { period: '7d' });
    const boundValues = sql.mock.calls.flatMap((c) => c.slice(1));
    expect(boundValues).toContain('org_1');
  });
});

describe('getCostAggregation — attribution coverage', () => {
  it('adds a tokens FILTER count to totals and by_agent queries', async () => {
    await getCostAggregation(sql, 'org_1', { period: '30d' });
    const allSql = sql.mock.calls.map((c) => c[0].join(' ')).join(' || ');
    const matches = allSql.match(/FILTER \(WHERE COALESCE\(tokens_in, 0\) > 0 OR COALESCE\(tokens_out, 0\) > 0\)/g) || [];
    expect(matches.length).toBe(2); // totals + by_agent
  });

  it('returns attribution totals and per-agent coverage_pct', async () => {
    sql = vi.fn((strings = ['']) => {
      const text = Array.isArray(strings) ? strings.join(' ') : '';
      if (text.includes('GROUP BY agent_id')) {
        return Promise.resolve([
          { agent_id: 'a1', cost_usd: 1, action_count: 2, attributed_count: 1 },
          { agent_id: 'a2', cost_usd: 0, action_count: 2, attributed_count: 0 },
        ]);
      }
      if (text.includes('GROUP BY DATE')) return Promise.resolve([]);
      if (text.includes('SUM(cost_estimate)')) {
        return Promise.resolve([{ total_cost_usd: 1, total_tokens_in: '10', total_tokens_out: '5', total_count: 4, attributed_count: 1 }]);
      }
      return Promise.resolve([]);
    });
    const res = await getCostAggregation(sql, 'org_1', {});
    expect(res.attribution).toEqual({ attributed_count: 1, total_count: 4, coverage_pct: 25 });
    expect(res.by_agent[0].coverage_pct).toBe(50);
    expect(res.by_agent[1].coverage_pct).toBe(0);
  });

  it('coverage_pct is null when there are no actions', async () => {
    sql = vi.fn((strings = ['']) => {
      const text = Array.isArray(strings) ? strings.join(' ') : '';
      if (text.includes('SUM(cost_estimate)')) {
        return Promise.resolve([{ total_cost_usd: 0, total_tokens_in: 0, total_tokens_out: 0, total_count: 0, attributed_count: 0 }]);
      }
      return Promise.resolve([]);
    });
    const res = await getCostAggregation(sql, 'org_1', {});
    expect(res.attribution.coverage_pct).toBeNull();
  });
});
