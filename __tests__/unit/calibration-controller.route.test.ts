/**
 * GET/POST /api/calibration/controller — the calibrated interruption
 * controller's operator API. Auth gates, validation, snapshot shape, and the
 * charter seam: activating/deactivating is an admin CLICK, audit-logged.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRequest as rawRequest } from '../helpers.js';

function makeRequest(
  url: string,
  opts: { headers?: Record<string, string>; body?: unknown } = {},
): Request {
  return rawRequest(url, opts) as unknown as Request;
}

const {
  mockSql,
  mockGetSettings,
  mockUpsertSetting,
  mockGetCalibrationState,
  mockListCalibrationEvents,
  mockResetAgentAlarm,
  mockResetCalibrationState,
  mockGetActivePolicies,
  mockLogActivity,
} = vi.hoisted(() => ({
  mockSql: Object.assign(vi.fn(async () => []), { query: vi.fn(async () => []) }),
  mockGetSettings: vi.fn(),
  mockUpsertSetting: vi.fn(),
  mockGetCalibrationState: vi.fn(),
  mockListCalibrationEvents: vi.fn(),
  mockResetAgentAlarm: vi.fn(),
  mockResetCalibrationState: vi.fn(),
  mockGetActivePolicies: vi.fn(),
  mockLogActivity: vi.fn(),
}));

vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    after: (cb: () => unknown) => {
      try {
        const r = typeof cb === 'function' ? cb() : undefined;
        if (r && typeof (r as Promise<unknown>).catch === 'function') (r as Promise<unknown>).catch(() => {});
      } catch { /* deferred work must not sink the test request */ }
    },
  };
});
vi.mock('@/lib/db.js', () => ({ getSql: () => mockSql }));
vi.mock('@/lib/repositories/settings.repository', () => ({
  getSettings: mockGetSettings,
  upsertSetting: mockUpsertSetting,
}));
vi.mock('@/lib/repositories/calibration-state.repository', () => ({
  getCalibrationState: mockGetCalibrationState,
  listCalibrationEvents: mockListCalibrationEvents,
  resetAgentAlarm: mockResetAgentAlarm,
  resetCalibrationState: mockResetCalibrationState,
}));
vi.mock('@/lib/repositories/guardrails.repository', () => ({
  getActivePolicies: mockGetActivePolicies,
}));
vi.mock('@/lib/audit.js', () => ({ logActivity: mockLogActivity }));

import { GET, POST } from '@/api/calibration/controller/route.js';

const adminHeaders = { 'x-org-id': 'org_1', 'x-org-role': 'admin', 'x-user-id': 'user_alice' };
const memberHeaders = { 'x-org-id': 'org_1', 'x-org-role': 'member', 'x-user-id': 'user_bob' };
const URL_ = 'http://localhost/api/calibration/controller';

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSettings.mockResolvedValue([]);
  mockGetCalibrationState.mockResolvedValue(null);
  mockListCalibrationEvents.mockResolvedValue([]);
  mockGetActivePolicies.mockResolvedValue([]);
  mockUpsertSetting.mockResolvedValue(undefined);
  mockResetAgentAlarm.mockResolvedValue(true);
  mockResetCalibrationState.mockResolvedValue(undefined);
});

describe('GET /api/calibration/controller', () => {
  it('returns the default-shadow snapshot with fresh state', async () => {
    const res = await GET(makeRequest(URL_, { headers: adminHeaders }));
    expect(res.status).toBe(200);
    const body = await res.json();
    // Unconfigured means "observe", not "ignore" — the controller learns from
    // day one so Relief has evidence when an operator reaches for it.
    expect(body.settings).toEqual({ mode: 'shadow', target_rate: 0.1 });
    expect(body.state.theta).toBe(80);
    expect(body.state.labeled_total).toBe(0);
    expect(body.state.labeled_live).toBe(0);
    expect(body.state.relief_ready).toBe(false);
    expect(body.state.observed_rate).toBeNull();
    expect(body.defaults.relief_min_labels).toBe(10);
    expect(body.defaults.relief_min_live_labels).toBe(3);
    expect(body.alarms).toEqual([]);
  });

  it('relief readiness needs the live-label floor as well as the total', async () => {
    mockGetCalibrationState.mockResolvedValue({
      theta: 70, labeledTotal: 12, labeledLive: 2, labeledBenign: 12, labeledDenied: 0,
      lossSum: 1, reliefCeiling: 55, agents: {},
    });
    let body = await (await GET(makeRequest(URL_, { headers: adminHeaders }))).json();
    expect(body.state.labeled_live).toBe(2);
    expect(body.state.relief_ready).toBe(false);

    mockGetCalibrationState.mockResolvedValue({
      theta: 70, labeledTotal: 12, labeledLive: 3, labeledBenign: 12, labeledDenied: 0,
      lossSum: 1, reliefCeiling: 55, agents: {},
    });
    body = await (await GET(makeRequest(URL_, { headers: adminHeaders }))).json();
    expect(body.state.relief_ready).toBe(true);
  });

  it('carries the adjudication source through to the event list', async () => {
    mockListCalibrationEvents.mockResolvedValue([
      { action_id: 'gd_1', agent_id: null, risk_score: 46, theta_before: 80, theta_after: 80.9, label: 'benign', loss: 1, source: 'warn_review', created_at: '2026-08-19T00:00:00.000Z' },
    ]);
    const body = await (await GET(makeRequest(URL_, { headers: adminHeaders }))).json();
    expect(body.events[0].source).toBe('warn_review');
  });

  it('reports observed rates, alarms, and θ-vs-policy context', async () => {
    mockGetSettings.mockResolvedValue([
      { key: 'CALIBRATION_CONTROLLER_MODE', value: 'shadow' },
      { key: 'CALIBRATION_TARGET_RATE', value: '0.05' },
    ]);
    mockGetCalibrationState.mockResolvedValue({
      theta: 62.5, labeledTotal: 40, labeledBenign: 30, labeledDenied: 10, lossSum: 4,
      agents: { agent_bad: { e: 25, n: 12, denied: 9, alarmed_at: '2026-07-06T00:00:00.000Z' } },
    });
    mockListCalibrationEvents.mockResolvedValue([
      { action_id: 'a1', agent_id: 'agent_bad', risk_score: 85, theta_before: 62, theta_after: 62.5, label: 'benign', loss: 1, created_at: '2026-07-06T00:00:00.000Z' },
      { action_id: 'a2', agent_id: 'agent_bad', risk_score: 90, theta_before: 62.5, theta_after: 62.4, label: 'dangerous', loss: 0, created_at: '2026-07-06T00:00:01.000Z' },
    ]);
    mockGetActivePolicies.mockResolvedValue([
      { id: 'gp_1', name: 'High risk gate', policy_type: 'risk_threshold', rules: JSON.stringify({ threshold: 80, action: 'require_approval' }) },
      { id: 'gp_2', name: 'Block deploys', policy_type: 'block_action_type', rules: JSON.stringify({ action_types: ['deploy'] }) },
    ]);

    const res = await GET(makeRequest(URL_, { headers: adminHeaders }));
    const body = await res.json();
    expect(body.settings).toEqual({ mode: 'shadow', target_rate: 0.05 });
    expect(body.state.observed_rate).toBeCloseTo(0.1);
    expect(body.state.observed_window_rate).toBeCloseTo(0.5);
    expect(body.alarms[0]).toMatchObject({ agent_id: 'agent_bad', alarmed_at: expect.any(String) });
    expect(body.risk_threshold_policies).toEqual([
      { id: 'gp_1', name: 'High risk gate', threshold: 80, action: 'require_approval' },
    ]);
  });
});

describe('POST /api/calibration/controller', () => {
  it('rejects non-admin roles', async () => {
    const res = await POST(makeRequest(URL_, { headers: memberHeaders, body: { mode: 'shadow' } }));
    expect(res.status).toBe(403);
    expect(mockUpsertSetting).not.toHaveBeenCalled();
  });

  it('validates mode and target_rate', async () => {
    const bad1 = await POST(makeRequest(URL_, { headers: adminHeaders, body: { mode: 'bogus' } }));
    expect(bad1.status).toBe(400);
    const bad2 = await POST(makeRequest(URL_, { headers: adminHeaders, body: { target_rate: 0.9 } }));
    expect(bad2.status).toBe(400);
    const bad3 = await POST(makeRequest(URL_, { headers: adminHeaders, body: {} }));
    expect(bad3.status).toBe(400);
  });

  it('accepts the relief mode the /calibration button posts', async () => {
    // The page's Relief button is one click with no confirm step, so this
    // route is the only thing between it and the guard's demote arm.
    const res = await POST(makeRequest(URL_, { headers: adminHeaders, body: { mode: 'relief' } }));
    expect(res.status).toBe(200);
    expect(mockUpsertSetting).toHaveBeenCalledWith(mockSql, 'org_1', expect.objectContaining({
      key: 'CALIBRATION_CONTROLLER_MODE', value: 'relief', category: 'general',
    }));
  });

  it('sets mode + target via the settings repository and audit-logs the change', async () => {
    const res = await POST(makeRequest(URL_, { headers: adminHeaders, body: { mode: 'active', target_rate: 0.08 } }));
    expect(res.status).toBe(200);
    expect(mockUpsertSetting).toHaveBeenCalledWith(mockSql, 'org_1', expect.objectContaining({
      key: 'CALIBRATION_CONTROLLER_MODE', value: 'active', category: 'general',
    }));
    expect(mockUpsertSetting).toHaveBeenCalledWith(mockSql, 'org_1', expect.objectContaining({
      key: 'CALIBRATION_TARGET_RATE', value: '0.08', category: 'general',
    }));
    expect(mockLogActivity).toHaveBeenCalledWith(expect.objectContaining({
      action: 'calibration.controller_updated',
      details: { mode: 'active', target_rate: 0.08 },
    }), mockSql);
  });

  it('resets an agent alarm (404 when the agent has no entry)', async () => {
    const ok = await POST(makeRequest(URL_, { headers: adminHeaders, body: { reset_agent_alarm: 'agent_bad' } }));
    expect(ok.status).toBe(200);
    expect(mockResetAgentAlarm).toHaveBeenCalledWith(mockSql, 'org_1', 'agent_bad');

    mockResetAgentAlarm.mockResolvedValue(false);
    const missing = await POST(makeRequest(URL_, { headers: adminHeaders, body: { reset_agent_alarm: 'nobody' } }));
    expect(missing.status).toBe(404);
  });

  it('resets the calibrated state on request', async () => {
    const res = await POST(makeRequest(URL_, { headers: adminHeaders, body: { reset_state: true } }));
    expect(res.status).toBe(200);
    expect(mockResetCalibrationState).toHaveBeenCalledWith(mockSql, 'org_1');
  });
});
