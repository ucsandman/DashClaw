import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGetSettings, mockUpsert, mockCompose, mockDeliver } = vi.hoisted(() => ({
  mockGetSettings: vi.fn(),
  mockUpsert: vi.fn(async () => {}),
  mockCompose: vi.fn(async () => ({ quiet: true, text: 'Fleet quiet: 10 decisions', pending_approvals: 0, oldest_pending_minutes: null, floods: [], coverage_pct: 100 })),
  mockDeliver: vi.fn(async () => [{ provider: 'slack', success: true, message: 'ok' }]),
}));
vi.mock('../../app/lib/repositories/settings.repository', () => ({ getSettings: mockGetSettings, upsertSetting: mockUpsert }));
vi.mock('../../app/lib/fleet-digest', () => ({ composeFleetDigest: mockCompose }));
vi.mock('../../app/lib/notification-adapters/index', () => ({ deliverNativeNotifications: mockDeliver }));

import { maybeRunDigestTick } from '../../app/lib/digest-tick';

// The tick reads ALL org settings in one query (hot-path discipline) and
// filters client-side, so mocks return one combined row list.
const integrationRow = { key: 'SLACK_WEBHOOK_URL', value: 'enc', category: 'integration' };

beforeEach(() => {
  vi.clearAllMocks();
  mockDeliver.mockResolvedValue([{ provider: 'slack', success: true, message: 'ok' }]);
  // default: creds configured, no marker, no interval override
  mockGetSettings.mockResolvedValue([integrationRow]);
});

describe('maybeRunDigestTick', () => {
  it('issues a single settings read and skips without adapter credentials (before claiming)', async () => {
    mockGetSettings.mockResolvedValue([]);
    const r = await maybeRunDigestTick({}, 'org1');
    expect(r).toMatchObject({ ran: false, reason: 'no_adapters' });
    expect(mockUpsert).not.toHaveBeenCalled();
    expect(mockGetSettings).toHaveBeenCalledTimes(1);
  });

  it('debounces inside the interval on the single read', async () => {
    mockGetSettings.mockResolvedValue([
      integrationRow,
      { key: 'DIGEST_TICK_LAST_RUN_AT', value: new Date().toISOString(), category: 'system' },
    ]);
    const r = await maybeRunDigestTick({}, 'org1');
    expect(r).toMatchObject({ ran: false, reason: 'debounced' });
    expect(mockGetSettings).toHaveBeenCalledTimes(1);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('claims the marker, composes, and delivers when due', async () => {
    const r = await maybeRunDigestTick({}, 'org1');
    expect(r.ran).toBe(true);
    expect(mockUpsert).toHaveBeenCalledWith({}, 'org1', expect.objectContaining({ key: 'DIGEST_TICK_LAST_RUN_AT' }));
    expect(mockDeliver).toHaveBeenCalledTimes(1);
    // quiet digest ships as the lowest severity with the all-clear label
    expect(mockDeliver.mock.calls[0][1][0]).toMatchObject({ severity: 'amber', label: 'Daily fleet digest' });
  });

  it('a needs-attention digest escalates the severity and label', async () => {
    mockCompose.mockResolvedValue({ quiet: false, text: '47 pending approvals', pending_approvals: 47, oldest_pending_minutes: 60, floods: [], coverage_pct: 100 });
    await maybeRunDigestTick({}, 'org1');
    expect(mockDeliver.mock.calls[0][1][0]).toMatchObject({ severity: 'red', label: 'Daily fleet digest — needs attention' });
  });

  it('interval 0 disables', async () => {
    mockGetSettings.mockResolvedValue([
      integrationRow,
      { key: 'DASHCLAW_DIGEST_INTERVAL_HOURS', value: '0', category: 'general' },
    ]);
    const r = await maybeRunDigestTick({}, 'org1');
    expect(r).toMatchObject({ ran: false, reason: 'disabled' });
  });

  it('rolls the marker back when every delivery fails', async () => {
    mockDeliver.mockResolvedValue([{ provider: 'slack', success: false, message: 'down' }]);
    const r = await maybeRunDigestTick({}, 'org1');
    expect(r).toMatchObject({ ran: true, delivered: 0 });
    // 2 upsert calls: claim + rollback
    expect(mockUpsert.mock.calls.length).toBe(2);
  });

  it('returns error (never throws) when the settings read fails', async () => {
    mockGetSettings.mockRejectedValue(new Error('db down'));
    const r = await maybeRunDigestTick({}, 'org1');
    expect(r).toMatchObject({ ran: false, reason: 'error' });
  });
});
