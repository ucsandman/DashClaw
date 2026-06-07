import { describe, it, expect, vi } from 'vitest';
import {
  getDecisionCountsByPolicy,
  getDecisionOutcomeCounts,
} from '../../app/lib/repositories/guardrails.repository';

// `.query`-style SqlClient mock (mirrors getGuardDecisionStats' usage).
function queryMock(rows: Record<string, unknown>[]) {
  return { query: vi.fn().mockResolvedValue(rows) };
}
type SqlArg = Parameters<typeof getDecisionCountsByPolicy>[0];

describe('getDecisionCountsByPolicy', () => {
  it('keys by policy id and coerces numeric strings (Neon returns counts as strings)', async () => {
    const sql = queryMock([
      { policy_id: 'pol_a', cnt: '5', last_fired: '2026-06-05T10:00:00Z' },
      { policy_id: 'pol_b', cnt: 3, last_fired: null },
    ]);
    const out = await getDecisionCountsByPolicy(sql as unknown as SqlArg, 'org_1', 30);
    expect(out).toEqual({
      pol_a: { fired: 5, lastFiredAt: '2026-06-05T10:00:00Z' },
      pol_b: { fired: 3, lastFiredAt: null },
    });
    expect(sql.query).toHaveBeenCalledWith(expect.any(String), ['org_1', 30]);
    // Defensive guards: array-shaped JSON only, and the unnest is present.
    const text = sql.query.mock.calls[0]![0] as string;
    expect(text).toContain("LIKE '[%'");
    expect(text).toContain('jsonb_array_elements_text');
  });

  it('returns an empty map when there are no decisions', async () => {
    const sql = queryMock([]);
    expect(await getDecisionCountsByPolicy(sql as unknown as SqlArg, 'org_1')).toEqual({});
  });
});

describe('getDecisionOutcomeCounts', () => {
  it('derives allow = total − warn − require_approval − block', async () => {
    const sql = queryMock([{ total: '100', warn: '10', require_approval: '5', block: '2' }]);
    const out = await getDecisionOutcomeCounts(sql as unknown as SqlArg, 'org_1', 30);
    expect(out).toEqual({ total: 100, allow: 83, warn: 10, require_approval: 5, block: 2 });
  });

  it('floors allow at 0 and defaults a missing row to zeros', async () => {
    const sql = queryMock([]);
    expect(await getDecisionOutcomeCounts(sql as unknown as SqlArg, 'org_1')).toEqual({
      total: 0,
      allow: 0,
      warn: 0,
      require_approval: 0,
      block: 0,
    });
  });
});
