import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  sql: vi.fn(async () => []),
  evaluateGuard: vi.fn(),
  createActionRecord: vi.fn(),
  createBlockedActionRecord: vi.fn(),
  deleteActionsByIds: vi.fn(),
  createPurchase: vi.fn(),
  listPurchases: vi.fn(),
  getProvider: vi.fn(),
  getEndpoint: vi.fn(),
  resolveAgentIdentity: vi.fn(),
}));
vi.mock('@/lib/db.js', () => ({ getSql: () => m.sql }));
vi.mock('@/lib/org.js', () => ({ getOrgId: () => 'org_1' }));
vi.mock('@/lib/guard.js', () => ({ evaluateGuard: m.evaluateGuard, verifyX402BudgetAfterInsert: vi.fn(async () => null) }));
vi.mock('@/lib/repositories/actions.repository.js', () => ({
  createActionRecord: m.createActionRecord,
  createBlockedActionRecord: m.createBlockedActionRecord,
  deleteActionsByIds: m.deleteActionsByIds,
  markActionBlocked: vi.fn(),
}));
vi.mock('@/lib/repositories/x402.repository.js', () => ({
  createPurchase: m.createPurchase, listPurchases: m.listPurchases,
  getProvider: m.getProvider, getEndpoint: m.getEndpoint,
  setPurchaseOutcome: vi.fn(),
}));
vi.mock('@/lib/identity-resolution.js', () => ({ resolveAgentIdentity: m.resolveAgentIdentity }));

const { POST } = await import('@/api/x402/purchases/route.js');
function req(body, headers = {}) {
  return new Request('http://localhost/api/x402/purchases', {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
}
const valid = { agent_id: 'a1', provider: 'exa', declared_goal: 'research', cost_estimate: 0.05, purchase_reason: 'gap', context_gap: 'no current data', expected_value: 'fresh sources' };

beforeEach(() => {
  vi.clearAllMocks();
  m.evaluateGuard.mockResolvedValue({ decision: 'allow', risk_score: 40 });
  m.createActionRecord.mockResolvedValue({ action_id: 'act_a', status: 'running' });
  m.createPurchase.mockResolvedValue({ action_id: 'act_a', execution_status: 'approved' });
  m.deleteActionsByIds.mockResolvedValue([]);
  m.resolveAgentIdentity.mockResolvedValue({ agent_id: 'a1', agent_name: null, verification_status: 'unverified', verified: false });
});

describe('x402 purchase hardening', () => {
  it('rejects negative spend with 400 before calling guard (R4)', async () => {
    const res = await POST(req({ ...valid, cost_estimate: -5 }));
    expect(res.status).toBe(400);
    expect(m.evaluateGuard).not.toHaveBeenCalled();
  });

  it('rejects a non-finite (overflow) spend with 400 (R4)', async () => {
    // JSON cannot carry Infinity literally; a string that coerces to Infinity is
    // the real wire vector. Number('1e999') === Infinity.
    const res = await POST(req({ ...valid, cost_estimate: '1e999' }));
    expect(res.status).toBe(400);
  });

  it('rejects malformed currency with 400 (R4)', async () => {
    const res = await POST(req({ ...valid, currency: "'; DROP--" }));
    expect(res.status).toBe(400);
  });

  it('persists the authoritative guard risk on the action and purchase (R1)', async () => {
    await POST(req({ ...valid, risk_score: 0 }));
    expect(m.createActionRecord).toHaveBeenCalledWith(m.sql, expect.objectContaining({ riskScore: 40 }));
  });

  it('rejects a provider_id that does not resolve in this org (R5 / cross-tenant)', async () => {
    m.getProvider.mockResolvedValue(null);
    const res = await POST(req({ ...valid, provider_id: 'prov_other_org' }));
    expect([400, 404]).toContain(res.status);
    expect(m.createActionRecord).not.toHaveBeenCalled();
  });

  it('rejects a disabled provider (R5)', async () => {
    m.getProvider.mockResolvedValue({ provider_id: 'prov_x', org_id: 'org_1', name: 'Exa', status: 'disabled' });
    const res = await POST(req({ ...valid, provider_id: 'prov_x' }));
    expect(res.status).toBe(400);
  });

  it('rejects an endpoint that does not belong to the provider (R5)', async () => {
    m.getProvider.mockResolvedValue({ provider_id: 'prov_x', org_id: 'org_1', name: 'Exa', status: 'active' });
    m.getEndpoint.mockResolvedValue({ endpoint_id: 'pep_y', org_id: 'org_1', provider_id: 'prov_DIFFERENT', enabled: 1 });
    const res = await POST(req({ ...valid, provider_id: 'prov_x', endpoint_id: 'pep_y' }));
    expect(res.status).toBe(400);
  });

  it('redacts wallet_reference at rest and in the response (R9)', async () => {
    m.createPurchase.mockImplementation(async (_sql, _org, _id, data) => ({ action_id: 'act_a', ...data }));
    const res = await POST(req({ ...valid, wallet_reference: '0xABCDEF0123456789DEADBEEF' }));
    const stored = m.createPurchase.mock.calls[0][3];
    expect(stored.wallet_reference).not.toContain('DEADBEEF');
    expect(stored.wallet_reference).not.toBe('0xABCDEF0123456789DEADBEEF');
    const body = await res.json();
    expect(JSON.stringify(body)).not.toContain('0xABCDEF0123456789DEADBEEF');
  });

  it('compensates by deleting the orphan action when purchase creation fails (R7)', async () => {
    m.createPurchase.mockRejectedValue(new Error('insert failed'));
    const res = await POST(req(valid));
    expect(res.status).toBe(500);
    expect(m.deleteActionsByIds).toHaveBeenCalledWith(m.sql, 'org_1', [expect.stringMatching(/^act_/)]);
  });

  it('uses the JWKS-verified identity over the body agent_id (R3)', async () => {
    m.resolveAgentIdentity.mockResolvedValue({ agent_id: 'verified_sub', agent_name: 'V', verification_status: 'verified', verified: true });
    await POST(req({ ...valid, agent_id: 'attacker_chosen' }));
    expect(m.createActionRecord).toHaveBeenCalledWith(m.sql, expect.objectContaining({
      data: expect.objectContaining({ agent_id: 'verified_sub' }),
      verified: true,
    }));
  });

  it('clamps enforced spend to the resolved endpoint price — a known-priced endpoint cannot be under-declared (D1)', async () => {
    m.getProvider.mockResolvedValue({ provider_id: 'prov_x', org_id: 'org_1', name: 'Exa', status: 'active' });
    m.getEndpoint.mockResolvedValue({ endpoint_id: 'pep_y', org_id: 'org_1', provider_id: 'prov_x', enabled: 1, default_price: 5 });
    const res = await POST(req({ ...valid, provider_id: 'prov_x', endpoint_id: 'pep_y', cost_estimate: 0.01 }));

    // Guard gates evaluate against the CLAMPED amount; the declared figure
    // rides the audited context for transparency.
    expect(m.evaluateGuard).toHaveBeenCalledWith('org_1', expect.objectContaining({
      cost_estimate: 5,
      declared_spend_amount: 0.01,
    }), m.sql);
    // Window sums and the action estimate also use the enforced amount.
    expect(m.createPurchase.mock.calls[0][3].spend_amount).toBe(5);
    expect(m.createActionRecord).toHaveBeenCalledWith(m.sql, expect.objectContaining({ costEstimate: 5 }));
    // The response tells the agent what was enforced.
    const body = await res.json();
    expect(body.spend_enforcement).toEqual({ declared: 0.01, enforced: 5, clamped: true });
  });

  it('declared spend at or above the endpoint price is used as-is (D1)', async () => {
    m.getProvider.mockResolvedValue({ provider_id: 'prov_x', org_id: 'org_1', name: 'Exa', status: 'active' });
    m.getEndpoint.mockResolvedValue({ endpoint_id: 'pep_y', org_id: 'org_1', provider_id: 'prov_x', enabled: 1, default_price: 5 });
    await POST(req({ ...valid, provider_id: 'prov_x', endpoint_id: 'pep_y', cost_estimate: 7.5 }));
    expect(m.evaluateGuard).toHaveBeenCalledWith('org_1', expect.objectContaining({ cost_estimate: 7.5 }), m.sql);
    expect(m.createPurchase.mock.calls[0][3].spend_amount).toBe(7.5);
  });
});
