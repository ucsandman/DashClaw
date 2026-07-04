/**
 * Org halt (kill switch) must not ride the 30s per-instance settings cache.
 *
 * /api/halt invalidates eagerly — but only on the lambda that served it. On
 * Vercel, other warm instances kept serving pre-halt state for up to 30s
 * while code comments promised an "immediate-block guarantee". The halt read
 * gets its own dedicated short cache (3s): cross-instance staleness is
 * bounded at ~3s instead of 30s, while the guard hot path stays bounded at
 * one halt query per org per 3s per instance.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetSettings } = vi.hoisted(() => ({ mockGetSettings: vi.fn(async () => []) }));
vi.mock('@/lib/repositories/settings.repository', () => ({ getSettings: mockGetSettings }));

import { getOrgHaltState, invalidateGuardSettingsCache, __resetGuardCaches } from '@/lib/guard';

const HALTED_ROW = {
  key: 'DASHCLAW_ORG_HALT',
  value: JSON.stringify({ halted: true, actor: 'usr_admin', reason: 'incident', at: '2026-07-03T00:00:00.000Z' }),
};

const sql = async () => [];

describe('getOrgHaltState cache bounds', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetGuardCaches();
    vi.useFakeTimers();
    mockGetSettings.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reflects a halt set elsewhere within 3s — NOT the 30s settings TTL', async () => {
    const first = await getOrgHaltState(sql, 'org_1');
    expect(first?.halted ?? false).toBe(false);

    // Halt flipped by another instance — this instance gets no invalidation.
    mockGetSettings.mockResolvedValue([HALTED_ROW]);
    vi.advanceTimersByTime(3_100);

    const second = await getOrgHaltState(sql, 'org_1');
    expect(second?.halted).toBe(true);
  });

  it('serves reads within the short TTL from cache (hot path stays bounded)', async () => {
    await getOrgHaltState(sql, 'org_1');
    await getOrgHaltState(sql, 'org_1');
    expect(mockGetSettings).toHaveBeenCalledTimes(1);
  });

  it('eager invalidation still applies instantly on the serving instance', async () => {
    const first = await getOrgHaltState(sql, 'org_1');
    expect(first?.halted ?? false).toBe(false);

    mockGetSettings.mockResolvedValue([HALTED_ROW]);
    invalidateGuardSettingsCache('org_1');

    const second = await getOrgHaltState(sql, 'org_1');
    expect(second?.halted).toBe(true);
  });
});
