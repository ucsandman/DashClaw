import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockSql, mockGetFleetSpend, mockGetClaudeCodeSpend } = vi.hoisted(() => ({
  mockSql: vi.fn(),
  mockGetFleetSpend: vi.fn(),
  mockGetClaudeCodeSpend: vi.fn(),
}));
vi.mock('@/lib/db.js', () => ({ getSql: () => mockSql }));
vi.mock('@/lib/org.js', () => ({ getOrgId: () => 'org_1' }));
vi.mock('@/lib/repositories/finops.repository.js', () => ({
  getFleetSpend: mockGetFleetSpend,
  getClaudeCodeSpend: mockGetClaudeCodeSpend,
}));

const { GET } = await import('@/api/finops/spend/route.js');
beforeEach(() => {
  vi.clearAllMocks();
  mockGetFleetSpend.mockResolvedValue({ lens: 'fleet', fleet_total_usd: 12.5 });
  mockGetClaudeCodeSpend.mockResolvedValue({ lens: 'claude_code', code_total_usd: 8.25 });
});

describe('GET /api/finops/spend', () => {
  it('defaults to the fleet lens and passes the period through', async () => {
    const res = await GET(new Request('http://localhost/api/finops/spend?period=7d'));
    expect(res.status).toBe(200);
    expect((await res.json()).fleet_total_usd).toBe(12.5);
    expect(mockGetFleetSpend).toHaveBeenCalledWith(mockSql, 'org_1', { period: '7d', agentId: null });
    expect(mockGetClaudeCodeSpend).not.toHaveBeenCalled();
  });

  it('forwards agent_id to the fleet lens (global agent picker)', async () => {
    await GET(new Request('http://localhost/api/finops/spend?period=30d&agent_id=agent-1'));
    expect(mockGetFleetSpend).toHaveBeenCalledWith(mockSql, 'org_1', { period: '30d', agentId: 'agent-1' });
  });

  it('dispatches to the Claude-Code lens on ?lens=claude-code (agent_id ignored — sessions are operator-keyed)', async () => {
    const res = await GET(new Request('http://localhost/api/finops/spend?lens=claude-code&period=90d&agent_id=agent-1'));
    expect((await res.json()).code_total_usd).toBe(8.25);
    expect(mockGetClaudeCodeSpend).toHaveBeenCalledWith(mockSql, 'org_1', { period: '90d' });
    expect(mockGetFleetSpend).not.toHaveBeenCalled();
  });

  it('falls back to the fleet lens on an unknown lens, and 30d on an unknown period', async () => {
    await GET(new Request('http://localhost/api/finops/spend?lens=bogus&period=bogus'));
    expect(mockGetFleetSpend).toHaveBeenCalledWith(mockSql, 'org_1', { period: '30d', agentId: null });
  });
});
