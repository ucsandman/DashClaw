// GET /api/widget/pulse — whitelist, degraded semantics, and auth.
// Spec: docs/decisions/2026-08-09-widget-pulse.md §5.1, §8 (H5).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeRequest } from '../helpers.js';

const { mockGetSql, mockListActions, mockListAgentsForOrg, mockComputeSignals, mockReadPresence } =
  vi.hoisted(() => ({
    mockGetSql: vi.fn(() => ({})),
    mockListActions: vi.fn(),
    mockListAgentsForOrg: vi.fn(),
    mockComputeSignals: vi.fn(),
    mockReadPresence: vi.fn(),
  }));

vi.mock('@/lib/db.js', () => ({ getSql: mockGetSql }));
vi.mock('@/lib/repositories/actions.repository.js', () => ({ listActions: mockListActions }));
vi.mock('@/lib/repositories/agents.repository.js', () => ({ listAgentsForOrg: mockListAgentsForOrg }));
vi.mock('@/lib/signals.js', () => ({ computeSignals: mockComputeSignals }));
vi.mock('@/lib/widget/presence.js', () => ({ readDesktopPresence: mockReadPresence }));

import { GET } from '@/api/widget/pulse/route.js';

// Fields that must NEVER appear anywhere in the pulse payload (non-goal #6).
const SENSITIVE = [
  'reasoning',
  'output_summary',
  'authorization_scope',
  'artifacts_created',
  'side_effects',
  'model',
  'cost_estimate',
  'error_message',
  'detail',
];

const req = (headers) => makeRequest('http://localhost/api/widget/pulse', { headers });

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSql.mockReturnValue({});
  mockListActions.mockImplementation((_sql, _orgId, filters = {}) => {
    if (filters.status === 'pending_approval') {
      return Promise.resolve({
        actions: [
          {
            action_id: 'p1',
            agent_name: 'atlas',
            action_type: 'db_migrate',
            declared_goal: 'migrate the billing schema before the deploy window closes tonight please',
            output_summary: 'SECRET OUTPUT',
            reasoning: 'secret chain of thought',
            risk_score: '80',
            timestamp_start: new Date(Date.now() - 6 * 60_000).toISOString(),
          },
        ],
        total: 2,
        stats: {},
      });
    }
    return Promise.resolve({
      actions: [
        {
          action_id: 'a1',
          agent_name: 'atlas',
          action_type: 'email_send',
          status: 'completed',
          risk_score: '12',
          timestamp_start: new Date(Date.now() - 2 * 60_000).toISOString(),
          reasoning: 'secret chain of thought',
          output_summary: 'SECRET OUTPUT',
          model: 'opus',
          cost_estimate: '9.99',
          error_message: 'boom',
        },
      ],
      total: 1,
      stats: {},
    });
  });
  mockComputeSignals.mockResolvedValue([
    { severity: 'red', type: 'ungoverned-high-risk', label: 'Ungoverned high-risk decision', detail: 'rm -rf /prod SECRET', agent_id: 'a1' },
  ]);
  mockListAgentsForOrg.mockResolvedValue([{ agent_id: 'a1', last_active: new Date().toISOString() }]);
  mockReadPresence.mockReturnValue({ verdict: 'unknown', frameAgeSeconds: null });
});

describe('GET /api/widget/pulse', () => {
  it('requires an authenticated org context (no x-org-id → 401, no org_default fallback)', async () => {
    const res = await GET(req({}));
    expect(res.status).toBe(401);
  });

  it('returns the composed snapshot with whitelisted pending rows only', async () => {
    const res = await GET(req({ 'x-org-id': 'org_1' }));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.pending.count).toBe(2);
    expect(body.pending.rows).toHaveLength(1);
    expect(Object.keys(body.pending.rows[0]).sort()).toEqual([
      'actionId',
      'actionType',
      'agentName',
      'declaredGoal',
      'riskScore',
      'timestampStart',
    ]);
    expect(body.pending.rows[0].declaredGoal.length).toBeLessThanOrEqual(64);
    expect(body.pending.rows[0].declaredGoal.endsWith('…')).toBe(true);

    expect(body.signals).toEqual({
      red: 1,
      amber: 0,
      top: { severity: 'red', kind: 'ungoverned-high-risk', label: 'Ungoverned high-risk decision' },
    });
    expect(body.agents.activeCount).toBe(1);
    expect(body.presence).toEqual({ verdict: 'unknown', frameAgeSeconds: null });
    expect(body.queriesDegraded).toEqual([]);

    const raw = JSON.stringify(body);
    for (const field of SENSITIVE) {
      expect(raw, `payload leaks ${field}`).not.toContain(field);
    }
    expect(raw).not.toContain('SECRET');
    expect(raw).not.toContain('chain of thought');
  });

  it('H5: a failed sub-query lands in queriesDegraded instead of rendering as zero', async () => {
    mockComputeSignals.mockRejectedValue(new Error('db down'));
    mockListAgentsForOrg.mockRejectedValue(new Error('db down'));
    const res = await GET(req({ 'x-org-id': 'org_1' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.queriesDegraded.sort()).toEqual(['agents', 'signals']);
    // The degraded sources report empty, and the client's DEGRADED posture
    // (asserted in widget-pulse.logic.test.js) is what keeps that honest.
    expect(body.signals.red).toBe(0);
  });

  it('a presence read failure is unknown, never a degraded posture or a fake verdict', async () => {
    mockReadPresence.mockImplementation(() => {
      throw new Error('fs exploded');
    });
    const res = await GET(req({ 'x-org-id': 'org_1' }));
    const body = await res.json();
    expect(body.presence).toEqual({ verdict: 'unknown', frameAgeSeconds: null });
    expect(body.queriesDegraded).toEqual([]);
  });
});
