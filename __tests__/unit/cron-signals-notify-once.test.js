/**
 * Regression test for the duplicate-notification race in GET /api/cron/signals
 * (adversarial review finding, concurrency/major): the route used to read
 * existing snapshot hashes, classify "new" signals from that read, fire
 * notifications, and only afterwards write the snapshot. Two overlapping
 * invocations (Vercel cron retry, manual re-trigger) could both read before
 * either wrote, so both classified the same signals as new and both notified.
 *
 * The fix makes claimNewSignalSnapshots() the single source of truth for
 * "is this signal new" — it writes the snapshot (claiming the row via
 * INSERT ... ON CONFLICT DO NOTHING) and returns only the hashes THIS call
 * actually inserted. Notifications must fire only for those hashes.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRequest } from '../helpers.js';

const {
  mockComputeSignals,
  mockClaimNewSignalSnapshots,
  mockFireWebhooksForOrg,
  mockPublishOrgEvent,
  mockDeliverNativeNotifications,
  mockGetSettings,
  mockSendSignalAlertEmail,
} = vi.hoisted(() => ({
  mockComputeSignals: vi.fn(),
  mockClaimNewSignalSnapshots: vi.fn(),
  mockFireWebhooksForOrg: vi.fn(async () => []),
  mockPublishOrgEvent: vi.fn(),
  mockDeliverNativeNotifications: vi.fn(async () => []),
  mockGetSettings: vi.fn(async () => []),
  mockSendSignalAlertEmail: vi.fn(async () => false),
}));

vi.mock('@/lib/db.js', () => ({ getSql: () => makeSql() }));
vi.mock('@/lib/signals.js', () => ({ computeSignals: mockComputeSignals }));
vi.mock('@/lib/timing-safe.js', () => ({ timingSafeCompare: () => true }));
vi.mock('@/lib/webhooks.js', () => ({ fireWebhooksForOrg: mockFireWebhooksForOrg }));
vi.mock('@/lib/notifications.js', () => ({ sendSignalAlertEmail: mockSendSignalAlertEmail }));
vi.mock('@/lib/audit.js', () => ({ logActivity: vi.fn() }));
vi.mock('@/lib/events.js', () => ({
  EVENTS: { SIGNAL_DETECTED: 'signal.detected' },
  publishOrgEvent: mockPublishOrgEvent,
}));
vi.mock('@/lib/notification-adapters/index.js', () => ({
  deliverNativeNotifications: mockDeliverNativeNotifications,
}));
vi.mock('@/lib/repositories/settings.repository.js', () => ({ getSettings: mockGetSettings }));
vi.mock('@/lib/repositories/signals.repository.js', () => ({
  claimNewSignalSnapshots: mockClaimNewSignalSnapshots,
}));
vi.mock('@/lib/repositories/orgs.repository.js', () => ({
  listOrganizations: async () => [{ id: 'org_1', name: 'Org One' }],
}));
vi.mock('@/lib/hosted/flag.js', () => ({ isHostedMode: () => false }));

// Tagged-template sql mock — only the email-preferences query runs in this
// route path once notifications proceed, and it should resolve empty.
function makeSql() {
  const fn = vi.fn(async () => []);
  fn.query = vi.fn(async () => []);
  return fn;
}

const { GET, hashSignal } = await import('@/api/cron/signals/route.js');

const request = () =>
  makeRequest('http://localhost/api/cron/signals', { headers: { authorization: 'Bearer test-secret' } });

const SIGNALS = [
  { type: 'autonomy_spike', severity: 'red', agent_id: 'a1' },
  { type: 'stale_assumption', severity: 'amber', agent_id: 'a2' },
];

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CRON_SECRET = 'test-secret';
  mockComputeSignals.mockResolvedValue(SIGNALS);
});

describe('GET /api/cron/signals — notify only for claimed (inserted) hashes', () => {
  it('fires webhooks/native/SSE only for the hashes claimNewSignalSnapshots reports as inserted', async () => {
    const wantedHash = hashSignal({ ...SIGNALS[0], agent_id: 'a1' });
    // Only the first signal actually wins the INSERT race.
    mockClaimNewSignalSnapshots.mockResolvedValue([wantedHash]);

    const res = await GET(request());
    expect(res.status).toBe(200);
    const body = await res.json();

    // The snapshot claim ran before any notification — the write-then-notify order.
    expect(mockClaimNewSignalSnapshots).toHaveBeenCalledTimes(1);

    expect(body.summary.new_signals).toBe(1);
    expect(mockFireWebhooksForOrg).toHaveBeenCalledTimes(1);
    const [, webhookSignals] = mockFireWebhooksForOrg.mock.calls[0];
    expect(webhookSignals).toHaveLength(1);
    expect(webhookSignals[0].type).toBe('autonomy_spike');

    expect(mockPublishOrgEvent).toHaveBeenCalledTimes(1);
    expect(mockDeliverNativeNotifications).toHaveBeenCalledTimes(1);
    const [, nativeSignals] = mockDeliverNativeNotifications.mock.calls[0];
    expect(nativeSignals).toHaveLength(1);
  });

  it('sends zero notifications when claimNewSignalSnapshots reports zero inserted hashes (duplicate-run case)', async () => {
    // Simulates the overlapping-run scenario this fix targets: another
    // invocation already claimed every signal, so this run inserts nothing.
    mockClaimNewSignalSnapshots.mockResolvedValue([]);

    const res = await GET(request());
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(mockClaimNewSignalSnapshots).toHaveBeenCalledTimes(1);
    expect(body.summary.new_signals).toBe(0);
    expect(mockFireWebhooksForOrg).not.toHaveBeenCalled();
    expect(mockPublishOrgEvent).not.toHaveBeenCalled();
    expect(mockDeliverNativeNotifications).not.toHaveBeenCalled();
    expect(mockSendSignalAlertEmail).not.toHaveBeenCalled();
  });
});
