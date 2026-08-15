import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRequest } from '../helpers.js';

const { mockSql, mockListActions, mockLoadPackPolicies } = vi.hoisted(() => ({
  mockSql: Object.assign(vi.fn(async () => []), { query: vi.fn(async () => []) }),
  mockListActions: vi.fn(),
  mockLoadPackPolicies: vi.fn(),
}));

vi.mock('@/lib/db.js', () => ({ getSql: () => mockSql }));
vi.mock('@/lib/repositories/actions.repository.js', () => ({
  listActionsForSimulation: mockListActions,
}));
vi.mock('@/lib/guardrails/import-pack.js', () => ({
  loadPackPolicies: mockLoadPackPolicies,
}));

import { POST } from '@/api/policies/simulate/route.js';

// Real evaluatePolicy runs underneath — these policies are pure context checks.
const PACK_POLICIES = [
  {
    id: 'block_at_100',
    description: 'Pack — Block at risk 100',
    policy_type: 'risk_threshold',
    rules: { threshold: 100, action: 'block' },
  },
  {
    id: 'hold_payment_security',
    description: 'Pack — Hold payment and security',
    policy_type: 'require_approval',
    rules: { action_types: ['payment', 'security'] },
  },
];

const ACTIONS = [
  { action_id: 'ar_1', action_type: 'payment', risk_score: 20, declared_goal: 'Charge card $5', agent_id: 'a', agent_name: 'A', timestamp_start: 't1', status: 'completed', systems_touched: '[]' },
  { action_id: 'ar_2', action_type: 'apply', risk_score: 10, declared_goal: 'Edit README', agent_id: 'a', agent_name: 'A', timestamp_start: 't2', status: 'completed', systems_touched: '[]' },
  // Matches BOTH pack policies — the aggregate must count it once, as block.
  { action_id: 'ar_3', action_type: 'security', risk_score: 100, declared_goal: 'rm -rf /', agent_id: 'a', agent_name: 'A', timestamp_start: 't3', status: 'blocked', systems_touched: '[]' },
];

function simulateRequest(body) {
  return makeRequest('http://localhost/api/policies/simulate', {
    headers: { 'x-org-id': 'org_1' },
    body,
  });
}

describe('/api/policies/simulate POST (pack mode)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATABASE_URL = 'postgres://unit-test';
    mockLoadPackPolicies.mockResolvedValue(PACK_POLICIES);
    mockListActions.mockResolvedValue(ACTIONS);
  });

  it('rejects an unknown pack id', async () => {
    const res = await POST(simulateRequest({ pack: 'not-a-pack' }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain('Invalid pack');
  });

  it('still requires policy_type and rules when no pack is given', async () => {
    const res = await POST(simulateRequest({}));
    expect(res.status).toBe(400);
  });

  it('returns 404 when the pack file is missing', async () => {
    mockLoadPackPolicies.mockRejectedValue(new Error('ENOENT'));
    const res = await POST(simulateRequest({ pack: 'claude-code-starter' }));
    expect(res.status).toBe(404);
  });

  it('aggregates each action once at its most severe outcome', async () => {
    const res = await POST(simulateRequest({ pack: 'claude-code-starter', days: 30 }));
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.pack).toBe('claude-code-starter');
    expect(data.window_days).toBe(30);
    expect(data.summary.total).toBe(3);
    // ar_1 → require_approval, ar_2 → allow, ar_3 → block (matched both, block wins).
    expect(data.summary.matches).toBe(2);
    expect(data.summary.block).toBe(1);
    expect(data.summary.require_approval).toBe(1);
    expect(data.summary.allow).toBe(1);
  });

  it('reports per-policy match counts without deduping', async () => {
    const res = await POST(simulateRequest({ pack: 'claude-code-starter' }));
    const data = await res.json();

    const risk = data.per_policy.find((p) => p.policy_type === 'risk_threshold');
    const approval = data.per_policy.find((p) => p.policy_type === 'require_approval');
    expect(risk.matches).toBe(1);
    expect(risk.block).toBe(1);
    // The approval policy matches BOTH ar_1 and ar_3 in its own row.
    expect(approval.matches).toBe(2);
    expect(approval.require_approval).toBe(2);
  });

  it('lists matched actions with the winning policy name', async () => {
    const res = await POST(simulateRequest({ pack: 'claude-code-starter' }));
    const data = await res.json();

    expect(data.matches).toHaveLength(2);
    const blocked = data.matches.find((m) => m.action_id === 'ar_3');
    expect(blocked.simulated_action).toBe('block');
    expect(blocked.matched_policy).toBe('Pack — Block at risk 100');
    expect(data.matches_truncated).toBe(false);
  });

  it('handles an empty history window', async () => {
    mockListActions.mockResolvedValue([]);
    const res = await POST(simulateRequest({ pack: 'claude-code-starter' }));
    const data = await res.json();
    expect(data.summary.total).toBe(0);
    expect(data.matches).toEqual([]);
    expect(data.message).toContain('No historical actions');
  });

  it('single-policy mode is unchanged', async () => {
    const res = await POST(simulateRequest({
      policy_type: 'require_approval',
      rules: { action_types: ['payment'] },
    }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.summary.total).toBe(3);
    expect(data.summary.require_approval).toBe(1);
    expect(data.pack).toBeUndefined();
  });
});
