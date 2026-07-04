import { describe, it, expect, vi } from 'vitest';
import { getRecentApprovalCountsByPolicy, getPolicyNamesByIds } from '../../app/lib/repositories/guardrails.repository';
import { SYNTHETIC_ACTION_TYPE_LIKE_PATTERNS, SYNTHETIC_AGENT_LIKE_PATTERNS } from '../../app/lib/calibration-mining.js';

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
    expect(sql.query.mock.calls[0][1]).toEqual([
      'org1', 15, false, SYNTHETIC_ACTION_TYPE_LIKE_PATTERNS, SYNTHETIC_AGENT_LIKE_PATTERNS,
    ]);
  });

  it('excludes synthetic traffic by default (v3.1 shared predicate in SQL)', async () => {
    const sql = mockSql([]);
    await getRecentApprovalCountsByPolicy(sql, 'org1', 15);
    const text = sql.query.mock.calls[0][0];
    // Synthetic rows must be excluded INSIDE the unnest subquery, before
    // aggregation — harness traffic (smoke, loadtest, liveproof) can never
    // trip a policy or fleet budget.
    expect(text).toContain('action_type NOT LIKE ALL($4::text[])');
    expect(text).toContain('agent_id NOT LIKE ALL($5::text[])');
    expect(sql.query.mock.calls[0][1][2]).toBe(false);
  });

  it('includeSynthetic:true flips only the escape-hatch flag (floods diagnostic view)', async () => {
    const sql = mockSql([]);
    await getRecentApprovalCountsByPolicy(sql, 'org1', 15, { includeSynthetic: true });
    expect(sql.query.mock.calls[0][1]).toEqual([
      'org1', 15, true, SYNTHETIC_ACTION_TYPE_LIKE_PATTERNS, SYNTHETIC_AGENT_LIKE_PATTERNS,
    ]);
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
