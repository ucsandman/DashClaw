/**
 * FIX B4 (2026-08-14 adversarial review): hasReasonsColumn() probed
 * information_schema on every GET /api/guard list call. It's memoized at
 * module scope now (30s TTL for a not-yet-migrated `false`; a found
 * 'reasons' column never reverts, so `true` is cached indefinitely) — two
 * consecutive listGuardDecisions() calls must issue the information_schema
 * probe only once.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetHasReasonsColumnCache, listGuardDecisions } from '@/lib/repositories/guard.repository.js';

function makeSql() {
  const queries = [];
  const sql = {
    query: vi.fn(async (text) => {
      queries.push(text);
      if (text.includes('information_schema')) return [{ column_name: 'reasons' }];
      if (text.includes('COUNT(*)')) return [{ total: '0' }];
      return [];
    }),
  };
  return { sql, queries };
}

describe('guard.repository hasReasonsColumn cache (FIX B4)', () => {
  beforeEach(() => {
    __resetHasReasonsColumnCache();
  });

  it('issues the information_schema probe only once across two consecutive calls', async () => {
    const { sql, queries } = makeSql();

    await listGuardDecisions(sql, 'org_1', { limit: 10 });
    await listGuardDecisions(sql, 'org_1', { limit: 10 });

    const infoSchemaCalls = queries.filter((q) => q.includes('information_schema'));
    expect(infoSchemaCalls.length).toBe(1);
  });

  it('re-probes after __resetHasReasonsColumnCache() (test isolation hook)', async () => {
    const { sql: sql1 } = makeSql();
    await listGuardDecisions(sql1, 'org_1', { limit: 10 });

    __resetHasReasonsColumnCache();

    const { sql: sql2, queries: queries2 } = makeSql();
    await listGuardDecisions(sql2, 'org_1', { limit: 10 });

    const infoSchemaCalls = queries2.filter((q) => q.includes('information_schema'));
    expect(infoSchemaCalls.length).toBe(1);
  });
});
