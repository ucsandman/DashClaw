import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// org_default scoping in alert/maintenance crons (2026-08-08).
// On a SELF-HOSTED deploy the operator's org IS org_default (app/lib/auth.ts
// promotes the first user to admin of org_default), but the signals and
// memory-maintenance crons excluded it unconditionally — so signals.detected
// webhooks/emails could structurally never fire for a self-hosted operator.
// The exclusion is only correct on the HOSTED deployment (DASHCLAW_HOSTED=true),
// where org_default is the shared legacy bucket, not a real tenant.

const { mockComputeSignals, mockGetSql, mockTimingSafe, mockMaintenance } = vi.hoisted(() => ({
  mockComputeSignals: vi.fn(async () => []),
  mockGetSql: vi.fn(),
  mockTimingSafe: vi.fn(() => true),
  mockMaintenance: vi.fn(async () => ({ status: 'skipped' })),
}));

vi.mock('../../app/lib/signals.js', () => ({ computeSignals: mockComputeSignals }));
vi.mock('../../app/lib/db.js', () => ({ getSql: mockGetSql }));
vi.mock('../../app/lib/webhooks.js', () => ({ fireWebhooksForOrg: vi.fn(async () => []) }));
vi.mock('../../app/lib/notifications.js', () => ({ sendSignalAlertEmail: vi.fn() }));
vi.mock('../../app/lib/audit.js', () => ({ logActivity: vi.fn() }));
vi.mock('../../app/lib/timing-safe.js', () => ({ timingSafeCompare: mockTimingSafe }));
vi.mock('../../app/lib/events.js', () => ({ EVENTS: {}, publishOrgEvent: vi.fn() }));
vi.mock('../../app/lib/maintenance.js', () => ({ runMemoryMaintenance: mockMaintenance }));
vi.mock('../../app/lib/repositories/signals.repository.js', () => ({
  getExistingSignalHashes: vi.fn(async () => []),
  upsertSignalSnapshots: vi.fn(async () => {}),
}));

import { GET as signalsCron } from '../../app/api/cron/signals/route';
import { GET as maintenanceCron } from '../../app/api/cron/memory-maintenance/route';

const ORG_ROWS = [
  { id: 'org_default', name: 'Default Organization' },
  { id: 'org_real', name: 'Real Tenant' },
];

// Behaves like the real DB: honors an `!= 'org_default'` WHERE clause if the
// route's query carries one, so assertions run against which orgs get
// PROCESSED, not against SQL text.
function makeSql() {
  const fn = vi.fn(async (strings) => {
    const text = Array.isArray(strings) ? strings.join(' ') : String(strings);
    if (text.includes('FROM organizations')) {
      return text.includes("!= 'org_default'")
        ? ORG_ROWS.filter((o) => o.id !== 'org_default')
        : ORG_ROWS;
    }
    return [];
  });
  fn.query = vi.fn(async () => []);
  return fn;
}

const request = () =>
  new Request('http://localhost/api/cron/x', { headers: { authorization: 'Bearer test-secret' } });

const envBefore = {};
beforeEach(() => {
  vi.clearAllMocks();
  mockTimingSafe.mockReturnValue(true);
  mockGetSql.mockReturnValue(makeSql());
  envBefore.CRON_SECRET = process.env.CRON_SECRET;
  envBefore.DASHCLAW_HOSTED = process.env.DASHCLAW_HOSTED;
  process.env.CRON_SECRET = 'test-secret';
  delete process.env.DASHCLAW_HOSTED;
});

afterEach(() => {
  if (envBefore.CRON_SECRET === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = envBefore.CRON_SECRET;
  if (envBefore.DASHCLAW_HOSTED === undefined) delete process.env.DASHCLAW_HOSTED;
  else process.env.DASHCLAW_HOSTED = envBefore.DASHCLAW_HOSTED;
});

describe('signals cron — org_default scope', () => {
  it('processes org_default on a self-hosted deploy (DASHCLAW_HOSTED unset)', async () => {
    const res = await signalsCron(request());
    expect(res.status).toBe(200);
    const orgIds = mockComputeSignals.mock.calls.map((c) => c[0]);
    expect(orgIds).toContain('org_default');
    expect(orgIds).toContain('org_real');
  });

  it('still excludes org_default on the hosted deployment', async () => {
    process.env.DASHCLAW_HOSTED = 'true';
    const res = await signalsCron(request());
    expect(res.status).toBe(200);
    const orgIds = mockComputeSignals.mock.calls.map((c) => c[0]);
    expect(orgIds).not.toContain('org_default');
    expect(orgIds).toContain('org_real');
  });
});

describe('memory-maintenance cron — org_default scope', () => {
  it('processes org_default on a self-hosted deploy (DASHCLAW_HOSTED unset)', async () => {
    const res = await maintenanceCron(request());
    expect(res.status).toBe(200);
    const orgIds = mockMaintenance.mock.calls.map((c) => c[0]);
    expect(orgIds).toContain('org_default');
    expect(orgIds).toContain('org_real');
  });

  it('still excludes org_default on the hosted deployment', async () => {
    process.env.DASHCLAW_HOSTED = 'true';
    const res = await maintenanceCron(request());
    expect(res.status).toBe(200);
    const orgIds = mockMaintenance.mock.calls.map((c) => c[0]);
    expect(orgIds).not.toContain('org_default');
    expect(orgIds).toContain('org_real');
  });
});
