import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeRequest } from '../helpers.js';

// Privacy guard for the widget summary endpoint: even when the underlying
// action rows carry secrets, prompts, reasoning, scopes, artifacts, and env,
// NONE of it may appear anywhere in the serialized API response.

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

const SENSITIVE_KEYS = [
  'reasoning',
  'authorization_scope',
  'artifacts_created',
  'side_effects',
  'model',
  'cost_estimate',
  'error_message',
  'api_key',
  'env',
];

const SECRET_MARKERS = [
  'CONFIDENTIAL chain of thought',
  'sk-should-never-appear',
  'sk-leak-test-123',
  'admin:*',
  '/secret/artifact.txt',
  'DATABASE_URL=postgres://secret',
  'internal stacktrace detail',
  'wrote production db',
];

const req = () => makeRequest('http://localhost/api/widget/summary', { headers: { 'x-org-id': 'org_1' } });

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSql.mockReturnValue({});
  mockListActions.mockImplementation((_sql, _orgId, filters = {}) => {
    if (filters.status === 'pending_approval') return Promise.resolve({ actions: [], total: 1, stats: {} });
    return Promise.resolve({
      actions: [
        {
          action_id: 'a1',
          agent_name: 'bot',
          action_type: 'email_send',
          output_summary: 'Sent the customer update',
          status: 'completed',
          risk_score: '10',
          timestamp_start: '2026-06-06T00:00:00Z',
          // everything below must be stripped:
          reasoning: 'CONFIDENTIAL chain of thought sk-leak-test-123',
          authorization_scope: 'admin:*',
          artifacts_created: ['/secret/artifact.txt'],
          side_effects: ['wrote production db'],
          model: 'opus',
          cost_estimate: '9.99',
          error_message: 'internal stacktrace detail',
          api_key: 'sk-should-never-appear',
          env: 'DATABASE_URL=postgres://secret',
        },
      ],
      total: 1,
      stats: { running: '0' },
    });
  });
  mockComputeSignals.mockResolvedValue([{ severity: 'amber', label: 'Minor', detail: 'small note' }]);
  mockGetCostAggregation.mockResolvedValue({ total_cost_usd: 1.0 });
  mockListAgentsForOrg.mockResolvedValue([]);
});

describe('GET /api/widget/summary — privacy', () => {
  it('serialized response contains none of the secret markers', async () => {
    const res = await GET(req());
    const blob = JSON.stringify(await res.json());
    for (const marker of SECRET_MARKERS) {
      expect(blob).not.toContain(marker);
    }
  });

  it('recentActions carry none of the sensitive keys', async () => {
    const res = await GET(req());
    const body = await res.json();
    expect(body.recentActions.length).toBeGreaterThan(0);
    for (const action of body.recentActions) {
      for (const key of SENSITIVE_KEYS) {
        expect(action).not.toHaveProperty(key);
      }
    }
  });
});
