import { describe, it, expect, vi } from 'vitest';
import { getGuardDecisionMix } from '../../app/lib/repositories/guardrails.repository';
import { getPendingApprovalSummary } from '../../app/lib/repositories/actions.repository';

function mockSql(rows) {
  const fn = vi.fn(async () => rows);
  fn.query = vi.fn(async () => rows);
  return fn;
}

it('getGuardDecisionMix splits current vs prior window per decision', async () => {
  const sql = mockSql([
    { decision: 'allow', current_cnt: 100, prior_cnt: 90 },
    { decision: 'require_approval', current_cnt: 12, prior_cnt: 2 },
  ]);
  const mix = await getGuardDecisionMix(sql, 'org1', 24);
  expect(mix.current).toEqual({ allow: 100, require_approval: 12 });
  expect(mix.prior).toEqual({ allow: 90, require_approval: 2 });
});

it('getPendingApprovalSummary returns count and oldest age', async () => {
  const sql = mockSql([{ pending: 3, oldest_at: '2026-06-11T00:00:00Z' }]);
  const s = await getPendingApprovalSummary(sql, 'org1');
  expect(s.pending).toBe(3);
  expect(s.oldest_at).toBe('2026-06-11T00:00:00Z');
});
