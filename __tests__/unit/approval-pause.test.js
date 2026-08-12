/**
 * The approval pause: "stop asking me for a while" without turning governance
 * off. MAINTAINER.md records that approval friction caused all org policies to
 * be switched off for 18 days in June 2026 — this feature is the bounded,
 * self-expiring, loudly-rendered version of that act.
 *
 * The four properties that make it safe rather than a relabelled outage:
 *   1. It expires on its own, decided on every READ against `until`, so a
 *      forgotten pause cannot become a standing one and no cron is involved.
 *   2. It never touches `block`.
 *   3. It never clears a verdict raised by an `ungrantable` rule, so the
 *      control-plane and catastrophe rules still reach a human.
 *   4. It never edits a policy, so expiry restores the exact prior posture.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetSettings } = vi.hoisted(() => ({ mockGetSettings: vi.fn(async () => []) }));
vi.mock('@/lib/repositories/settings.repository', () => ({ getSettings: mockGetSettings }));

import {
  getActiveApprovalPause,
  approvalPauseIsActive,
  invalidateGuardSettingsCache,
  APPROVAL_PAUSE_KEY,
  __resetGuardCaches,
} from '@/lib/guard';

const sql = async () => [];

function pauseRow(until, actor = 'usr_admin') {
  return { key: APPROVAL_PAUSE_KEY, value: JSON.stringify({ until, actor, reason: null, at: '2026-08-12T00:00:00.000Z' }) };
}

describe('approvalPauseIsActive', () => {
  it('is inactive for absent, malformed and past pauses', () => {
    expect(approvalPauseIsActive(null)).toBe(false);
    expect(approvalPauseIsActive(undefined)).toBe(false);
    expect(approvalPauseIsActive({})).toBe(false);
    expect(approvalPauseIsActive({ until: 'not-a-date' })).toBe(false);
    expect(approvalPauseIsActive({ until: new Date(Date.now() - 1000).toISOString() })).toBe(false);
  });

  it('is active only while `until` is still ahead of the clock', () => {
    expect(approvalPauseIsActive({ until: new Date(Date.now() + 60_000).toISOString() })).toBe(true);
  });
});

describe('getActiveApprovalPause', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetGuardCaches();
    vi.useFakeTimers();
    mockGetSettings.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the pause while it is live', async () => {
    mockGetSettings.mockResolvedValue([pauseRow(new Date(Date.now() + 3_600_000).toISOString())]);
    const pause = await getActiveApprovalPause(sql, 'org_1');
    expect(pause?.actor).toBe('usr_admin');
  });

  it('expires itself without a write, a cron, or a cache flush', async () => {
    // The whole safety story: nothing has to remember to turn this off.
    mockGetSettings.mockResolvedValue([pauseRow(new Date(Date.now() + 3_600_000).toISOString())]);
    expect(await getActiveApprovalPause(sql, 'org_1')).not.toBeNull();

    vi.advanceTimersByTime(3_600_001);

    // Same settings row, same stored value — only the clock moved.
    expect(await getActiveApprovalPause(sql, 'org_1')).toBeNull();
  });

  it('rides the halt cache TTL so RESUMING reaches a warm instance in ~3s', async () => {
    // Resuming governance is a safety action; it must not wait out the 30s
    // settings TTL on an instance that did not serve the DELETE.
    mockGetSettings.mockResolvedValue([pauseRow(new Date(Date.now() + 3_600_000).toISOString())]);
    expect(await getActiveApprovalPause(sql, 'org_1')).not.toBeNull();

    mockGetSettings.mockResolvedValue([]); // cleared by another instance
    vi.advanceTimersByTime(3_100);

    expect(await getActiveApprovalPause(sql, 'org_1')).toBeNull();
  });

  it('costs no extra query — it rides the settings read halt already forces', async () => {
    mockGetSettings.mockResolvedValue([pauseRow(new Date(Date.now() + 3_600_000).toISOString())]);
    await getActiveApprovalPause(sql, 'org_1');
    await getActiveApprovalPause(sql, 'org_1');
    await getActiveApprovalPause(sql, 'org_1');
    expect(mockGetSettings).toHaveBeenCalledTimes(1);
  });

  it('applies eager invalidation on the instance that served the change', async () => {
    mockGetSettings.mockResolvedValue([pauseRow(new Date(Date.now() + 3_600_000).toISOString())]);
    expect(await getActiveApprovalPause(sql, 'org_1')).not.toBeNull();

    mockGetSettings.mockResolvedValue([]);
    invalidateGuardSettingsCache('org_1');

    expect(await getActiveApprovalPause(sql, 'org_1')).toBeNull();
  });
});
