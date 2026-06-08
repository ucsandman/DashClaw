import { describe, it, expect } from 'vitest';
import { createSqlMock } from '../helpers.js';
import { getEvalStats } from '../../app/lib/repositories/evaluations.repository.js';

// getEvalStats composes neon `sql` fragments: a conditional fragment is only
// evaluated (and thus recorded by the mock) when its filter is set. Asserting on
// the recorded fragment calls proves the previously-ignored agent_id/scorer_name
// params are now wired into the SQL.
function hashes(sql) {
  return sql.taggedCalls;
}

describe('getEvalStats filter wiring', () => {
  it('joins action_records and filters by agent when agent_id is set', async () => {
    const sql = createSqlMock();
    await getEvalStats(sql, 'org_1', { agentId: 'a1', cutoff: '2026-01-01T00:00:00Z' });

    const calls = hashes(sql);
    expect(calls.some((c) => c.text.includes('LEFT JOIN action_records'))).toBe(true);
    expect(calls.some((c) => c.text.includes('AND ar.agent_id =') && c.values.includes('a1'))).toBe(true);
  });

  it('filters by scorer_name when scorer_name is set', async () => {
    const sql = createSqlMock();
    await getEvalStats(sql, 'org_1', { scorerName: 's1', cutoff: '2026-01-01T00:00:00Z' });

    const calls = hashes(sql);
    expect(calls.some((c) => c.text.includes('AND es.scorer_name =') && c.values.includes('s1'))).toBe(true);
  });

  it('isolates: with no agent/scorer filters, no join or filter fragment is emitted', async () => {
    const sql = createSqlMock();
    await getEvalStats(sql, 'org_1', { cutoff: '2026-01-01T00:00:00Z' });

    const calls = hashes(sql);
    expect(calls.every((c) => !c.text.includes('LEFT JOIN action_records'))).toBe(true);
    expect(calls.every((c) => !c.text.includes('ar.agent_id'))).toBe(true);
    expect(calls.every((c) => !c.text.includes('es.scorer_name ='))).toBe(true);
  });
});

describe('getEvalStats time handling', () => {
  it('compares created_at as ::timestamptz and buckets days with TO_CHAR, not LEFT(created_at)', async () => {
    const sql = createSqlMock();
    await getEvalStats(sql, 'org_1', { cutoff: '2026-01-01T00:00:00Z' });

    const calls = hashes(sql);
    expect(calls.some((c) => c.text.includes('es.created_at::timestamptz >='))).toBe(true);
    expect(calls.some((c) => c.text.includes("TO_CHAR(es.created_at::timestamptz AT TIME ZONE 'UTC'"))).toBe(true);
    // The only remaining LEFT() is on the `now` param (RHS), never on created_at.
    expect(calls.every((c) => !c.text.includes('LEFT(es.created_at') && !c.text.includes('LEFT(created_at'))).toBe(true);
  });
});
