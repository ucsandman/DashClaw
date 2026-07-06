/** GET /api/self-governance — opt-in gate + aggregate passthrough + memo (v7.3). */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

const { mockGetStats } = vi.hoisted(() => ({
  mockGetStats: vi.fn(),
}));
vi.mock('@/lib/repositories/self-governance.repository', () => ({ getSelfGovernanceStats: mockGetStats }));
vi.mock('@/lib/db', () => ({ getSql: () => ({}) }));

import { GET } from '../../app/api/self-governance/route';

const FLAG = 'DASHCLAW_SELF_GOVERNANCE_PUBLIC';
const originalFlag = process.env[FLAG];

const STATS = {
  actions: { total: 4200, last30d: 310, last7d: 90, firstAt: '2026-04-10T00:00:00.000Z', latestAt: '2026-07-05T12:00:00.000Z', activeDays: 80 },
  decisions: { total: 900, last30d: 120, byDecision: { allow: 700, warn: 120, block: 30, require_approval: 50 } },
};

beforeEach(() => vi.clearAllMocks());
afterAll(() => {
  if (originalFlag === undefined) delete process.env[FLAG];
  else process.env[FLAG] = originalFlag;
});

describe('GET /api/self-governance', () => {
  it('404s unless the instance opts in', async () => {
    delete process.env[FLAG];
    const res = await GET();
    expect(res.status).toBe(404);
    expect(mockGetStats).not.toHaveBeenCalled();
  });

  it('returns aggregate-only evidence when opted in', async () => {
    process.env[FLAG] = 'true';
    mockGetStats.mockResolvedValue(STATS);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.selfGovernance).toBe(true);
    expect(body.actions.total).toBe(4200);
    expect(body.decisions.byDecision.require_approval).toBe(50);
    expect(typeof body.generatedAt).toBe('string');
    expect('version' in body).toBe(true);
    // Exposure boundary: no org identifiers, no free-text columns.
    const wire = JSON.stringify(body);
    expect(wire).not.toMatch(/org_/);
    expect(wire).not.toMatch(/declared_goal|action_type|agent_id|reason/);
  });

  it('memoizes: a second call within the window does not re-query', async () => {
    process.env[FLAG] = 'true';
    const res = await GET();
    expect(res.status).toBe(200);
    // The previous test's call populated the module-level 60s memo.
    expect(mockGetStats).not.toHaveBeenCalled();
  });
});
