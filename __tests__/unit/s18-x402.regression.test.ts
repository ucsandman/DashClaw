import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// Spec §18.4 regression coverage for the governed x402 purchases route.
// Three gaps closed here:
//   - Missing provider          → request rejected, nothing recorded
//   - Absent / malformed endpoint_id → request rejected, nothing recorded
//   - Agent-executes-payment boundary → DashClaw RECORDS a post-settlement
//     purchase and NEVER signs / transfers / sends funds on-chain.
//
// The route-mock harness mirrors __tests__/unit/x402-purchases-hardening.route.test.js
// (same hoisted mock object, same module specifiers). The structural-boundary
// assertions mirror __tests__/unit/toolkit-retirement.test.js (fs.readFileSync of
// the real source so the test FAILS if payment-execution code is ever added).

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
  resolveProviderByName: vi.fn(),
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
  resolveProviderByName: m.resolveProviderByName,
  setPurchaseOutcome: vi.fn(),
}));
vi.mock('@/lib/identity-resolution.js', () => ({ resolveAgentIdentity: m.resolveAgentIdentity }));

const { POST } = await import('@/api/x402/purchases/route.js');

function req(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/x402/purchases', {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
}

// A fully-valid purchase body. Individual tests strip / corrupt one field.
const valid = {
  agent_id: 'a1', provider: 'exa', declared_goal: 'research', cost_estimate: 0.05,
  purchase_reason: 'gap', context_gap: 'no current data', expected_value: 'fresh sources',
};

beforeEach(() => {
  vi.clearAllMocks();
  // Happy-path defaults so that, if validation/integrity DID let a bad request
  // through, the downstream record WOULD be created — making "not.toHaveBeenCalled"
  // a real assertion rather than a coincidence of an early-throwing mock.
  m.evaluateGuard.mockResolvedValue({ decision: 'allow', risk_score: 40 });
  m.createActionRecord.mockResolvedValue({ action_id: 'act_a', status: 'running' });
  m.createPurchase.mockResolvedValue({ action_id: 'act_a', execution_status: 'approved' });
  m.deleteActionsByIds.mockResolvedValue([]);
  m.resolveProviderByName.mockResolvedValue({ provider_id: 'prov_exa', name: 'exa' });
  m.resolveAgentIdentity.mockResolvedValue({ agent_id: 'a1', agent_name: null, verification_status: 'unverified', verified: false });
});

// ---------------------------------------------------------------------------
// §18.4 Missing provider
// ---------------------------------------------------------------------------
describe('§18.4 x402 missing provider', () => {
  it('rejects (400) a purchase with NO provider and NO provider_id, recording nothing', async () => {
    const { provider, ...noProvider } = valid; // drop the only provider signal
    void provider;
    const res = await POST(req(noProvider));
    expect(res.status).toBe(400);
    // The validator runs BEFORE any governance/recording work.
    expect(m.evaluateGuard).not.toHaveBeenCalled();
    expect(m.createActionRecord).not.toHaveBeenCalled();
    expect(m.createBlockedActionRecord).not.toHaveBeenCalled();
    expect(m.createPurchase).not.toHaveBeenCalled();
    // The error names the absent required field so the agent can self-correct.
    const body = await res.json();
    expect(JSON.stringify(body)).toMatch(/provider/i);
  });

  it('rejects (400) even when provider is the empty string (treated as absent)', async () => {
    const res = await POST(req({ ...valid, provider: '' }));
    expect(res.status).toBe(400);
    expect(m.evaluateGuard).not.toHaveBeenCalled();
    expect(m.createPurchase).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// §18.4 Invalid endpoint (ABSENT / malformed endpoint_id — the hardening suite
// already covers endpoint-belongs-to-wrong-provider).
// ---------------------------------------------------------------------------
describe('§18.4 x402 invalid endpoint_id', () => {
  it('rejects (400) a malformed (non-string) endpoint_id at validation, recording nothing', async () => {
    const res = await POST(req({ ...valid, provider_id: 'prov_x', endpoint_id: { not: 'a string' } }));
    expect(res.status).toBe(400);
    // Malformed type is caught by validateX402Purchase before guard/recording.
    expect(m.evaluateGuard).not.toHaveBeenCalled();
    expect(m.getEndpoint).not.toHaveBeenCalled();
    expect(m.createActionRecord).not.toHaveBeenCalled();
    expect(m.createPurchase).not.toHaveBeenCalled();
    const body = await res.json();
    expect(JSON.stringify(body)).toMatch(/endpoint_id/i);
  });

  it('rejects an endpoint_id that does not resolve for this org (404), recording nothing', async () => {
    // A well-typed string that names no endpoint must be rejected by the
    // integrity check — the purchase is NOT silently recorded against a phantom
    // endpoint. getProvider stays valid so the rejection is attributable to the
    // endpoint, not the provider.
    m.getProvider.mockResolvedValue({ provider_id: 'prov_x', org_id: 'org_1', name: 'Exa', status: 'active' });
    m.getEndpoint.mockResolvedValue(null);
    const res = await POST(req({ ...valid, provider_id: 'prov_x', endpoint_id: 'pep_ghost' }));
    expect(res.status).toBe(404);
    expect(m.getEndpoint).toHaveBeenCalledWith(m.sql, 'org_1', 'pep_ghost');
    expect(m.createActionRecord).not.toHaveBeenCalled();
    expect(m.createPurchase).not.toHaveBeenCalled();
  });

  it('rejects a disabled endpoint (400), recording nothing', async () => {
    m.getProvider.mockResolvedValue({ provider_id: 'prov_x', org_id: 'org_1', name: 'Exa', status: 'active' });
    m.getEndpoint.mockResolvedValue({ endpoint_id: 'pep_x', org_id: 'org_1', provider_id: 'prov_x', enabled: 0 });
    const res = await POST(req({ ...valid, provider_id: 'prov_x', endpoint_id: 'pep_x' }));
    expect(res.status).toBe(400);
    expect(m.createActionRecord).not.toHaveBeenCalled();
    expect(m.createPurchase).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// §18.4 Governance boundary: DashClaw MUST NEVER execute payment.
// Structural (source-grep) + behavioral (mock-graph) assertions.
// ---------------------------------------------------------------------------
describe('§18.4 x402 governance boundary — DashClaw never executes payment', () => {
  const ROUTE_SRC = readFileSync(path.resolve('app/api/x402/purchases/route.ts'), 'utf8');
  const REPO_SRC = readFileSync(path.resolve('app/lib/repositories/x402.repository.ts'), 'utf8');

  // Payment-execution / wallet-signing surface that must never appear in either
  // the governance route or the purchases repository. These are the concrete
  // primitives an "agent platform" would use; DashClaw is a control plane and
  // records purchases AFTER the agent settles them off-platform.
  const FORBIDDEN_EXECUTION = [
    /\bsignTransaction\b/i,
    /\bsendTransaction\b/i,
    /\bsendRawTransaction\b/i,
    /\bsignAndSendTransaction\b/i,
    /\beth_sendTransaction\b/i,
    /\bsignMessage\b/i,
    /\bprivate[_-]?key\b/i,
    /\bmnemonic\b/i,
    /\bseed[_-]?phrase\b/i,
    /\bwallet\.send\b/i,
    /\btransferFrom\b/i,
    /\.transfer\s*\(/i,
  ];

  // Wallet / chain SDKs that would only be present to MOVE money.
  const FORBIDDEN_IMPORTS = [
    /from\s+['"]ethers['"]/,
    /from\s+['"]viem['"]/,
    /from\s+['"]web3['"]/,
    /from\s+['"]@solana\/web3\.js['"]/,
    /from\s+['"]wagmi['"]/,
    /from\s+['"]x402['"]/,
    /from\s+['"]@coinbase\/[^'"]*['"]/,
    /require\(\s*['"](ethers|viem|web3|@solana\/web3\.js|wagmi)['"]\s*\)/,
  ];

  it.each(FORBIDDEN_EXECUTION)('route source contains no payment-execution primitive: %s', (pat) => {
    expect(ROUTE_SRC).not.toMatch(pat);
  });

  it.each(FORBIDDEN_EXECUTION)('repository source contains no payment-execution primitive: %s', (pat) => {
    expect(REPO_SRC).not.toMatch(pat);
  });

  it.each(FORBIDDEN_IMPORTS)('route imports no wallet/chain SDK: %s', (pat) => {
    expect(ROUTE_SRC).not.toMatch(pat);
  });

  it.each(FORBIDDEN_IMPORTS)('repository imports no wallet/chain SDK: %s', (pat) => {
    expect(REPO_SRC).not.toMatch(pat);
  });

  it('the route documents itself as record-only (never holds creds / executes payment)', () => {
    // Guards the design intent in prose: if someone deletes the boundary comment
    // while adding execution code, this trips alongside the FORBIDDEN_* checks.
    // The phrase "DashClaw never holds wallet credentials or executes payment"
    // wraps across a JSDoc line, so allow any inter-word whitespace/`*` filler.
    expect(ROUTE_SRC).toMatch(/never[\s*]+(holds|execut)/i);
  });

  it('a successful purchase record does NOT depend on any settlement/transfer call', async () => {
    // Behavioral proof of the boundary: with ZERO wallet/chain machinery wired,
    // a governed purchase still records cleanly (201). The route only calls the
    // guard + the two record repositories — there is no settlement step that
    // could fail or be required.
    const res = await POST(req(valid));
    expect(res.status).toBe(201);
    expect(m.createActionRecord).toHaveBeenCalledTimes(1);
    expect(m.createPurchase).toHaveBeenCalledTimes(1);
    // Recording is post-settlement reporting: execution_status is 'approved'
    // (governance verdict), NOT something the route settled on-chain.
    const purchaseData = m.createPurchase.mock.calls[0]?.[3] as Record<string, unknown>;
    expect(purchaseData.execution_status).toBe('approved');
  });

  it('a wallet_reference is recorded only as a redacted identifier — never used to sign/send', async () => {
    // If the route ever STARTED executing payment, the raw wallet reference would
    // need to flow through unmasked. It does not: only the masked tail is stored.
    m.createPurchase.mockImplementation(async (_sql, _org, _id, data) => ({ action_id: 'act_a', ...data }));
    const res = await POST(req({ ...valid, wallet_reference: '0xABCDEF0123456789DEADBEEF' }));
    expect(res.status).toBe(201);
    const stored = m.createPurchase.mock.calls[0]?.[3] as Record<string, unknown>;
    expect(stored.wallet_reference).not.toBe('0xABCDEF0123456789DEADBEEF');
    expect(stored.wallet_reference).not.toContain('DEADBEEF');
    expect(JSON.stringify(await res.json())).not.toContain('0xABCDEF0123456789DEADBEEF');
  });
});
