import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { evaluatePolicy, verifyX402BudgetAfterInsert } from '@/lib/guard.js';
import { sumWindowSpend } from '@/lib/repositories/x402.repository';

// The budget tier reaches the repository via a dynamic import inside guard.ts;
// vitest resolves it to the same module id, so this mock intercepts it. Keep
// the module's other exports real — only the window sum is stubbed.
vi.mock('@/lib/repositories/x402.repository', async (importOriginal) => ({
  ...(await importOriginal()),
  sumWindowSpend: vi.fn(),
}));

const policy = { policy_type: 'x402_spend_limit' };

describe('evaluatePolicy: x402_spend_limit', () => {
  it('blocks a provider not in the allowed list', async () => {
    const rules = { allowed_providers: ['exa'], approval_threshold: 5, max_spend_usd: 50 };
    const out = await evaluatePolicy(policy, rules, { action_type: 'x402_purchase', provider: 'sketchy', cost_estimate: 0.1 });
    expect(out?.action).toBe('block');
  });

  it('blocks a provider on the blocked list', async () => {
    const rules = { blocked_providers: ['sketchy'], approval_threshold: 5, max_spend_usd: 50 };
    const out = await evaluatePolicy(policy, rules, { action_type: 'x402_purchase', provider: 'sketchy', cost_estimate: 0.1 });
    expect(out?.action).toBe('block');
  });

  it('requires approval over the threshold', async () => {
    const rules = { allowed_providers: [], approval_threshold: 1, max_spend_usd: 50 };
    const out = await evaluatePolicy(policy, rules, { action_type: 'x402_purchase', provider: 'exa', cost_estimate: 2 });
    expect(out?.action).toBe('require_approval');
  });

  it('blocks over the hard max (max takes precedence over approval)', async () => {
    const rules = { allowed_providers: [], approval_threshold: 1, max_spend_usd: 5 };
    const out = await evaluatePolicy(policy, rules, { action_type: 'x402_purchase', provider: 'exa', cost_estimate: 10 });
    expect(out?.action).toBe('block');
  });

  it('allows (returns null) under all limits', async () => {
    const rules = { allowed_providers: ['exa'], approval_threshold: 5, max_spend_usd: 50 };
    const out = await evaluatePolicy(policy, rules, { action_type: 'x402_purchase', provider: 'exa', cost_estimate: 0.1 });
    expect(out).toBeNull();
  });

  it('ignores non-purchase actions', async () => {
    const out = await evaluatePolicy(policy, { max_spend_usd: 0 }, { action_type: 'build', cost_estimate: 999 });
    expect(out).toBeNull();
  });

  // R6: allow/block lists must match whether the operator keyed them by the
  // provider display name OR the provider_id (the route now passes both).
  it('blocks a provider_id on the blocked list even when the name is not listed', async () => {
    const rules = { blocked_providers: ['prov_sketchy'], max_spend_usd: 50 };
    const out = await evaluatePolicy(policy, rules, { action_type: 'x402_purchase', provider: 'Sketchy Co', provider_id: 'prov_sketchy', cost_estimate: 0.1 });
    expect(out?.action).toBe('block');
  });

  it('blocks when the provider_id is not in an allowed list keyed by id', async () => {
    const rules = { allowed_providers: ['prov_exa'], max_spend_usd: 50 };
    const out = await evaluatePolicy(policy, rules, { action_type: 'x402_purchase', provider: 'Other', provider_id: 'prov_other', cost_estimate: 0.1 });
    expect(out?.action).toBe('block');
  });

  it('allows when the provider_id is in an allowed list keyed by id', async () => {
    const rules = { allowed_providers: ['prov_exa'], approval_threshold: 5, max_spend_usd: 50 };
    const out = await evaluatePolicy(policy, rules, { action_type: 'x402_purchase', provider: 'Exa', provider_id: 'prov_exa', cost_estimate: 0.1 });
    expect(out).toBeNull();
  });
});

// Cumulative budget tier (owner roadmap item 2): window sum + incoming amount
// vs budget_approval_threshold (>= require_approval) / budget_usd (> block).
describe('evaluatePolicy: x402_spend_limit cumulative budget', () => {
  const sql = {};
  const orgId = 'org_test';
  const ctx = (over = {}) => ({ action_type: 'x402_purchase', provider: 'exa', agent_id: 'agent-1', cost_estimate: 4, ...over });
  const run = (rules, context) => evaluatePolicy(policy, rules, context, sql, orgId, 0);

  beforeEach(() => {
    vi.mocked(sumWindowSpend).mockReset();
  });
  afterEach(() => {
    delete process.env.DASHCLAW_GUARD_FALLBACK;
  });

  it('under budget → null', async () => {
    vi.mocked(sumWindowSpend).mockResolvedValue(2);
    const out = await run({ budget_approval_threshold: 10, budget_usd: 20 }, ctx());
    expect(out).toBeNull();
  });

  it('at the approval threshold → require_approval (>= semantics)', async () => {
    vi.mocked(sumWindowSpend).mockResolvedValue(6);
    const out = await run({ budget_approval_threshold: 10, budget_usd: 20 }, ctx());
    expect(out?.action).toBe('require_approval');
    expect(out?.reason).toMatch(/budget approval threshold \$10/);
  });

  it('exactly at the hard budget → not blocked (> semantics, mirrors max_spend_usd)', async () => {
    vi.mocked(sumWindowSpend).mockResolvedValue(16);
    const out = await run({ budget_usd: 20 }, ctx());
    expect(out).toBeNull();
  });

  it('over the hard budget → block with the evidence in the reason', async () => {
    vi.mocked(sumWindowSpend).mockResolvedValue(18);
    const out = await run({ budget_usd: 20 }, ctx({ cost_estimate: 5 }));
    expect(out?.action).toBe('block');
    expect(out?.reason).toMatch(/Cumulative x402 spend \$23\.00 over 30d .*exceeds budget \$20/);
  });

  it('budget block beats a per-purchase require_approval (severity, not evaluation order)', async () => {
    vi.mocked(sumWindowSpend).mockResolvedValue(18);
    const out = await run({ approval_threshold: 1, budget_usd: 20 }, ctx({ cost_estimate: 5 }));
    expect(out?.action).toBe('block');
    expect(out?.reason).toMatch(/Cumulative x402 spend/);
  });

  it('a per-purchase block skips the budget query (already maximal)', async () => {
    const out = await run({ max_spend_usd: 5, budget_usd: 100 }, ctx({ cost_estimate: 10 }));
    expect(out?.action).toBe('block');
    expect(sumWindowSpend).not.toHaveBeenCalled();
  });

  it('no budget fields → no window query (per-purchase policies stay query-free)', async () => {
    const out = await run({ approval_threshold: 5, max_spend_usd: 50 }, ctx({ cost_estimate: 1 }));
    expect(out).toBeNull();
    expect(sumWindowSpend).not.toHaveBeenCalled();
  });

  it('org scope (default) sums without an agent filter', async () => {
    vi.mocked(sumWindowSpend).mockResolvedValue(0);
    await run({ budget_usd: 20 }, ctx());
    expect(sumWindowSpend).toHaveBeenCalledWith(sql, orgId, expect.objectContaining({ agentId: null }));
  });

  it('agent scope filters the sum to the acting agent', async () => {
    vi.mocked(sumWindowSpend).mockResolvedValue(0);
    await run({ budget_usd: 20, budget_scope: 'agent' }, ctx());
    expect(sumWindowSpend).toHaveBeenCalledWith(sql, orgId, expect.objectContaining({ agentId: 'agent-1' }));
  });

  it('agent scope normalizes a composed sub-agent id to its identity family base (roadmap v2.2)', async () => {
    // A sub-agent (claude-code:explore) cannot escape its parent's budget
    // via its composed id: the window sum is keyed on the family base.
    vi.mocked(sumWindowSpend).mockResolvedValue(0);
    await run({ budget_usd: 20, budget_scope: 'agent' }, ctx({ agent_id: 'claude-code:explore' }));
    expect(sumWindowSpend).toHaveBeenCalledWith(sql, orgId, expect.objectContaining({ agentId: 'claude-code' }));
  });

  it('agent scope over-budget reason names the family base, not the composed id', async () => {
    vi.mocked(sumWindowSpend).mockResolvedValue(18);
    const out = await run({ budget_usd: 20, budget_scope: 'agent' }, ctx({ agent_id: 'claude-code:explore', cost_estimate: 5 }));
    expect(out?.action).toBe('block');
    expect(out?.reason).toMatch(/agent claude-code\)/);
  });

  it('agent scope without an agent_id fails closed (require_approval, no query)', async () => {
    const out = await run({ budget_usd: 20, budget_scope: 'agent' }, ctx({ agent_id: undefined }));
    expect(out?.action).toBe('require_approval');
    expect(out?.reason).toMatch(/cannot attribute/);
    expect(sumWindowSpend).not.toHaveBeenCalled();
  });

  it('budget_window_days bounds the window start', async () => {
    vi.mocked(sumWindowSpend).mockResolvedValue(0);
    await run({ budget_usd: 20, budget_window_days: 7 }, ctx());
    const { sinceIso } = vi.mocked(sumWindowSpend).mock.calls[0][2];
    expect(Math.abs(Date.parse(sinceIso) - (Date.now() - 7 * 86400000))).toBeLessThan(60000);
  });

  it('sum failure → fail-closed require_approval by default', async () => {
    vi.mocked(sumWindowSpend).mockRejectedValue(new Error('db down'));
    const out = await run({ budget_usd: 20 }, ctx());
    expect(out?.action).toBe('require_approval');
    expect(out?.reason).toMatch(/budget check failed.*degraded/);
  });

  it('sum failure honors on_failure: block', async () => {
    vi.mocked(sumWindowSpend).mockRejectedValue(new Error('db down'));
    const out = await run({ budget_usd: 20, on_failure: 'block' }, ctx());
    expect(out?.action).toBe('block');
  });

  it('sum failure honors the explicit allow escape hatch — passes through but leaves a ledger warning', async () => {
    vi.mocked(sumWindowSpend).mockRejectedValue(new Error('db down'));
    const out = await run({ budget_usd: 20, on_failure: 'allow' }, ctx());
    expect(out?.action).toBe('allow');
    expect(out?.extraWarnings).toEqual(['x402 budget check failed — skipped (on_failure: allow)']);
  });

  it('sum failure honors DASHCLAW_GUARD_FALLBACK when no per-policy override', async () => {
    process.env.DASHCLAW_GUARD_FALLBACK = 'block';
    vi.mocked(sumWindowSpend).mockRejectedValue(new Error('db down'));
    const out = await run({ budget_usd: 20 }, ctx());
    expect(out?.action).toBe('block');
  });
});

// Post-insert re-verification (TOCTOU close-out): concurrent purchases can all
// pass the pre-insert check against the same window sum; the route re-verifies
// the hard budget after the row commits and compensates on breach.
describe('verifyX402BudgetAfterInsert', () => {
  // Fake tagged-template sql: loadOrgPolicies' single SELECT resolves to the
  // given policy rows. Unique orgIds per test dodge the guard's 30s policy cache.
  const fakeSql = (rows) => Object.assign(() => Promise.resolve(rows), { query: () => Promise.resolve(rows) });
  const budgetPolicy = (rules, over = {}) => ({
    id: 'gp_budget', name: 'budget', policy_type: 'x402_spend_limit',
    rules: JSON.stringify(rules), agent_ids: null, ...over,
  });
  const ctx = { action_type: 'x402_purchase', agent_id: 'agent-1', cost_estimate: 4 };

  beforeEach(() => {
    vi.mocked(sumWindowSpend).mockReset();
  });

  it('returns the breach when the committed window sum exceeds the hard budget', async () => {
    vi.mocked(sumWindowSpend).mockResolvedValue(26);
    const out = await verifyX402BudgetAfterInsert('org_v1', ctx, fakeSql([budgetPolicy({ budget_usd: 20 })]));
    expect(out?.policyId).toBe('gp_budget');
    expect(out?.reason).toMatch(/\$26\.00 over 30d .*exceeds budget \$20 — post-insert re-verification/);
  });

  it('returns null when the committed sum is within the budget (sequential purchases stay clean)', async () => {
    vi.mocked(sumWindowSpend).mockResolvedValue(12);
    const out = await verifyX402BudgetAfterInsert('org_v2', ctx, fakeSql([budgetPolicy({ budget_usd: 20 })]));
    expect(out).toBeNull();
  });

  it('ignores policies without a hard budget (approval tier already had its interruption)', async () => {
    const out = await verifyX402BudgetAfterInsert('org_v3', ctx, fakeSql([budgetPolicy({ budget_approval_threshold: 10 })]));
    expect(out).toBeNull();
    expect(sumWindowSpend).not.toHaveBeenCalled();
  });

  it('respects agent scope in the re-verified sum', async () => {
    vi.mocked(sumWindowSpend).mockResolvedValue(0);
    await verifyX402BudgetAfterInsert('org_v4', ctx, fakeSql([budgetPolicy({ budget_usd: 20, budget_scope: 'agent' })]));
    expect(sumWindowSpend).toHaveBeenCalledWith(expect.anything(), 'org_v4', expect.objectContaining({ agentId: 'agent-1' }));
  });

  it('normalizes a composed sub-agent id to the family base in the re-verified sum (roadmap v2.2)', async () => {
    vi.mocked(sumWindowSpend).mockResolvedValue(0);
    const composedCtx = { ...ctx, agent_id: 'claude-code:explore' };
    await verifyX402BudgetAfterInsert('org_v6', composedCtx, fakeSql([budgetPolicy({ budget_usd: 20, budget_scope: 'agent' })]));
    expect(sumWindowSpend).toHaveBeenCalledWith(expect.anything(), 'org_v6', expect.objectContaining({ agentId: 'claude-code' }));
  });

  it('is best-effort: a policy-load failure returns null instead of failing the purchase', async () => {
    const throwingSql = Object.assign(() => Promise.reject(new Error('db down')), { query: () => Promise.reject(new Error('db down')) });
    const out = await verifyX402BudgetAfterInsert('org_v5', ctx, throwingSql);
    expect(out).toBeNull();
  });
});
