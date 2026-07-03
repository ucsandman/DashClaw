import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  sql: vi.fn(async () => []),
  getActivePolicies: vi.fn(),
  sumWindowSpend: vi.fn(),
  sumWindowSpendByFamily: vi.fn(),
}));
vi.mock('@/lib/db.js', () => ({ getSql: () => m.sql }));
vi.mock('@/lib/org.js', () => ({ getOrgId: () => 'org_1' }));
vi.mock('@/lib/repositories/guardrails.repository.js', () => ({ getActivePolicies: m.getActivePolicies }));
vi.mock('@/lib/repositories/x402.repository.js', () => ({
  sumWindowSpend: m.sumWindowSpend,
  sumWindowSpendByFamily: m.sumWindowSpendByFamily,
}));

const { GET } = await import('@/api/x402/budget/route.js');

const req = (qs = '') => new Request(`http://localhost/api/x402/budget${qs}`);

const policy = (over = {}) => ({
  id: 'pol_1', name: 'Spend guard', policy_type: 'x402_spend_limit',
  rules: JSON.stringify({ budget_usd: 50, budget_approval_threshold: 40, budget_window_days: 30, ...over.rules }),
  agent_ids: null,
  ...over.row,
});

beforeEach(() => {
  vi.clearAllMocks();
  m.sumWindowSpend.mockResolvedValue(0);
  m.sumWindowSpendByFamily.mockResolvedValue([]);
});

describe('GET /api/x402/budget', () => {
  it('returns an org-scoped meter with window spend from the shared predicate', async () => {
    m.getActivePolicies.mockResolvedValue([policy()]);
    m.sumWindowSpend.mockResolvedValue(43.2);
    const res = await GET(req());
    expect(res.status).toBe(200);
    const { budgets } = await res.json();
    expect(budgets).toHaveLength(1);
    expect(budgets[0]).toMatchObject({
      policy_id: 'pol_1', budget_scope: 'org', budget_usd: 50,
      budget_approval_threshold: 40, budget_window_days: 30, window_spend_usd: 43.2,
    });
    // org scope sums the whole org (no agentId narrowing)
    expect(m.sumWindowSpend).toHaveBeenCalledWith(m.sql, 'org_1', expect.not.objectContaining({ agentId: expect.anything() }));
    expect(m.sumWindowSpendByFamily).not.toHaveBeenCalled();
  });

  it('skips per-purchase-only policies and non-x402 policies (zero spend queries)', async () => {
    m.getActivePolicies.mockResolvedValue([
      policy({ rules: { budget_usd: undefined, budget_approval_threshold: undefined } }),
      { id: 'pol_r', policy_type: 'rate_limit', rules: '{}' },
    ]);
    const res = await GET(req());
    expect((await res.json()).budgets).toEqual([]);
    expect(m.sumWindowSpend).not.toHaveBeenCalled();
    expect(m.sumWindowSpendByFamily).not.toHaveBeenCalled();
  });

  it('agent-scoped budgets return per-family spend', async () => {
    m.getActivePolicies.mockResolvedValue([policy({ rules: { budget_scope: 'agent' } })]);
    m.sumWindowSpendByFamily.mockResolvedValue([
      { agent_id: 'claude-code', window_spend_usd: 43.2 },
      { agent_id: 'codex', window_spend_usd: 1.1 },
    ]);
    const { budgets } = await (await GET(req())).json();
    expect(budgets[0].budget_scope).toBe('agent');
    expect(budgets[0].families).toHaveLength(2);
    expect(budgets[0].window_spend_usd).toBeUndefined();
  });

  it('?agent_id narrows agent-scoped entries to the identity FAMILY base', async () => {
    m.getActivePolicies.mockResolvedValue([policy({ rules: { budget_scope: 'agent' } })]);
    m.sumWindowSpend.mockResolvedValue(7.5);
    const { budgets } = await (await GET(req('?agent_id=claude-code%3Aexplore'))).json();
    // composed sub-agent id rolls up to its base, matching the guard gate
    expect(m.sumWindowSpend).toHaveBeenCalledWith(m.sql, 'org_1', expect.objectContaining({ agentId: 'claude-code' }));
    expect(budgets[0].families).toEqual([{ agent_id: 'claude-code', window_spend_usd: 7.5 }]);
  });

  it('?agent_id does NOT narrow org-scoped entries', async () => {
    m.getActivePolicies.mockResolvedValue([policy()]);
    m.sumWindowSpend.mockResolvedValue(12);
    const { budgets } = await (await GET(req('?agent_id=claude-code'))).json();
    expect(budgets[0].window_spend_usd).toBe(12);
    expect(m.sumWindowSpend).toHaveBeenCalledWith(m.sql, 'org_1', expect.not.objectContaining({ agentId: expect.anything() }));
  });

  it('agent_ids-targeted budgets meter ONLY the targeted families', async () => {
    m.getActivePolicies.mockResolvedValue([
      policy({ rules: { budget_scope: 'agent' }, row: { agent_ids: JSON.stringify(['claude-code']) } }),
    ]);
    m.sumWindowSpendByFamily.mockResolvedValue([
      { agent_id: 'claude-code', window_spend_usd: 5 },
      { agent_id: 'smoke-b6', window_spend_usd: 22 }, // never gated by this policy
    ]);
    const { budgets } = await (await GET(req())).json();
    expect(budgets[0].families).toEqual([{ agent_id: 'claude-code', window_spend_usd: 5 }]);
  });

  it('?agent_id outside the policy targeting returns no families for that policy', async () => {
    m.getActivePolicies.mockResolvedValue([
      policy({ rules: { budget_scope: 'agent' }, row: { agent_ids: JSON.stringify(['claude-code']) } }),
    ]);
    const { budgets } = await (await GET(req('?agent_id=unrelated-agent'))).json();
    expect(budgets[0].families).toEqual([]);
    expect(m.sumWindowSpend).not.toHaveBeenCalled();
  });

  it('clamps window days like the guard (default 30, max 365, min 1)', async () => {
    m.getActivePolicies.mockResolvedValue([
      policy({ row: { id: 'p_default' }, rules: { budget_window_days: undefined } }),
      policy({ row: { id: 'p_big' }, rules: { budget_window_days: 9999 } }),
      policy({ row: { id: 'p_zero' }, rules: { budget_window_days: 0 } }),
    ]);
    const { budgets } = await (await GET(req())).json();
    expect(budgets.map((b) => b.budget_window_days)).toEqual([30, 365, 30]);
  });

  it('unparseable rules are skipped, not fatal', async () => {
    m.getActivePolicies.mockResolvedValue([{ id: 'p_bad', policy_type: 'x402_spend_limit', rules: '{nope' }, policy()]);
    const { budgets } = await (await GET(req())).json();
    expect(budgets).toHaveLength(1);
    expect(budgets[0].policy_id).toBe('pol_1');
  });
});
