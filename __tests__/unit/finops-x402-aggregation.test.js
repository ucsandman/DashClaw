import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getX402SpendAggregation } from '@/lib/repositories/x402.repository.js';

// getX402SpendAggregation builds a conditional agent sql`` fragment before the
// three aggregation queries, so the tagged mock sees that fragment invocation
// first — use mockResolvedValue (not Once-queues) and select the aggregation
// calls by their SQL text.
let sql;
beforeEach(() => { sql = vi.fn(); });

const aggCalls = () => sql.mock.calls.filter((c) => c[0].join(' ').includes('FROM x402_purchases'));

describe('getX402SpendAggregation', () => {
  it('sums spend_amount from x402_purchases, org-scoped, with by_day + by_provider', async () => {
    sql.mockImplementation((strings) => {
      const text = strings.join(' ');
      if (!text.includes('FROM x402_purchases')) return Promise.resolve([]); // fragment
      if (text.includes('GROUP BY DATE')) return Promise.resolve([{ date: '2026-06-05', spend_usd: 1.25, purchase_count: 3 }]);
      if (text.includes('GROUP BY provider_id')) return Promise.resolve([{ provider_id: 'prov_x', spend_usd: 1.25, purchase_count: 3 }]);
      return Promise.resolve([{ total_spend_usd: 1.25, purchase_count: 3 }]);
    });
    const out = await getX402SpendAggregation(sql, 'org_1', { period: '30d' });
    expect(out.total_spend_usd).toBe(1.25);
    expect(out.by_day).toHaveLength(1);
    expect(out.by_provider[0].provider_id).toBe('prov_x');
    const allSql = aggCalls().map((c) => c[0].join(' ')).join(' || ');
    expect(allSql).toContain('SUM(spend_amount)');
    const boundValues = aggCalls().flatMap((c) => c.slice(1));
    expect(boundValues).toContain('org_1');
  });

  it('excludes failed purchases from spend totals (no money moved)', async () => {
    sql.mockResolvedValue([]);
    await getX402SpendAggregation(sql, 'org_1', { period: '30d' });
    const allSql = aggCalls().map((c) => c[0].join(' ')).join(' || ');
    // Every aggregation query must filter out execution_status = 'failed'.
    expect(allSql).toContain('execution_status');
    expect(allSql).toContain("'failed'");
    // The filter must appear in all three queries (total, by_day, by_provider).
    const failedMatches = allSql.split("'failed'").length - 1;
    expect(failedMatches).toBeGreaterThanOrEqual(3);
  });

  it('applies the agent filter to all three queries when agentId is given', async () => {
    sql.mockResolvedValue([]);
    await getX402SpendAggregation(sql, 'org_1', { period: '30d', agentId: 'agent-1' });
    // The conditional fragment binds the agent id once...
    const frag = sql.mock.calls.find((c) => c[0].join('?').includes('AND agent_id ='));
    expect(frag).toBeDefined();
    expect(frag[1]).toBe('agent-1');
    // ...and is interpolated into every aggregation query (3 non-fragment calls).
    expect(aggCalls()).toHaveLength(3);
  });

  it('omits the agent clause when no agentId is given', async () => {
    sql.mockResolvedValue([]);
    await getX402SpendAggregation(sql, 'org_1', { period: '30d' });
    const frag = sql.mock.calls.find((c) => c[0].join('?').includes('AND agent_id ='));
    expect(frag).toBeUndefined();
  });
});
