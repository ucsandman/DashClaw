/**
 * Cron sweep route — verifies CRON_SECRET auth, per-org timeout resolution,
 * batch transition to lost_confirmation, and signal/webhook fan-out.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { makeRequest } from '../helpers.js';

const {
  mockSql,
  mockTimingSafeCompare,
  mockListOrgs,
  mockSweep,
  mockGetSettings,
  mockFireWebhooks,
  mockPublishOrgEvent,
  mockSweepSessions,
} = vi.hoisted(() => ({
  mockSql: Object.assign(vi.fn(async () => []), { query: vi.fn(async () => []) }),
  mockTimingSafeCompare: vi.fn(),
  mockListOrgs: vi.fn(),
  mockSweep: vi.fn(),
  mockGetSettings: vi.fn(),
  mockFireWebhooks: vi.fn(),
  mockPublishOrgEvent: vi.fn(),
  mockSweepSessions: vi.fn(),
}));

vi.mock('@/lib/db.js', () => ({ getSql: () => mockSql }));
vi.mock('@/lib/timing-safe.js', () => ({ timingSafeCompare: mockTimingSafeCompare }));
vi.mock('@/lib/events.js', () => ({
  EVENTS: { SIGNAL_DETECTED: 'signal.detected' },
  publishOrgEvent: mockPublishOrgEvent,
}));
vi.mock('@/lib/webhooks.js', () => ({ fireWebhooksForOrg: mockFireWebhooks }));
vi.mock('@/lib/repositories/actions.repository.js', () => ({
  listOrgsWithStaleOutcomes: mockListOrgs,
  sweepLostOutcomesForOrg: mockSweep,
}));
vi.mock('@/lib/repositories/settings.repository.js', () => ({
  getSettings: mockGetSettings,
}));
vi.mock('@/lib/sessions.js', () => ({
  sweepAbandonedSessions: mockSweepSessions,
}));

import { GET } from '@/api/cron/outcome-sweep/route.js';

function req(headers = {}) {
  return makeRequest('http://localhost/api/cron/outcome-sweep', { headers });
}

describe('/api/cron/outcome-sweep', () => {
  const savedSecret = process.env.CRON_SECRET;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATABASE_URL = 'postgres://unit-test';
    process.env.CRON_SECRET = 'super-secret-cron-token';
    mockTimingSafeCompare.mockReturnValue(false);
    mockListOrgs.mockResolvedValue([]);
    mockSweep.mockResolvedValue([]);
    mockGetSettings.mockResolvedValue([]);
    mockFireWebhooks.mockResolvedValue([]);
    mockPublishOrgEvent.mockResolvedValue(undefined);
    mockSweepSessions.mockResolvedValue([]);
  });

  afterEach(() => {
    if (savedSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = savedSecret;
  });

  it('returns 503 when CRON_SECRET is missing', async () => {
    delete process.env.CRON_SECRET;
    const res = await GET(req({ authorization: 'Bearer anything' }));
    expect(res.status).toBe(503);
  });

  it('returns 401 when no auth header is present', async () => {
    const res = await GET(req());
    expect(res.status).toBe(401);
  });

  it('returns 401 when token does not match', async () => {
    const res = await GET(req({ authorization: 'Bearer wrong' }));
    expect(res.status).toBe(401);
    expect(mockListOrgs).not.toHaveBeenCalled();
  });

  it('returns ok summary with no orgs to scan', async () => {
    mockTimingSafeCompare.mockReturnValue(true);
    const res = await GET(req({ authorization: 'Bearer super-secret-cron-token' }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toEqual({ ok: true, orgs_scanned: 0, rows_swept: 0, webhooks_fired: 0, sessions_closed: 0 });
  });

  it('reaps abandoned sessions and reports the count', async () => {
    mockTimingSafeCompare.mockReturnValue(true);
    mockSweepSessions.mockResolvedValue([
      { id: 'sess_1', org_id: 'org_a', agent_id: 'agent-1' },
      { id: 'sess_2', org_id: 'org_b', agent_id: 'agent-2' },
    ]);
    const res = await GET(req({ authorization: 'Bearer super-secret-cron-token' }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.sessions_closed).toBe(2);
  });

  it('a session-reap failure does not block the outcome sweep', async () => {
    mockTimingSafeCompare.mockReturnValue(true);
    mockSweepSessions.mockRejectedValue(new Error('reap boom'));
    mockListOrgs.mockResolvedValue(['org_a']);
    mockSweep.mockResolvedValue([]);
    const res = await GET(req({ authorization: 'Bearer super-secret-cron-token' }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.sessions_closed).toBe(0);
    expect(data.orgs_scanned).toBe(1);
  });

  it('sweeps each org with the resolved per-org timeout', async () => {
    mockTimingSafeCompare.mockReturnValue(true);
    mockListOrgs.mockResolvedValue(['org_a', 'org_b']);
    mockGetSettings.mockImplementation(async (_sql, orgId) => {
      if (orgId === 'org_a') return [{ value: '30' }];
      return []; // org_b → default 15
    });
    mockSweep.mockResolvedValue([]);

    const res = await GET(req({ authorization: 'Bearer super-secret-cron-token' }));
    expect(res.status).toBe(200);
    expect(mockSweep).toHaveBeenCalledTimes(2);
    expect(mockSweep).toHaveBeenCalledWith(mockSql, 'org_a', 30);
    expect(mockSweep).toHaveBeenCalledWith(mockSql, 'org_b', 15);
  });

  it('clamps timeout to the floor when the setting is below 1', async () => {
    mockTimingSafeCompare.mockReturnValue(true);
    mockListOrgs.mockResolvedValue(['org_a']);
    mockGetSettings.mockResolvedValue([{ value: '-99' }]);

    await GET(req({ authorization: 'Bearer super-secret-cron-token' }));
    expect(mockSweep).toHaveBeenCalledWith(mockSql, 'org_a', 1);
  });

  it('clamps timeout to the ceiling when the setting is enormous', async () => {
    mockTimingSafeCompare.mockReturnValue(true);
    mockListOrgs.mockResolvedValue(['org_a']);
    mockGetSettings.mockResolvedValue([{ value: '999999' }]);

    await GET(req({ authorization: 'Bearer super-secret-cron-token' }));
    expect(mockSweep).toHaveBeenCalledWith(mockSql, 'org_a', 24 * 60);
  });

  it('emits a signal + fires webhooks for each swept row', async () => {
    mockTimingSafeCompare.mockReturnValue(true);
    mockListOrgs.mockResolvedValue(['org_a']);
    mockGetSettings.mockResolvedValue([]);
    mockSweep.mockResolvedValue([
      {
        action_id: 'act_1',
        agent_id: 'deploy-bot',
        agent_name: 'Deploy Agent',
        action_type: 'deploy',
        declared_goal: 'ship hotfix',
        created_at: '2026-05-13T00:00:00Z',
        outcome_at: '2026-05-13T00:30:00Z',
      },
      {
        action_id: 'act_2',
        agent_id: 'plan-bot',
        agent_name: null,
        action_type: 'plan',
        declared_goal: 'review backlog',
        created_at: '2026-05-13T00:05:00Z',
        outcome_at: '2026-05-13T00:30:00Z',
      },
    ]);
    mockFireWebhooks.mockResolvedValue([{ success: true }, { success: false }]);

    const res = await GET(req({ authorization: 'Bearer super-secret-cron-token' }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.rows_swept).toBe(2);
    expect(data.webhooks_fired).toBe(1);

    expect(mockPublishOrgEvent).toHaveBeenCalledTimes(2);
    expect(mockPublishOrgEvent).toHaveBeenCalledWith(
      'signal.detected',
      expect.objectContaining({
        orgId: 'org_a',
        signal: expect.objectContaining({
          type: 'lost_confirmation',
          action_id: 'act_1',
          agent_id: 'deploy-bot',
        }),
      }),
    );

    expect(mockFireWebhooks).toHaveBeenCalledTimes(1);
    const [, signalsArg] = mockFireWebhooks.mock.calls[0];
    expect(signalsArg).toHaveLength(2);
    expect(signalsArg[0].type).toBe('lost_confirmation');
    expect(signalsArg[1].action_id).toBe('act_2');
  });

  it('does not throw when webhook delivery fails', async () => {
    mockTimingSafeCompare.mockReturnValue(true);
    mockListOrgs.mockResolvedValue(['org_a']);
    mockSweep.mockResolvedValue([
      {
        action_id: 'act_1',
        agent_id: 'a',
        agent_name: null,
        action_type: 'deploy',
        declared_goal: 'x',
        created_at: '2026-05-13T00:00:00Z',
        outcome_at: '2026-05-13T00:30:00Z',
      },
    ]);
    mockFireWebhooks.mockRejectedValue(new Error('webhook broker down'));

    const res = await GET(req({ authorization: 'Bearer super-secret-cron-token' }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.rows_swept).toBe(1);
    expect(data.webhooks_fired).toBe(0);
  });
});
