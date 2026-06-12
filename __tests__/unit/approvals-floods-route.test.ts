import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockEval, mockNames, mockBudget } = vi.hoisted(() => ({
  mockEval: vi.fn(),
  mockNames: vi.fn(async () => ({ gp_a: '[Tightened] other' })),
  mockBudget: vi.fn(async () => ({ perPolicy: 10, windowMin: 15, fleetWide: 30 })),
}));
vi.mock('../../app/lib/approval-flood', () => ({
  evaluateApprovalFlood: mockEval,
  getInterruptBudget: mockBudget,
  FLEET_KEY: '_fleet',
}));
vi.mock('../../app/lib/repositories/guardrails.repository', () => ({ getPolicyNamesByIds: mockNames }));
vi.mock('../../app/lib/org', () => ({ getOrgId: () => 'org1' }));
vi.mock('../../app/lib/db', () => ({ getSql: () => ({}) }));

import { GET } from '../../app/api/approvals/floods/route';

beforeEach(() => vi.clearAllMocks());

it('returns flood entries with names and budget', async () => {
  mockEval.mockResolvedValue({
    state: { gp_a: { tripped_at: '2026-06-11T00:00:00Z', count: 47 } },
    suppressed: new Set(['gp_a']), newlyTripped: [], fleetTripped: false, windowMin: 15,
  });
  const res = await GET(new Request('http://x/api/approvals/floods'));
  const body = await res.json();
  expect(res.status).toBe(200);
  expect(body.floods).toEqual([
    { policy_id: 'gp_a', name: '[Tightened] other', count: 47, tripped_at: '2026-06-11T00:00:00Z' },
  ]);
  expect(body.budget).toEqual({ perPolicy: 10, windowMin: 15, fleetWide: 30 });
  expect(body.fleet).toBeNull();
});
