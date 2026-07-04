// __tests__/unit/approvals-floods-route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockEval, mockNames, mockBudget, mockCounts } = vi.hoisted(() => ({
  mockEval: vi.fn(),
  mockNames: vi.fn(async (): Promise<Record<string, string>> => ({ gp_a: '[Tightened] other' })),
  mockBudget: vi.fn(async () => ({ perPolicy: 10, windowMin: 15, fleetWide: 30 })),
  mockCounts: vi.fn(async (): Promise<Record<string, number>> => ({})),
}));
vi.mock('../../app/lib/approval-flood', () => ({
  evaluateApprovalFlood: mockEval,
  getInterruptBudget: mockBudget,
  FLEET_KEY: '_fleet',
}));
vi.mock('../../app/lib/repositories/guardrails.repository', () => ({
  getPolicyNamesByIds: mockNames,
  getRecentApprovalCountsByPolicy: mockCounts,
}));
vi.mock('../../app/lib/org', () => ({ getOrgId: () => 'org1' }));
vi.mock('../../app/lib/db', () => ({ getSql: () => ({}) }));

import { GET } from '../../app/api/approvals/floods/route';

const BUDGET = { perPolicy: 10, windowMin: 15, fleetWide: 30 };

function evaluation(state: Record<string, { tripped_at: string; count: number }>) {
  return {
    state,
    suppressed: new Set(Object.keys(state)),
    newlyTripped: [],
    fleetTripped: '_fleet' in state,
    windowMin: BUDGET.windowMin,
    budget: BUDGET,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockNames.mockResolvedValue({ gp_a: '[Tightened] other' });
});

describe('GET /api/approvals/floods', () => {
  it('returns flood entries with names and budget', async () => {
    mockEval.mockResolvedValue(evaluation({ gp_a: { tripped_at: '2026-06-11T00:00:00Z', count: 47 } }));
    const res = await GET(new Request('http://x/api/approvals/floods'));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.floods).toEqual([
      { policy_id: 'gp_a', name: '[Tightened] other', count: 47, tripped_at: '2026-06-11T00:00:00Z' },
    ]);
    expect(body.budget).toEqual(BUDGET);
    expect(body.fleet).toBeNull();
  });

  it('excludes the fleet entry from floods and surfaces it as fleet', async () => {
    mockEval.mockResolvedValue(evaluation({
      gp_a: { tripped_at: '2026-06-11T00:00:00Z', count: 47 },
      _fleet: { tripped_at: '2026-06-11T00:05:00Z', count: 60 },
    }));
    const res = await GET(new Request('http://x/api/approvals/floods'));
    const body = await res.json();
    expect(body.floods).toHaveLength(1);
    expect(body.floods[0].policy_id).toBe('gp_a');
    expect(body.fleet).toEqual({ tripped_at: '2026-06-11T00:05:00Z', count: 60 });
  });

  it('falls back to the policy id when no name resolves', async () => {
    mockNames.mockResolvedValue({});
    mockEval.mockResolvedValue(evaluation({ gp_unknown: { tripped_at: '2026-06-11T00:00:00Z', count: 12 } }));
    const res = await GET(new Request('http://x/api/approvals/floods'));
    const body = await res.json();
    expect(body.floods[0].name).toBe('gp_unknown');
  });

  it('returns the empty shape when nothing is flooding', async () => {
    mockEval.mockResolvedValue(evaluation({}));
    const res = await GET(new Request('http://x/api/approvals/floods'));
    const body = await res.json();
    expect(body.floods).toEqual([]);
    expect(body.fleet).toBeNull();
  });

  describe('?include_synthetic=1 (ephemeral would-trip view)', () => {
    it('reports would-trip entries from synthetic-inclusive counts WITHOUT running the stateful evaluation', async () => {
      mockCounts.mockResolvedValue({ gp_smoke: 12, gp_quiet: 2 });
      const res = await GET(new Request('http://x/api/approvals/floods?include_synthetic=1'));
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.synthetic_included).toBe(true);
      expect(body.floods).toEqual([
        { policy_id: 'gp_smoke', name: 'gp_smoke', count: 12, tripped_at: null },
      ]);
      // 14 total < 30 fleet budget → no fleet entry
      expect(body.fleet).toBeNull();
      expect(mockCounts).toHaveBeenCalledWith(expect.anything(), 'org1', 15, { includeSynthetic: true });
      // Ephemeral by construction: the persisting evaluation never runs.
      expect(mockEval).not.toHaveBeenCalled();
    });

    it('surfaces a would-trip fleet total over the fleet budget', async () => {
      mockCounts.mockResolvedValue({ gp_a: 20, gp_b: 15 });
      const res = await GET(new Request('http://x/api/approvals/floods?include_synthetic=1'));
      const body = await res.json();
      expect(body.floods.map((f: { policy_id: string }) => f.policy_id).sort()).toEqual(['gp_a', 'gp_b']);
      expect(body.fleet).toEqual({ tripped_at: null, count: 35 });
    });
  });
});
