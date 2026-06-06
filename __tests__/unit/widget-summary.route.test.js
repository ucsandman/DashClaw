import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeRequest } from '../helpers.js';

const { mockGetSql, mockListActions, mockGetCostAggregation, mockListAgentsForOrg, mockComputeSignals } =
  vi.hoisted(() => ({
    mockGetSql: vi.fn(() => ({})),
    mockListActions: vi.fn(),
    mockGetCostAggregation: vi.fn(),
    mockListAgentsForOrg: vi.fn(),
    mockComputeSignals: vi.fn(),
  }));

vi.mock('@/lib/db.js', () => ({ getSql: mockGetSql }));
vi.mock('@/lib/repositories/actions.repository.js', () => ({
  listActions: mockListActions,
  getCostAggregation: mockGetCostAggregation,
}));
vi.mock('@/lib/repositories/agents.repository.js', () => ({ listAgentsForOrg: mockListAgentsForOrg }));
vi.mock('@/lib/signals.js', () => ({ computeSignals: mockComputeSignals }));

import { GET } from '@/api/widget/summary/route.js';

const SENSITIVE = [
  'reasoning',
  'authorization_scope',
  'artifacts_created',
  'side_effects',
  'model',
  'cost_estimate',
  'error_message',
];

const req = (headers) => makeRequest('http://localhost/api/widget/summary', { headers });

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSql.mockReturnValue({});
  mockListActions.mockImplementation((_sql, _orgId, filters = {}) => {
    if (filters.status === 'pending_approval') {
      return Promise.resolve({ actions: [], total: 3, stats: {} });
    }
    return Promise.resolve({
      actions: [
        {
          action_id: 'a1',
          agent_name: 'Agent',
          action_type: 'email_send',
          output_summary: 'Sent the report',
          status: 'completed',
          risk_score: '12',
          timestamp_start: '2026-06-06T00:00:00Z',
          reasoning: 'secret chain of thought',
          authorization_scope: 'scope',
          artifacts_created: ['a.txt'],
          side_effects: ['sent'],
          model: 'opus',
          cost_estimate: '9.99',
          error_message: 'boom',
        },
      ],
      total: 1,
      stats: { running: '2', blocked: '0', high_risk: '0' },
    });
  });
  mockComputeSignals.mockResolvedValue([
    { severity: 'red', label: 'High risk action', detail: 'risk 95', agent_id: 'a1', detected_at: 't' },
  ]);
  mockGetCostAggregation.mockResolvedValue({ total_cost_usd: 4.25 });
  mockListAgentsForOrg.mockResolvedValue([{ last_active: new Date().toISOString() }]);
});

describe('GET /api/widget/summary', () => {
  it('returns 401 when x-org-id is missing', async () => {
    const res = await GET(req({}));
    expect(res.status).toBe(401);
  });

  it('returns the documented widget shape', async () => {
    const res = await GET(req({ 'x-org-id': 'org_1' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual([
      'degraded',
      'generatedAt',
      'metrics',
      'recentActions',
      'signals',
      'status',
      'topSignals',
    ]);
    expect(body.status).toBe('elevated'); // red signal present
    expect(body.metrics.pendingApprovals).toBe(3);
    expect(body.metrics.spend).toBe(4.25);
    expect(body.signals).toEqual({ red: 1, amber: 0, total: 1 });
    expect(body.recentActions).toHaveLength(1);
    expect(body.recentActions.length).toBeLessThanOrEqual(10);
    expect(body.topSignals[0].severity).toBe('red');
    expect(body.degraded).toBe(false);
  });

  it('never leaks sensitive action fields', async () => {
    const res = await GET(req({ 'x-org-id': 'org_1' }));
    const body = await res.json();
    const action = body.recentActions[0];
    for (const k of SENSITIVE) {
      expect(action).not.toHaveProperty(k);
    }
  });

  it('degrades gracefully (200, no 500) when one source throws', async () => {
    mockComputeSignals.mockRejectedValueOnce(new Error('signals down'));
    const res = await GET(req({ 'x-org-id': 'org_1' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.degraded).toBe(true);
    expect(body.signals).toEqual({ red: 0, amber: 0, total: 0 });
    // working sources still populate
    expect(body.metrics.pendingApprovals).toBe(3);
    expect(body.recentActions).toHaveLength(1);
  });
});
