/**
 * Capability invoke — identity-gated access control (D1, trust & failure
 * model ADR). The route must resolve identity through the shared
 * resolveAgentIdentity contract (JWT sub overrides body agent_id) and pass
 * the verification result into evaluateAccess so an unverified caller cannot
 * assume an allow-listed agent_id.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRequest } from '../helpers.js';

const m = vi.hoisted(() => ({
  sql: Object.assign(vi.fn(async () => []), { query: vi.fn(async () => []) }),
  prepare: vi.fn(),
  execute: vi.fn(),
  evaluateGuard: vi.fn(),
  evaluateAccess: vi.fn(),
  checkCircuitBreaker: vi.fn(),
  resolveAgentIdentity: vi.fn(),
  authorizeActionExecution: vi.fn(),
  createActionRecord: vi.fn(),
  createBlockedActionRecord: vi.fn(),
  updateActionOutcome: vi.fn(),
  updateCapability: vi.fn(),
}));

// next/server's after() throws "outside a request scope" in unit tests.
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, after: (cb) => { cb(); } };
});

vi.mock('@/lib/db.js', () => ({ getSql: () => m.sql }));
vi.mock('@/lib/org.js', () => ({ getOrgId: () => 'org_1', getUserId: () => 'usr_actor' }));
vi.mock('@/lib/capability-runtime.js', () => ({
  prepareCapabilityInvocation: m.prepare,
  executeCapabilityInvocation: m.execute,
}));
vi.mock('@/lib/guard.js', () => ({ evaluateGuard: m.evaluateGuard }));
vi.mock('@/lib/guard/execution.js', () => ({ authorizeActionExecution: m.authorizeActionExecution }));
vi.mock('@/lib/approvalSurfaces.js', () => ({ fireApprovalSurfaces: vi.fn() }));
vi.mock('@/lib/repositories/actions.repository.js', () => ({
  createActionRecord: m.createActionRecord,
  createBlockedActionRecord: m.createBlockedActionRecord,
  updateActionOutcome: m.updateActionOutcome,
}));
vi.mock('@/lib/capability-health.js', () => ({ checkCircuitBreaker: m.checkCircuitBreaker }));
vi.mock('@/lib/repositories/capabilities.repository.js', () => ({ updateCapability: m.updateCapability }));
vi.mock('@/lib/repositories/capability-access.repository.js', () => ({ evaluateAccess: m.evaluateAccess }));
vi.mock('@/lib/identity-resolution.js', () => ({ resolveAgentIdentity: m.resolveAgentIdentity }));

import { POST } from '@/api/capabilities/[capabilityId]/invoke/route.js';

function post(body = {}, headers = {}) {
  return POST(
    makeRequest('http://localhost/api/capabilities/cap_1/invoke', { headers, body }),
    { params: Promise.resolve({ capabilityId: 'cap_1' }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  m.prepare.mockResolvedValue({
    capability: { capability_id: 'cap_1', name: 'Research', slug: 'research', risk_level: 'low' },
    schema: { method: 'POST' },
    endpoint: 'https://api.example.com/run',
    authHeaders: {},
  });
  m.evaluateGuard.mockResolvedValue({ decision: 'allow', risk_score: 10 });
  m.checkCircuitBreaker.mockResolvedValue({ open: false });
  m.resolveAgentIdentity.mockResolvedValue({ agent_id: 'agt_x', agent_name: null, verification_status: 'unverified', verified: false });
  m.evaluateAccess.mockResolvedValue({ access: 'allow', rule: null });
  m.execute.mockResolvedValue({ success: true, data: {}, elapsed_ms: 5 });
  m.createActionRecord.mockResolvedValue({ action_id: 'act_1' });
  m.authorizeActionExecution.mockResolvedValue({ action_id: 'act_1', execution_claimed_at: 'now' });
  m.updateActionOutcome.mockResolvedValue({ action_id: 'act_1', status: 'completed' });
  m.updateCapability.mockResolvedValue({});
});

describe('POST /api/capabilities/[capabilityId]/invoke — identity-gated access', () => {
  it('passes the resolved verification state into evaluateAccess (unverified)', async () => {
    await post({ agent_id: 'agt_x' });
    expect(m.resolveAgentIdentity).toHaveBeenCalled();
    expect(m.evaluateAccess).toHaveBeenCalledWith(m.sql, 'org_1', 'cap_1', 'agt_x', { verified: false });
  });

  it('passes verified:true and the JWT-resolved agent id when identity is verified', async () => {
    m.resolveAgentIdentity.mockResolvedValue({ agent_id: 'verified_sub', agent_name: 'V', verification_status: 'verified', verified: true });
    await post({ agent_id: 'attacker_chosen' });
    expect(m.evaluateAccess).toHaveBeenCalledWith(m.sql, 'org_1', 'cap_1', 'verified_sub', { verified: true });
  });

  it('surfaces the identity downgrade reason on a denied invoke', async () => {
    m.evaluateAccess.mockResolvedValue({
      access: 'deny',
      rule: { rule_id: 'car_o', reason: 'default deny' },
      identity_downgrade: { asserted_access: 'allow', reason: 'allow requires verified identity' },
    });
    const res = await post({ agent_id: 'agt_x' });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('access_denied');
    expect(body.identity_downgrade).toEqual({ asserted_access: 'allow', reason: 'allow requires verified identity' });
  });
});

describe('requires_approval capabilities and evidence', () => {
  it('holds a requires_approval capability on first call — 202 pending_approval, execute not called', async () => {
    m.prepare.mockResolvedValue({
      capability: { capability_id: 'cap_1', name: 'Buy Domain', slug: 'buy-domain', risk_level: 'low', requires_approval: true },
      schema: { method: 'POST' },
      endpoint: 'https://api.example.com/run',
      authHeaders: {},
      settings: {},
    });
    m.evaluateGuard.mockResolvedValue({ decision: 'allow', risk_score: 10, matched_policies: [] });

    const res = await post({ agent_id: 'agt_x' });

    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.error).toBe('pending_approval');
    expect(m.execute).not.toHaveBeenCalled();
  });

  it('executes on retry once the guard grant covers builtin:operator_approval', async () => {
    m.prepare.mockResolvedValue({
      capability: { capability_id: 'cap_1', name: 'Buy Domain', slug: 'buy-domain', risk_level: 'low', requires_approval: true },
      schema: { method: 'POST' },
      endpoint: 'https://api.example.com/run',
      authHeaders: {},
      settings: {},
    });
    m.evaluateGuard.mockResolvedValue({ decision: 'allow', risk_score: 10, matched_policies: ['builtin:operator_approval'] });
    m.execute.mockResolvedValue({ success: true, data: {}, elapsed_ms: 5 });

    const res = await post({ agent_id: 'agt_x' });

    expect(m.execute).toHaveBeenCalled();
    expect(res.status).toBe(200);
  });

  it('resolves ${input.<field>} placeholders into the guard evidence act', async () => {
    m.prepare.mockResolvedValue({
      capability: { capability_id: 'cap_1', name: 'Buy Domain', slug: 'buy-domain', risk_level: 'low' },
      schema: { method: 'POST' },
      endpoint: 'https://api.vercel.com/v1/registrar/domains/${input.domain}/buy',
      authHeaders: {},
      settings: {},
    });
    m.execute.mockResolvedValue({ success: true, data: {}, elapsed_ms: 5 });

    await post({ agent_id: 'agt_x', domain: 'x.com' });

    expect(m.evaluateGuard).toHaveBeenCalledWith(
      'org_1',
      expect.objectContaining({
        act: {
          kind: 'http',
          request: {
            method: 'POST',
            url: 'https://api.vercel.com/v1/registrar/domains/x.com/buy',
            url_digest: expect.stringMatching(/^sha256:[A-Za-z0-9_-]+$/),
            body_excerpt: JSON.stringify({ agent_id: 'agt_x', domain: 'x.com' }),
            body_digest: expect.stringMatching(/^sha256:[A-Za-z0-9_-]+$/),
          },
        },
      }),
      m.sql,
    );
  });

  it('passes prepared.settings through to executeCapabilityInvocation', async () => {
    const settings = { REGISTRAR_TOKEN: 'plain_token' };
    m.prepare.mockResolvedValue({
      capability: { capability_id: 'cap_1', name: 'Buy Domain', slug: 'buy-domain', risk_level: 'low' },
      schema: { method: 'POST' },
      endpoint: 'https://api.example.com/run',
      authHeaders: {},
      settings,
    });
    m.execute.mockResolvedValue({ success: true, data: {}, elapsed_ms: 5 });

    await post({ agent_id: 'agt_x' });

    expect(m.execute).toHaveBeenCalledWith(expect.objectContaining({ settings }));
  });
});
