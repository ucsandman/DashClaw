import { describe, it, expect, vi } from 'vitest';
import { getRecentApprovalCountsByPolicy, getPolicyNamesByIds } from '../../app/lib/repositories/guardrails.repository';

function mockSql(rows) {
  const fn = vi.fn(async () => rows);
  fn.query = vi.fn(async () => rows);
  return fn;
}

describe('getRecentApprovalCountsByPolicy', () => {
  it('returns a policy_id → count map from require_approval decisions in the window', async () => {
    const sql = mockSql([
      { policy_id: 'gp_a', cnt: 47 },
      { policy_id: 'gp_b', cnt: 3 },
    ]);
    const counts = await getRecentApprovalCountsByPolicy(sql, 'org1', 15);
    expect(counts).toEqual({ gp_a: 47, gp_b: 3 });
    const text = sql.query.mock.calls[0][0];
    expect(text).toContain("decision = 'require_approval'");
    expect(text).toContain('make_interval(mins =>');
    expect(sql.query.mock.calls[0][1]).toEqual(['org1', 15]);
  });
});

describe('getPolicyNamesByIds', () => {
  it('returns id → name for the requested policies only', async () => {
    const sql = mockSql([{ id: 'gp_a', name: '[Tightened] other' }]);
    const names = await getPolicyNamesByIds(sql, 'org1', ['gp_a', 'gp_missing']);
    expect(names).toEqual({ gp_a: '[Tightened] other' });
  });
  it('returns {} for an empty id list without querying', async () => {
    const sql = mockSql([]);
    expect(await getPolicyNamesByIds(sql, 'org1', [])).toEqual({});
    expect(sql.query).not.toHaveBeenCalled();
  });
});
