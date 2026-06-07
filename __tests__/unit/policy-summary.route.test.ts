import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockSql,
  mockGetActivePolicies,
  mockGetDecisionCountsByPolicy,
  mockGetDecisionOutcomeCounts,
  mockListAgentsForOrg,
  mockGetActionStats,
} = vi.hoisted(() => ({
  mockSql: Object.assign(vi.fn(async () => []), { query: vi.fn(async () => []) }),
  mockGetActivePolicies: vi.fn(),
  mockGetDecisionCountsByPolicy: vi.fn(),
  mockGetDecisionOutcomeCounts: vi.fn(),
  mockListAgentsForOrg: vi.fn(),
  mockGetActionStats: vi.fn(),
}));

vi.mock('@/lib/db.js', () => ({ getSql: () => mockSql }));
vi.mock('@/lib/repositories/guardrails.repository.js', () => ({
  getActivePolicies: mockGetActivePolicies,
  getDecisionCountsByPolicy: mockGetDecisionCountsByPolicy,
  getDecisionOutcomeCounts: mockGetDecisionOutcomeCounts,
}));
vi.mock('@/lib/repositories/agents.repository.js', () => ({ listAgentsForOrg: mockListAgentsForOrg }));
vi.mock('@/lib/repositories/actions.repository.js', () => ({ getActionStats: mockGetActionStats }));

import { GET } from '@/api/policies/summary/route.js';
import { makeRequest as rawRequest } from '../helpers.js';

function makeRequest(url: string, opts: { headers?: Record<string, string> } = {}): Request {
  return rawRequest(url, opts) as unknown as Request;
}
const memberHeaders = { 'x-org-id': 'org_1' };
const req = () => makeRequest('http://localhost/api/policies/summary', { headers: memberHeaders });
const rules = (o: Record<string, unknown>) => JSON.stringify(o);

beforeEach(() => {
  vi.clearAllMocks();
  mockGetActivePolicies.mockResolvedValue([]);
  mockGetDecisionCountsByPolicy.mockResolvedValue({});
  mockGetDecisionOutcomeCounts.mockResolvedValue({ total: 0, allow: 0, warn: 0, require_approval: 0, block: 0 });
  mockListAgentsForOrg.mockResolvedValue([]);
  mockGetActionStats.mockResolvedValue({ current: { approval: 0 }, previousTotal: 0 });
});

describe('GET /api/policies/summary', () => {
  it('returns the ungoverned summary when no policies are active', async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.governed).toBe(false);
    expect(data.primaryMode).toBeNull();
    expect(data.shields).toHaveLength(9);
  });

  it('synthesizes the current mode, agent count, and pending approvals', async () => {
    mockGetActivePolicies.mockResolvedValue([
      { id: 'p1', name: '[Claude Code Mode] Warn high-risk', policy_type: 'risk_threshold', rules: rules({ threshold: 85, action: 'warn', _mode: 'claude-code' }) },
      { id: 'p2', name: '[Claude Code Mode] Pause before deploy', policy_type: 'require_approval', rules: rules({ action_types: ['deploy'], _mode: 'claude-code' }) },
    ]);
    mockGetDecisionCountsByPolicy.mockResolvedValue({ p2: { fired: 4, lastFiredAt: '2026-06-06T00:00:00Z' } });
    mockGetDecisionOutcomeCounts.mockResolvedValue({ total: 200, allow: 180, warn: 12, require_approval: 6, block: 2 });
    mockListAgentsForOrg.mockResolvedValue([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    mockGetActionStats.mockResolvedValue({ current: { approval: 5 }, previousTotal: 0 });

    const res = await GET(req());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.governed).toBe(true);
    expect(data.primaryMode.id).toBe('claude-code');
    expect(data.enforcement).toEqual({ total: 2, warn: 1, require_approval: 1, block: 0 });
    expect(data.decisions30d.allow).toBe(180);
    expect(data.agents.total).toBe(3);
    expect(data.pendingApprovals).toBe(5);
    expect(data.rules.find((r: { id: string }) => r.id === 'p2').fired30d).toBe(4);
  });

  it('degrades gracefully when the fire-count query fails (still 200, zero counts)', async () => {
    mockGetActivePolicies.mockResolvedValue([
      { id: 'sh1', name: 'Deploy Gate', policy_type: 'require_approval', rules: rules({ action_types: ['deploy'], _shield: 'deploy_gate' }) },
    ]);
    mockGetDecisionCountsByPolicy.mockRejectedValue(new Error('jsonb cast failed'));

    const res = await GET(req());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.governed).toBe(true);
    const gate = data.shields.find((s: { id: string }) => s.id === 'deploy_gate');
    expect(gate.on).toBe(true);
    expect(gate.fired30d).toBe(0);
  });
});
