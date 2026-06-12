import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockMix, mockPending, mockCost, mockFlood, mockSignals, mockNames } = vi.hoisted(() => ({
  mockMix: vi.fn(),
  mockPending: vi.fn(),
  mockCost: vi.fn(),
  mockFlood: vi.fn(async () => ({})),
  mockSignals: vi.fn(async () => []),
  mockNames: vi.fn(async () => ({})),
}));
vi.mock('../../app/lib/repositories/guardrails.repository', () => ({
  getGuardDecisionMix: mockMix,
  getPolicyNamesByIds: mockNames,
}));
vi.mock('../../app/lib/repositories/actions.repository', () => ({
  getPendingApprovalSummary: mockPending,
  getCostAggregation: mockCost,
}));
vi.mock('../../app/lib/approval-flood', () => ({ getFloodState: mockFlood, FLEET_KEY: '_fleet' }));
vi.mock('../../app/lib/signals', () => ({ computeSignals: mockSignals }));

import { composeFleetDigest } from '../../app/lib/fleet-digest';

beforeEach(() => {
  vi.clearAllMocks();
  mockMix.mockResolvedValue({ current: { allow: 1204 }, prior: { allow: 1100 } });
  mockPending.mockResolvedValue({ pending: 0, oldest_at: null });
  mockCost.mockResolvedValue({ total_cost_usd: 4.1, attribution: { attributed_count: 95, total_count: 100, coverage_pct: 95 } });
  mockFlood.mockResolvedValue({});
  mockSignals.mockResolvedValue([]);
});

describe('composeFleetDigest', () => {
  it('is quiet when nothing needs attention', async () => {
    const d = await composeFleetDigest({}, 'org1');
    expect(d.quiet).toBe(true);
    expect(d.text).toMatch(/quiet/i);
    expect(d.text).toContain('1204');
  });

  it('surfaces pending approvals, floods, and red signals', async () => {
    mockMix.mockResolvedValue({ current: { allow: 900, require_approval: 47 }, prior: { allow: 880, require_approval: 1 } });
    mockPending.mockResolvedValue({ pending: 47, oldest_at: new Date(Date.now() - 3 * 3600e3).toISOString() });
    mockFlood.mockResolvedValue({ gp_a: { tripped_at: '2026-06-11T00:00:00Z', count: 47 } });
    mockSignals.mockResolvedValue([
      { type: 'approval_flood', severity: 'red', label: 'Approval flood: gp_a' },
    ]);
    const d = await composeFleetDigest({}, 'org1');
    expect(d.quiet).toBe(false);
    expect(d.text).toMatch(/47 pending/i);
    expect(d.text).toMatch(/approval flood/i);
    expect(d.pending_approvals).toBe(47);
    expect(d.floods).toHaveLength(1);
  });
});
