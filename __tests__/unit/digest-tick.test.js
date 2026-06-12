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

const integrationCreds = [{ key: 'SLACK_WEBHOOK_URL', value: 'enc' }];

beforeEach(() => {
  vi.clearAllMocks();
  mockDeliver.mockResolvedValue([{ provider: 'slack', success: true, message: 'ok' }]);
  // default: creds configured, no marker, no interval override
  mockGetSettings.mockImplementation(async (_sql, _org, filter = {}) => {
    if (filter.category === 'integration') return integrationCreds;
    return [];
  });
});

describe('maybeRunDigestTick', () => {
  it('skips without adapter credentials (before claiming the marker)', async () => {
    mockGetSettings.mockResolvedValue([]);
    const r = await maybeRunDigestTick({}, 'org1');
    expect(r).toMatchObject({ ran: false, reason: 'no_adapters' });
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it('debounces inside the interval', async () => {
    mockGetSettings.mockImplementation(async (_sql, _org, filter = {}) => {
      if (filter.category === 'integration') return integrationCreds;
      if (filter.key === 'DIGEST_TICK_LAST_RUN_AT') return [{ key: 'DIGEST_TICK_LAST_RUN_AT', value: new Date().toISOString() }];
      return [];
    });
    const r = await maybeRunDigestTick({}, 'org1');
    expect(r).toMatchObject({ ran: false, reason: 'debounced' });
  });

  it('claims the marker, composes, and delivers when due', async () => {
    const r = await maybeRunDigestTick({}, 'org1');
    expect(r.ran).toBe(true);
    expect(mockUpsert).toHaveBeenCalledWith({}, 'org1', expect.objectContaining({ key: 'DIGEST_TICK_LAST_RUN_AT' }));
    expect(mockDeliver).toHaveBeenCalledTimes(1);
  });

  it('interval 0 disables', async () => {
    mockGetSettings.mockImplementation(async (_sql, _org, filter = {}) => {
      if (filter.category === 'integration') return integrationCreds;
      if (filter.key === 'DASHCLAW_DIGEST_INTERVAL_HOURS') return [{ key: 'DASHCLAW_DIGEST_INTERVAL_HOURS', value: '0' }];
      return [];
    });
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
});
