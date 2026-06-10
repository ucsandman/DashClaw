import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  getCostAggregation: vi.fn(),
  getUnpricedModelSummary: vi.fn(),
  getX402SpendAggregation: vi.fn(),
  getCodeSessionSpendAggregation: vi.fn(),
}));
vi.mock('@/lib/repositories/actions.repository.js', () => ({
  getCostAggregation: m.getCostAggregation,
  getUnpricedModelSummary: m.getUnpricedModelSummary,
}));
vi.mock('@/lib/repositories/x402.repository.js', () => ({ getX402SpendAggregation: m.getX402SpendAggregation }));
vi.mock('@/lib/repositories/code-sessions.repository.js', () => ({ getCodeSessionSpendAggregation: m.getCodeSessionSpendAggregation }));

const { getFleetSpend, getClaudeCodeSpend } = await import('@/lib/repositories/finops.repository.js');
const sql = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  m.getCostAggregation.mockResolvedValue({ total_cost_usd: 10, by_day: [{ date: '2026-06-05', cost_usd: 10 }], by_agent: [{ agent_id: 'a1', cost_usd: 10 }] });
  m.getUnpricedModelSummary.mockResolvedValue({ action_count: 3, total_tokens: 1200, models: [{ model: 'mystery-model', action_count: 3, total_tokens: 1200 }] });
  m.getX402SpendAggregation.mockResolvedValue({ total_spend_usd: 2.5, by_day: [{ date: '2026-06-05', spend_usd: 2.5 }], by_provider: [{ provider_id: 'prov_x', spend_usd: 2.5 }] });
  m.getCodeSessionSpendAggregation.mockResolvedValue({ total_cost_usd: 8.25, total_cache_savings_usd: 1.1, session_count: 3, by_day: [{ date: '2026-06-05', cost_usd: 8.25 }], by_project: [{ project_id: 'cp_1', project_name: 'demo', cost_usd: 8.25 }] });
});

describe('getFleetSpend', () => {
  it('composes agent + x402 spend and sums the fleet total', async () => {
    const out = await getFleetSpend(sql, 'org_1', { period: '30d' });
    expect(m.getCostAggregation).toHaveBeenCalledWith(sql, 'org_1', { period: '30d', agentId: null });
    expect(m.getX402SpendAggregation).toHaveBeenCalledWith(sql, 'org_1', { period: '30d', agentId: null });
    expect(out.lens).toBe('fleet');
    expect(out.agent.total_cost_usd).toBe(10);
    expect(out.x402.total_spend_usd).toBe(2.5);
    expect(out.fleet_total_usd).toBeCloseTo(12.5);
  });

  it('carries the unpriced-models indicator through to the fleet payload', async () => {
    const out = await getFleetSpend(sql, 'org_1', { period: '30d' });
    expect(m.getUnpricedModelSummary).toHaveBeenCalledWith(sql, 'org_1', { period: '30d', agentId: null });
    expect(out.unpriced.action_count).toBe(3);
    expect(out.unpriced.models[0].model).toBe('mystery-model');
  });

  it('forwards agentId to BOTH aggregations + the unpriced indicator (fleet invariant)', async () => {
    await getFleetSpend(sql, 'org_1', { period: '30d', agentId: 'agent-1' });
    expect(m.getCostAggregation).toHaveBeenCalledWith(sql, 'org_1', { period: '30d', agentId: 'agent-1' });
    expect(m.getX402SpendAggregation).toHaveBeenCalledWith(sql, 'org_1', { period: '30d', agentId: 'agent-1' });
    expect(m.getUnpricedModelSummary).toHaveBeenCalledWith(sql, 'org_1', { period: '30d', agentId: 'agent-1' });
  });
});

describe('getClaudeCodeSpend', () => {
  it('composes code-session spend under the claude_code lens', async () => {
    const out = await getClaudeCodeSpend(sql, 'org_1', { period: '30d' });
    expect(m.getCodeSessionSpendAggregation).toHaveBeenCalledWith(sql, 'org_1', { period: '30d' });
    expect(out.lens).toBe('claude_code');
    expect(out.period).toBe('30d');
    expect(out.code_sessions.total_cost_usd).toBe(8.25);
    expect(out.code_total_usd).toBeCloseTo(8.25);
  });

  it('defaults the total to 0 when the source returns nothing', async () => {
    m.getCodeSessionSpendAggregation.mockResolvedValue(undefined);
    const out = await getClaudeCodeSpend(sql, 'org_1', { period: '7d' });
    expect(out.code_total_usd).toBe(0);
  });
});
