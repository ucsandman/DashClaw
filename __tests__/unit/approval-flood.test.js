import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGetSettings, mockUpsert, mockCounts } = vi.hoisted(() => ({
  mockGetSettings: vi.fn(),
  mockUpsert: vi.fn(),
  mockCounts: vi.fn(),
}));
vi.mock('../../app/lib/repositories/settings.repository', () => ({
  getSettings: mockGetSettings,
  upsertSetting: mockUpsert,
}));
vi.mock('../../app/lib/repositories/guardrails.repository', () => ({
  getRecentApprovalCountsByPolicy: mockCounts,
  getPolicyNamesByIds: vi.fn(async () => ({})),
}));

import { evaluateApprovalFlood, getInterruptBudget, FLEET_KEY } from '../../app/lib/approval-flood';

const sql = {};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSettings.mockResolvedValue([]); // no overrides, no prior state
  mockUpsert.mockResolvedValue(undefined);
});

describe('getInterruptBudget', () => {
  it('returns defaults 10/15/30 when no settings exist', async () => {
    expect(await getInterruptBudget(sql, 'org1')).toEqual({ perPolicy: 10, windowMin: 15, fleetWide: 30 });
  });
  it('honors org-setting overrides', async () => {
    mockGetSettings.mockResolvedValue([
      { key: 'DASHCLAW_INTERRUPT_BUDGET', value: '5' },
      { key: 'DASHCLAW_INTERRUPT_WINDOW_MIN', value: '10' },
    ]);
    expect(await getInterruptBudget(sql, 'org1')).toEqual({ perPolicy: 5, windowMin: 10, fleetWide: 30 });
  });
});

describe('evaluateApprovalFlood', () => {
  it('trips a policy over budget, persists state, reports it newly tripped', async () => {
    mockCounts.mockResolvedValue({ gp_a: 47, gp_b: 2 });
    const r = await evaluateApprovalFlood(sql, 'org1');
    expect(r.newlyTripped.map((t) => t.policy_id)).toContain('gp_a');
    expect(r.suppressed.has('gp_a')).toBe(true);
    expect(r.suppressed.has('gp_b')).toBe(false);
    expect(r.fleetTripped).toBe(true); // 49 > 30 fleet budget
    const written = JSON.parse(mockUpsert.mock.calls.at(-1)[2].value);
    expect(written.gp_a.count).toBe(47);
  });

  it('does not re-report an already-tripped policy', async () => {
    mockGetSettings.mockImplementation(async (_sql, _org, filter = {}) =>
      filter.key === 'APPROVAL_FLOOD_STATE'
        ? [{ key: 'APPROVAL_FLOOD_STATE', value: JSON.stringify({ gp_a: { tripped_at: '2026-06-11T00:00:00Z', count: 40 } }) }]
        : []);
    mockCounts.mockResolvedValue({ gp_a: 41 });
    const r = await evaluateApprovalFlood(sql, 'org1');
    expect(r.newlyTripped.find((t) => t.policy_id === 'gp_a')).toBeUndefined();
    expect(r.suppressed.has('gp_a')).toBe(true);
  });

  it('clears (hysteresis) when the rate falls below half the budget', async () => {
    mockGetSettings.mockImplementation(async (_sql, _org, filter = {}) =>
      filter.key === 'APPROVAL_FLOOD_STATE'
        ? [{ key: 'APPROVAL_FLOOD_STATE', value: JSON.stringify({ gp_a: { tripped_at: '2026-06-11T00:00:00Z', count: 40 } }) }]
        : []);
    mockCounts.mockResolvedValue({ gp_a: 3 }); // < 10/2
    const r = await evaluateApprovalFlood(sql, 'org1');
    expect(r.suppressed.has('gp_a')).toBe(false);
    const written = JSON.parse(mockUpsert.mock.calls.at(-1)[2].value);
    expect(written.gp_a).toBeUndefined();
  });

  it('fails open: a counts query error yields no suppression', async () => {
    mockCounts.mockRejectedValue(new Error('db down'));
    const r = await evaluateApprovalFlood(sql, 'org1');
    expect(r.suppressed.size).toBe(0);
    expect(r.newlyTripped).toEqual([]);
  });
});
