import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  sql: vi.fn(async () => []),
  evaluateGuard: vi.fn(),
  verifyX402BudgetAfterInsert: vi.fn(async () => null),
  createActionRecord: vi.fn(),
  createBlockedActionRecord: vi.fn(),
  markActionBlocked: vi.fn(),
  createPurchase: vi.fn(),
  listPurchases: vi.fn(),
  getProvider: vi.fn(),
  getEndpoint: vi.fn(),
  resolveProviderByName: vi.fn(),
  setPurchaseOutcome: vi.fn(),
  getActionSummary: vi.fn(),
  getPurchaseByIdempotencyKey: vi.fn(),
}));
vi.mock('@/lib/db.js', () => ({ getSql: () => m.sql }));
vi.mock('@/lib/org.js', () => ({ getOrgId: () => 'org_1', getUserId: () => 'key_test1' }));
vi.mock('@/lib/guard.js', () => ({ evaluateGuard: m.evaluateGuard, verifyX402BudgetAfterInsert: m.verifyX402BudgetAfterInsert }));
vi.mock('@/lib/repositories/actions.repository.js', () => ({
  createActionRecord: m.createActionRecord,
  createBlockedActionRecord: m.createBlockedActionRecord,
  deleteActionsByIds: vi.fn(),
  markActionBlocked: m.markActionBlocked,
  getActionSummary: m.getActionSummary,
}));
vi.mock('@/lib/repositories/x402.repository.js', () => ({
  createPurchase: m.createPurchase, listPurchases: m.listPurchases,
  getProvider: m.getProvider, getEndpoint: m.getEndpoint,
  resolveProviderByName: m.resolveProviderByName,
  setPurchaseOutcome: m.setPurchaseOutcome,
  getPurchaseByIdempotencyKey: m.getPurchaseByIdempotencyKey,
}));

const { POST, GET } = await import('@/api/x402/purchases/route.js');
function req(body) {
  return new Request('http://localhost/api/x402/purchases', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
}
const valid = { agent_id: 'a1', provider: 'exa', declared_goal: 'research', cost_estimate: 0.05, purchase_reason: 'gap', context_gap: 'no current data', expected_value: 'fresh sources' };

beforeEach(() => {
  vi.clearAllMocks();
  // Default: a name-only purchase resolves/auto-registers a provider_id.
  m.resolveProviderByName.mockResolvedValue({ provider_id: 'prov_exa', name: 'exa' });
  // Default: the post-insert budget re-verification finds no breach.
  m.verifyX402BudgetAfterInsert.mockResolvedValue(null);
  // Default: no prior purchase for any idempotency_key (v3.7 5d).
  m.getPurchaseByIdempotencyKey.mockResolvedValue(null);
});

describe('POST /api/x402/purchases', () => {
  it('400 when rationale fields are missing (guard not even called)', async () => {
    const res = await POST(req({ agent_id: 'a1', provider: 'exa' }));
    expect(res.status).toBe(400);
    expect(m.evaluateGuard).not.toHaveBeenCalled();
  });

  it('403 + blocked action when guard blocks; no purchase, no running action', async () => {
    m.evaluateGuard.mockResolvedValue({ decision: 'block', reason: 'not allowed' });
    m.createBlockedActionRecord.mockResolvedValue({ action_id: 'act_b', status: 'blocked' });
    const res = await POST(req(valid));
    expect(res.status).toBe(403);
    expect(m.createPurchase).not.toHaveBeenCalled();
    expect(m.createActionRecord).not.toHaveBeenCalled();
  });

  it('202 pending_approval when guard requires approval', async () => {
    m.evaluateGuard.mockResolvedValue({ decision: 'require_approval', reason: 'over threshold' });
    m.createActionRecord.mockResolvedValue({ action_id: 'act_p', status: 'pending_approval' });
    m.createPurchase.mockResolvedValue({ action_id: 'act_p' });
    const res = await POST(req(valid));
    expect(res.status).toBe(202);
    expect((await res.json()).action.status).toBe('pending_approval');
    // action recorded as the x402_purchase subtype, pending status, org-scoped
    expect(m.createActionRecord).toHaveBeenCalledWith(m.sql, expect.objectContaining({
      orgId: 'org_1', actionStatus: 'pending_approval',
      data: expect.objectContaining({ action_type: 'x402_purchase', agent_id: 'a1' }),
    }));
    // purchase is keyed by the route-generated act_ id (NOT the mock return), pending
    expect(m.createPurchase).toHaveBeenCalledWith(m.sql, 'org_1', expect.stringMatching(/^act_/), expect.objectContaining({ spend_amount: 0.05, execution_status: 'pending' }));
  });

  it('201 running when guard allows; purchase approved', async () => {
    m.evaluateGuard.mockResolvedValue({ decision: 'allow' });
    m.createActionRecord.mockResolvedValue({ action_id: 'act_a', status: 'running' });
    m.createPurchase.mockResolvedValue({ action_id: 'act_a' });
    const res = await POST(req(valid));
    expect(res.status).toBe(201);
    expect((await res.json()).action.status).toBe('running');
    expect(m.createPurchase).toHaveBeenCalledWith(m.sql, 'org_1', expect.stringMatching(/^act_/), expect.objectContaining({ execution_status: 'approved' }));
  });

  // TOCTOU close-out (security review 2026-07-02): a post-insert budget breach
  // compensates — purchase → failed, action → blocked, response → 403 — before
  // the agent ever executes payment.
  it('403 when the post-insert budget re-verification finds a breach', async () => {
    m.evaluateGuard.mockResolvedValue({ decision: 'allow', reasons: [] });
    m.createActionRecord.mockResolvedValue({ action_id: 'act_a', status: 'running' });
    m.createPurchase.mockResolvedValue({ action_id: 'act_a' });
    m.verifyX402BudgetAfterInsert.mockResolvedValue({ policyId: 'gp_b', reason: 'Cumulative x402 spend $26.00 over 30d (org) exceeds budget $20 — post-insert re-verification' });
    m.markActionBlocked.mockResolvedValue({ action_id: 'act_a', status: 'blocked' });
    m.setPurchaseOutcome.mockResolvedValue({ action_id: 'act_a', execution_status: 'failed' });
    const res = await POST(req(valid));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.action.status).toBe('blocked');
    expect(body.decision.decision).toBe('block');
    expect(body.decision.reasons.join(' ')).toMatch(/post-insert re-verification/);
    expect(m.setPurchaseOutcome).toHaveBeenCalledWith(m.sql, 'org_1', expect.stringMatching(/^act_/), expect.objectContaining({ execution_status: 'failed' }));
    expect(m.markActionBlocked).toHaveBeenCalledWith(m.sql, 'org_1', expect.stringMatching(/^act_/), expect.stringContaining('post-insert re-verification'));
  });

  it('resolves a provider_id from the name when none is supplied, and persists it on the purchase + guard context', async () => {
    m.evaluateGuard.mockResolvedValue({ decision: 'allow' });
    m.createActionRecord.mockResolvedValue({ action_id: 'act_a', status: 'running' });
    m.createPurchase.mockResolvedValue({ action_id: 'act_a' });
    await POST(req(valid)); // valid has provider: 'exa', no provider_id
    expect(m.resolveProviderByName).toHaveBeenCalledWith(m.sql, 'org_1', 'exa');
    // The resolved id is persisted on the detail row...
    expect(m.createPurchase).toHaveBeenCalledWith(m.sql, 'org_1', expect.stringMatching(/^act_/), expect.objectContaining({ provider_id: 'prov_exa' }));
    // ...and handed to guard so x402_spend_limit policies keyed by id match.
    expect(m.evaluateGuard).toHaveBeenCalledWith('org_1', expect.objectContaining({ provider: 'exa', provider_id: 'prov_exa' }), m.sql);
  });

  it('does NOT auto-resolve when a valid provider_id is already supplied', async () => {
    m.getProvider.mockResolvedValue({ provider_id: 'prov_given', name: 'Given', status: 'active' });
    m.evaluateGuard.mockResolvedValue({ decision: 'allow' });
    m.createActionRecord.mockResolvedValue({ action_id: 'act_a', status: 'running' });
    m.createPurchase.mockResolvedValue({ action_id: 'act_a' });
    await POST(req({ ...valid, provider_id: 'prov_given' }));
    expect(m.resolveProviderByName).not.toHaveBeenCalled();
    expect(m.createPurchase).toHaveBeenCalledWith(m.sql, 'org_1', expect.stringMatching(/^act_/), expect.objectContaining({ provider_id: 'prov_given' }));
  });

  it('a duplicate idempotency_key returns the cached purchase and does NOT create a second one (v3.7 5d)', async () => {
    m.getPurchaseByIdempotencyKey.mockResolvedValue({ action_id: 'act_prior', execution_status: 'approved', spend_amount: 0.05 });
    m.getActionSummary.mockResolvedValue({ action_id: 'act_prior', status: 'running' });
    const res = await POST(req({ ...valid, idempotency_key: 'dup-key' }));
    const body = await res.json();
    expect(body.idempotent_replay).toBe(true);
    expect(body.purchase.action_id).toBe('act_prior');
    expect(body.action.action_id).toBe('act_prior');
    expect(m.getPurchaseByIdempotencyKey).toHaveBeenCalledWith(m.sql, 'org_1', 'dup-key');
    expect(m.createPurchase).not.toHaveBeenCalled();
    expect(m.createActionRecord).not.toHaveBeenCalled();
    expect(m.evaluateGuard).not.toHaveBeenCalled();
  });

  it('different idempotency_keys each create their own purchase (v3.7 5d)', async () => {
    m.evaluateGuard.mockResolvedValue({ decision: 'allow' });
    m.createActionRecord.mockResolvedValue({ action_id: 'act_a', status: 'running' });
    m.createPurchase.mockResolvedValue({ action_id: 'act_a' });
    await POST(req({ ...valid, idempotency_key: 'key-1' }));
    await POST(req({ ...valid, idempotency_key: 'key-2' }));
    expect(m.createPurchase).toHaveBeenCalledTimes(2);
    expect(m.createPurchase.mock.calls[0][3]).toEqual(expect.objectContaining({ idempotency_key: 'key-1' }));
    expect(m.createPurchase.mock.calls[1][3]).toEqual(expect.objectContaining({ idempotency_key: 'key-2' }));
  });

  it('a missing idempotency_key behaves as today (no lookup, purchase created)', async () => {
    m.evaluateGuard.mockResolvedValue({ decision: 'allow' });
    m.createActionRecord.mockResolvedValue({ action_id: 'act_a', status: 'running' });
    m.createPurchase.mockResolvedValue({ action_id: 'act_a' });
    const res = await POST(req(valid));
    expect(res.status).toBe(201);
    expect(m.getPurchaseByIdempotencyKey).not.toHaveBeenCalled();
    expect(m.createPurchase).toHaveBeenCalledWith(m.sql, 'org_1', expect.stringMatching(/^act_/), expect.objectContaining({ idempotency_key: null }));
  });

  it('GET lists purchases (org-scoped)', async () => {
    m.listPurchases.mockResolvedValue([{ action_id: 'act_a' }]);
    const res = await GET(new Request('http://localhost/api/x402/purchases'));
    expect(res.status).toBe(200);
    expect((await res.json()).purchases).toHaveLength(1);
  });

  it('GET forwards provider_id + agent_id filters to the repository', async () => {
    m.listPurchases.mockResolvedValue([]);
    await GET(new Request('http://localhost/api/x402/purchases?provider_id=prov_x&agent_id=agent-1'));
    expect(m.listPurchases).toHaveBeenCalledWith(m.sql, 'org_1', { providerId: 'prov_x', agentId: 'agent-1' });
  });
});
