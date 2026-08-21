import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockSql,
  mockGetActivePolicies,
  mockGetAllPolicies,
  mockGetDecisionCountsByPolicy,
  mockGetDecisionOutcomeCounts,
  mockListAgentsForOrg,
  mockGetActionStats,
  mockGetInterruptionBudget,
  mockGetOverBudgetPolicyIds,
  mockGetOverBudgetShapeKeys,
} = vi.hoisted(() => ({
  mockSql: Object.assign(vi.fn(async () => []), { query: vi.fn(async () => []) }),
  mockGetActivePolicies: vi.fn(),
  mockGetAllPolicies: vi.fn(),
  mockGetDecisionCountsByPolicy: vi.fn(),
  mockGetDecisionOutcomeCounts: vi.fn(),
  mockListAgentsForOrg: vi.fn(),
  mockGetActionStats: vi.fn(),
  mockGetInterruptionBudget: vi.fn(),
  mockGetOverBudgetPolicyIds: vi.fn(),
  mockGetOverBudgetShapeKeys: vi.fn(),
}));

vi.mock('@/lib/db.js', () => ({ getSql: () => mockSql }));
vi.mock('@/lib/repositories/guardrails.repository.js', () => ({
  getActivePolicies: mockGetActivePolicies,
  getAllPolicies: mockGetAllPolicies,
  getDecisionCountsByPolicy: mockGetDecisionCountsByPolicy,
  getDecisionOutcomeCounts: mockGetDecisionOutcomeCounts,
}));
vi.mock('@/lib/repositories/agents.repository.js', () => ({ listAgentsForOrg: mockListAgentsForOrg }));
vi.mock('@/lib/repositories/actions.repository.js', () => ({ getActionStats: mockGetActionStats }));
vi.mock('@/lib/guard/caches.js', () => ({
  getInterruptionBudget: mockGetInterruptionBudget,
  getOverBudgetPolicyIds: mockGetOverBudgetPolicyIds,
  getOverBudgetShapeKeys: mockGetOverBudgetShapeKeys,
}));

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
  // Default: nothing dormant, so getAllPolicies mirrors getActivePolicies.
  mockGetAllPolicies.mockImplementation((...args) => mockGetActivePolicies(...args));
  mockGetDecisionCountsByPolicy.mockResolvedValue({});
  mockGetDecisionOutcomeCounts.mockResolvedValue({ total: 0, allow: 0, warn: 0, require_approval: 0, block: 0 });
  mockListAgentsForOrg.mockResolvedValue([]);
  mockGetActionStats.mockResolvedValue({ current: { approval: 0 }, previousTotal: 0 });
  // Non-default on purpose: a report that hardcodes 50 would pass either way.
  mockGetInterruptionBudget.mockResolvedValue(25);
  mockGetOverBudgetPolicyIds.mockResolvedValue(new Set(['c1']));
  mockGetOverBudgetShapeKeys.mockResolvedValue(new Set(['git log', 'npm test']));
});

describe('GET /api/policies/summary', () => {
  it('returns the ungoverned summary when no policies are active', async () => {
    const res = await GET(req());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.governed).toBe(false);
    expect(data.primaryMode).toBeNull();
    expect(data.shields).toHaveLength(10); // full catalog (secret_guard shield retired with semantic_check), incl. v4.63.0 Evidence Required + Subagent Constraint
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

// ── Short List, suggestions, interruption-budget report (spec §4.2-§4.4) ──────

const CATASTROPHE = [
  {
    id: 'c1',
    name: 'Catastrophe Pack — Hold Mass-Destructive Operations for Approval',
    policy_type: 'risk_threshold',
    rules: rules({ threshold: 100, action: 'require_approval', only_evidence_flags: ['protected_target'], except_git_push: { force: true }, short_list: true }),
  },
  {
    id: 'c2',
    name: 'Catastrophe Pack — Hold Secret-File Writes for Approval',
    policy_type: 'protected_path',
    rules: rules({ action: 'require_approval', ungrantable: true, short_list: true, paths: ['**/.env'] }),
  },
  {
    id: 'c3',
    name: 'Catastrophe Pack — Hold Force-Push Over Protected Branches',
    policy_type: 'require_approval',
    rules: rules({ action: 'require_approval', git_push: { force: true, branches: ['main'] }, short_list: true }),
  },
  {
    id: 'c4',
    name: 'Catastrophe Pack — Rate-Limit Runaway Agents',
    policy_type: 'rate_limit',
    rules: rules({ max_actions: 200, window_minutes: 10, action: 'warn', short_list: true }),
  },
];
const CUSTOM_WARN = {
  id: 'w1',
  name: 'Watch API calls',
  policy_type: 'warn_action_type',
  rules: rules({ action_types: ['api'] }),
};
const CUSTOM_HOLD = {
  id: 'h1',
  name: 'Hold deploys',
  policy_type: 'require_approval',
  rules: rules({ action_types: ['deploy'], shape_exceptions: ['git log'] }),
};

describe('GET /api/policies/summary — Short List', () => {
  it('derives the Short List with tiers, seeded flags, and the hard cap', async () => {
    mockGetActivePolicies.mockResolvedValue([...CATASTROPHE, CUSTOM_WARN, CUSTOM_HOLD]);
    mockGetDecisionCountsByPolicy.mockResolvedValue({ h1: { fired: 12, lastFiredAt: '2026-08-19T00:00:00Z' } });

    const data = await (await GET(req())).json();
    expect(data.shortListCap).toBe(10);
    // 4 seeded catastrophe lines + the custom hold. The warn rule is watched.
    expect(data.shortList).toHaveLength(5);
    const byId = Object.fromEntries(data.shortList.map((l: { id: string }) => [l.id, l]));
    expect(byId.c1.tier).toBe('HOLD'); // the risk-100 line holds, never blocks (2026-08-21)
    expect(byId.c2.tier).toBe('HOLD');
    expect(byId.c3.tier).toBe('HOLD');
    expect(byId.c4.tier).toBe('WATCH'); // short_list opt-in, warn action
    expect(byId.h1.tier).toBe('HOLD');
    expect(byId.c2.ungrantable).toBe(true);
    expect(byId.h1.ungrantable).toBe(false);
    expect(byId.c1.seeded).toBe(true);
    expect(byId.h1.seeded).toBe(false);
    expect(byId.h1.shape_exceptions).toEqual(['git log']);
    expect(byId.h1.fired30d).toBe(12);
    expect(byId.h1.active).toBe(true);
    expect(typeof byId.c1.scope).toBe('string');
    expect(byId.c1.scope.length).toBeGreaterThan(0);
    expect(data.shortList.every((l: { policy_type: string }) => typeof l.policy_type === 'string')).toBe(true);
  });

  it('carries dormant interrupting lines with active:false, uncounted by the cap', async () => {
    const dormant = {
      id: 'd1',
      name: 'Reviewer role ceiling',
      policy_type: 'role_constraint',
      rules: rules({ allowed_action_types: ['read'] }),
      active: 0,
    };
    mockGetActivePolicies.mockResolvedValue([...CATASTROPHE, CUSTOM_HOLD]);
    mockGetAllPolicies.mockResolvedValue([...CATASTROPHE, CUSTOM_HOLD, dormant]);

    const data = await (await GET(req())).json();
    const line = data.shortList.find((l: { id: string }) => l.id === 'd1');
    expect(line).toBeDefined();
    expect(line.active).toBe(false);
    expect(line.tier).toBe('HOLD');
    // The cap counts what is actually interrupting: 5 active, the 6th is off.
    expect(data.shortList).toHaveLength(6);
    expect(data.shortList.filter((l: { active: boolean }) => l.active)).toHaveLength(5);
    expect(data.shortListCap).toBe(10);
    // A dormant rule must not leak into the enforcement buckets.
    expect(data.enforcement.total).toBe(5);
  });

  it('falls back to the active rows when the all-policies query fails', async () => {
    mockGetActivePolicies.mockResolvedValue([...CATASTROPHE, CUSTOM_HOLD]);
    mockGetAllPolicies.mockRejectedValue(new Error('guard_policies unreadable'));
    const data = await (await GET(req())).json();
    expect(data.shortList).toHaveLength(5);
    expect(data.shortList.every((l: { active: boolean }) => l.active)).toBe(true);
  });

  it('suggests the real-money rule when nothing gates the spend action types', async () => {
    mockGetActivePolicies.mockResolvedValue([...CATASTROPHE, CUSTOM_WARN, CUSTOM_HOLD]);
    const data = await (await GET(req())).json();
    const s = data.suggestions.find((x: { id: string }) => x.id === 'real_money');
    expect(s).toBeDefined();
    expect(s.title).toBe('Real money');
    expect(typeof s.scope).toBe('string');
    expect(s.rule.policy_type).toBe('require_approval');
    expect(s.rule.rules.action).toBe('require_approval');
    expect(s.rule.rules.ungrantable).toBe(true);
    expect(s.rule.rules.short_list).toBe(true);
    // Read from the spend-lockdown pack, never a second hardcoded copy.
    expect(s.rule.rules.action_types).toHaveLength(11);
    expect(s.rule.rules.action_types).toContain('payment');
    expect(s.rule.rules.action_types).toContain('card_charge');
  });

  it('drops the real-money suggestion once a policy gates a spend type', async () => {
    mockGetActivePolicies.mockResolvedValue([
      ...CATASTROPHE,
      { id: 'sp1', name: 'Hold payments', policy_type: 'require_approval', rules: rules({ action_types: ['payment'] }) },
    ]);
    const data = await (await GET(req())).json();
    expect(data.suggestions.find((x: { id: string }) => x.id === 'real_money')).toBeUndefined();
  });

  it('reports the ORG budget and the live over-budget counts, not the defaults', async () => {
    mockGetActivePolicies.mockResolvedValue(CATASTROPHE);
    const data = await (await GET(req())).json();
    expect(data.budgetReport).toEqual({
      policiesOverBudget: 1,
      shapesOverBudget: 2,
      window_hours: 24,
      budget: 25,
      shape_budget: 10,
    });
  });

  it('reports both grains off when the org budget is 0', async () => {
    mockGetActivePolicies.mockResolvedValue(CATASTROPHE);
    mockGetInterruptionBudget.mockResolvedValue(0);
    const data = await (await GET(req())).json();
    expect(data.budgetReport.budget).toBe(0);
    expect(data.budgetReport.shape_budget).toBe(0);
  });

  it('falls back to the default budget when the budget load fails', async () => {
    mockGetActivePolicies.mockResolvedValue(CATASTROPHE);
    mockGetInterruptionBudget.mockRejectedValue(new Error('settings unreadable'));
    const data = await (await GET(req())).json();
    expect(data.budgetReport.budget).toBe(50);
  });
});
