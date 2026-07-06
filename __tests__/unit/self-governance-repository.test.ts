/** self-governance.repository — numeric coercion + ISO timestamps + fixed decision keys (v7.3). */
import { describe, it, expect, vi } from 'vitest';
import { getSelfGovernanceStats } from '../../app/lib/repositories/self-governance.repository';
import type { SqlTag } from '../../app/lib/types/db';

function makeSql(actionRow: Record<string, unknown>, decisionRow: Record<string, unknown>): SqlTag {
  let call = 0;
  const tag = vi.fn(() => {
    call += 1;
    return Promise.resolve(call === 1 ? [actionRow] : [decisionRow]);
  }) as unknown as SqlTag;
  (tag as { query?: unknown }).query = vi.fn();
  return tag;
}

describe('getSelfGovernanceStats', () => {
  it('coerces pg string numerics and converts timestamps to ISO', async () => {
    const sql = makeSql(
      {
        total: '4200', last30d: '310', last7d: '90',
        first_at: new Date('2026-04-10T00:00:00Z'), latest_at: '2026-07-05 12:00:00+00',
        active_days: '80',
      },
      {
        total: '900', last30d: '120',
        allow_count: '700', warn_count: '120', block_count: '30', require_approval_count: '50',
      },
    );
    const stats = await getSelfGovernanceStats(sql);
    expect(stats.actions.total).toBe(4200);
    expect(stats.actions.activeDays).toBe(80);
    expect(stats.actions.firstAt).toBe('2026-04-10T00:00:00.000Z');
    expect(stats.actions.latestAt).toBe('2026-07-05T12:00:00.000Z');
    expect(stats.decisions.byDecision).toEqual({ allow: 700, warn: 120, block: 30, require_approval: 50 });
  });

  it('returns zeros and nulls on an empty instance', async () => {
    const sql = makeSql(
      { total: '0', last30d: '0', last7d: '0', first_at: null, latest_at: null, active_days: '0' },
      { total: '0', last30d: '0', allow_count: '0', warn_count: '0', block_count: '0', require_approval_count: '0' },
    );
    const stats = await getSelfGovernanceStats(sql);
    expect(stats.actions.total).toBe(0);
    expect(stats.actions.firstAt).toBeNull();
    expect(stats.actions.latestAt).toBeNull();
    expect(stats.decisions.total).toBe(0);
  });
});
