import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRequest } from '../helpers.js';

const mockGetOrgId = vi.fn(() => 'org_test');
const mockSqlInstance = vi.fn();
const mockListGuardDecisions = vi.fn();
const mockGetGuardDecisionStats = vi.fn();

vi.mock('../../app/lib/db.js', () => ({ getSql: () => mockSqlInstance }));
vi.mock('../../app/lib/org.js', () => ({ getOrgId: (...a) => mockGetOrgId(...a) }));
vi.mock('../../app/lib/repositories/guardrails.repository.js', () => ({
  listGuardrailDecisions: (...a) => mockListGuardDecisions(...a),
  getGuardDecisionStats: (...a) => mockGetGuardDecisionStats(...a),
}));

const { GET } = await import('../../app/api/guard/decisions/route.js');

function getReq(params = '') {
  return makeRequest(`http://localhost:3000/api/guard/decisions${params}`, {
    headers: { 'x-api-key': 'oc_live_test' },
  });
}

describe('GET /api/guard/decisions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns decisions with stats', async () => {
    mockListGuardDecisions.mockResolvedValueOnce({
      decisions: [
        { id: 'gd_1', decision: 'block', risk_score: 90, agent_id: 'a1', action_type: 'deploy', reason: 'Risk >= 90', matched_policies: '["Critical Risk Block"]', context: '{"declared_goal":"Push to prod","agent_name":"Bot"}', created_at: '2026-04-09T10:00:00Z' },
      ],
      total: 1,
    });
    mockGetGuardDecisionStats.mockResolvedValueOnce({ blocks: 5, approvals: 3, warns: 2 });

    const res = await GET(getReq());
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.decisions).toHaveLength(1);
    expect(data.decisions[0].decision).toBe('block');
    expect(data.decisions[0].declared_goal).toBe('Push to prod');
    expect(data.decisions[0].agent_name).toBe('Bot');
    expect(data.decisions[0].matched_policies).toEqual(['Critical Risk Block']);
    expect(data.decisions[0].context).toBeUndefined();
    expect(data.total).toBe(1);
    expect(data.stats).toEqual({ blocks: 5, approvals: 3, warns: 2 });
  });

  it('passes decision filter to repository', async () => {
    mockListGuardDecisions.mockResolvedValueOnce({ decisions: [], total: 0 });
    mockGetGuardDecisionStats.mockResolvedValueOnce({ blocks: 0, approvals: 0, warns: 0 });

    await GET(getReq('?decision=block'));

    expect(mockListGuardDecisions).toHaveBeenCalledWith(
      expect.anything(), 'org_test',
      expect.objectContaining({ decision: 'block' })
    );
  });

  it('passes agent_id filter to repository', async () => {
    mockListGuardDecisions.mockResolvedValueOnce({ decisions: [], total: 0 });
    mockGetGuardDecisionStats.mockResolvedValueOnce({ blocks: 0, approvals: 0, warns: 0 });

    await GET(getReq('?agent_id=agent_42'));

    expect(mockListGuardDecisions).toHaveBeenCalledWith(
      expect.anything(), 'org_test',
      expect.objectContaining({ agentId: 'agent_42' })
    );
  });

  it('passes action_type and since filters to repository (since normalized to ISO)', async () => {
    mockListGuardDecisions.mockResolvedValueOnce({ decisions: [], total: 0 });
    mockGetGuardDecisionStats.mockResolvedValueOnce({ blocks: 0, approvals: 0, warns: 0 });

    await GET(getReq('?action_type=deploy&since=2026-08-21T00:00:00Z'));

    expect(mockListGuardDecisions).toHaveBeenCalledWith(
      expect.anything(), 'org_test',
      expect.objectContaining({ actionType: 'deploy', since: '2026-08-21T00:00:00.000Z' })
    );
  });

  it('rejects an unparseable since with 400 instead of silently returning full history', async () => {
    const res = await GET(getReq('?since=not-a-date'));
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toMatch(/since/i);
    expect(mockListGuardDecisions).not.toHaveBeenCalled();
  });

  it('returns empty with zero stats on no data', async () => {
    mockListGuardDecisions.mockResolvedValueOnce({ decisions: [], total: 0 });
    mockGetGuardDecisionStats.mockResolvedValueOnce({ blocks: 0, approvals: 0, warns: 0 });

    const res = await GET(getReq());
    const data = await res.json();

    expect(data.decisions).toEqual([]);
    expect(data.total).toBe(0);
    expect(data.stats).toEqual({ blocks: 0, approvals: 0, warns: 0 });
  });

  it('returns 500 on error', async () => {
    mockListGuardDecisions.mockRejectedValueOnce(new Error('DB down'));

    const res = await GET(getReq());
    expect(res.status).toBe(500);
  });
});
