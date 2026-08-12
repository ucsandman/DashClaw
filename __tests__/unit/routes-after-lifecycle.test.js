/**
 * Two post-response side effects were bare fire-and-forget instead of
 * wrapped in next/server's after() — unlike the neighbouring side effects in
 * the very same handlers, which already use after() correctly:
 *
 *   - POST /api/approvals/[actionId]: fireWebhooksForApproval (SQL SELECT +
 *     HTTP delivery + delivery-log INSERT) was un-awaited outside after().
 *   - POST /api/capabilities/[capabilityId]/invoke: the health_status write
 *     that feeds checkCircuitBreaker was un-awaited outside after().
 *
 * On Vercel the lambda can freeze the instant NextResponse.json(...) returns,
 * silently dropping either write (app/api/actions/route.ts documents the
 * same after()-keeps-the-lambda-alive contract these two now follow).
 *
 * Asserting "after() was called" is not enough — a wrapper written as
 * `after(() => { p.catch(...); })` (block body, no return) is still called
 * but hands after() an undefined promise, which is exactly as useless as no
 * after() at all. Each test below captures the after() callback, invokes it,
 * and proves the returned value is a live promise that settles only once the
 * underlying side effect actually settles.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRequest } from '../helpers.js';

const m = vi.hoisted(() => ({
  afterCalls: [],
  sql: Object.assign(vi.fn(async () => []), { query: vi.fn(async () => []) }),
  // approvals route deps
  getOrgRole: vi.fn(() => 'admin'),
  getUserId: vi.fn(() => 'user_1'),
  logActivity: vi.fn(async () => undefined),
  publishOrgEvent: vi.fn(async () => undefined),
  recordApproval: vi.fn(),
  getActionStatus: vi.fn(),
  getActionSummary: vi.fn(),
  expireOverdueApproval: vi.fn(),
  clearApprovalNotifications: vi.fn(async () => undefined),
  ingestApprovalAdjudication: vi.fn(async () => undefined),
  fireWebhooksForApproval: vi.fn(),
  // capabilities invoke route deps
  evaluateGuard: vi.fn(),
  fireApprovalSurfaces: vi.fn(),
  createActionRecord: vi.fn(),
  createBlockedActionRecord: vi.fn(),
  prepareCapabilityInvocation: vi.fn(),
  executeCapabilityInvocation: vi.fn(),
  checkCircuitBreaker: vi.fn(),
  updateCapability: vi.fn(),
  evaluateAccess: vi.fn(),
  resolveAgentIdentity: vi.fn(),
}));

// Capture the deferred callbacks instead of running them — the point of
// after() is that the side effect does NOT run before the response, so a
// mock that auto-invokes on registration (as some other test files do)
// can't tell "wrapped in after()" apart from "fired directly".
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, after: (cb) => { m.afterCalls.push(cb); } };
});

vi.mock('@/lib/db.js', () => ({ getSql: () => m.sql }));
vi.mock('@/lib/org.js', () => ({
  getOrgId: () => 'org_test',
  getOrgRole: (...a) => m.getOrgRole(...a),
  getUserId: (...a) => m.getUserId(...a),
}));
vi.mock('@/lib/audit.js', () => ({ logActivity: (...a) => m.logActivity(...a) }));
vi.mock('@/lib/events.js', () => ({
  EVENTS: { ACTION_UPDATED: 'action.updated' },
  publishOrgEvent: (...a) => m.publishOrgEvent(...a),
}));
vi.mock('@/lib/security.js', () => ({ redactAny: (v) => v }));
vi.mock('@/lib/repositories/actions.repository.js', async (importOriginal) => {
  // Partial mock: keep the real pure helpers (isApprovalOverdue) so the
  // approvals route's expiry check runs genuine logic against our fixture row.
  const actual = await importOriginal();
  return {
    ...actual,
    recordApproval: (...a) => m.recordApproval(...a),
    getActionStatus: (...a) => m.getActionStatus(...a),
    getActionSummary: (...a) => m.getActionSummary(...a),
    expireOverdueApproval: (...a) => m.expireOverdueApproval(...a),
    createActionRecord: (...a) => m.createActionRecord(...a),
    createBlockedActionRecord: (...a) => m.createBlockedActionRecord(...a),
  };
});
vi.mock('@/lib/webhooks.js', () => ({ fireWebhooksForApproval: (...a) => m.fireWebhooksForApproval(...a) }));
vi.mock('@/lib/approvalNotifications.js', () => ({ clearApprovalNotifications: (...a) => m.clearApprovalNotifications(...a) }));
vi.mock('@/lib/guard/calibration-feedback.js', () => ({ ingestApprovalAdjudication: (...a) => m.ingestApprovalAdjudication(...a) }));
vi.mock('@/lib/guard.js', () => ({ evaluateGuard: (...a) => m.evaluateGuard(...a) }));
vi.mock('@/lib/approvalSurfaces.js', () => ({ fireApprovalSurfaces: (...a) => m.fireApprovalSurfaces(...a) }));
vi.mock('@/lib/capability-runtime.js', () => ({
  prepareCapabilityInvocation: (...a) => m.prepareCapabilityInvocation(...a),
  executeCapabilityInvocation: (...a) => m.executeCapabilityInvocation(...a),
}));
vi.mock('@/lib/capability-health.js', () => ({ checkCircuitBreaker: (...a) => m.checkCircuitBreaker(...a) }));
vi.mock('@/lib/repositories/capabilities.repository.js', () => ({ updateCapability: (...a) => m.updateCapability(...a) }));
vi.mock('@/lib/repositories/capability-access.repository.js', () => ({ evaluateAccess: (...a) => m.evaluateAccess(...a) }));
vi.mock('@/lib/identity-resolution.js', () => ({ resolveAgentIdentity: (...a) => m.resolveAgentIdentity(...a) }));

const { POST: approvalsPOST } = await import('@/api/approvals/[actionId]/route.js');
const { POST: invokePOST } = await import('@/api/capabilities/[capabilityId]/invoke/route.js');

// Runs every captured after() callback once, returns the return value that
// corresponds to invoking `probe` (the mock the callback is expected to
// reach), by watching that mock's call count around each invocation.
function flushAfterAndCapture(probe) {
  let result;
  for (const cb of m.afterCalls) {
    const before = probe.mock.calls.length;
    const ret = cb();
    if (probe.mock.calls.length > before) result = ret;
  }
  m.afterCalls.length = 0;
  return result;
}

beforeEach(() => {
  vi.clearAllMocks();
  m.afterCalls.length = 0;
  m.sql.mockImplementation(async () => []);
  m.sql.query.mockImplementation(async () => []);
  m.getOrgRole.mockReturnValue('admin');
  m.getUserId.mockReturnValue('user_1');
});

describe('POST /api/approvals/[actionId] — webhook dispatch deferred via after()', () => {
  it('does not fire the webhook before the response, and after() receives a promise tied to delivery', async () => {
    const action = {
      status: 'pending_approval',
      created_by: 'someone_else',
      agent_id: 'agt_1',
      approval_expires_at: new Date(Date.now() + 60_000).toISOString(),
    };
    m.getActionStatus.mockResolvedValue(action);
    m.recordApproval.mockResolvedValue({ action_id: 'act_123', status: 'running' });
    m.getActionSummary.mockResolvedValue({ action_id: 'act_123', agent_id: 'agt_1', risk_score: 10 });

    let releaseWebhook;
    const gate = new Promise((resolve) => { releaseWebhook = resolve; });
    m.fireWebhooksForApproval.mockImplementation(() => gate);

    const res = await approvalsPOST(
      makeRequest('http://localhost:3000/api/approvals/act_123', {
        headers: { 'x-api-key': 'oc_live_test' },
        body: { decision: 'allow' },
      }),
      { params: Promise.resolve({ actionId: 'act_123' }) },
    );
    expect(res.status).toBe(200);

    // The bug: fireWebhooksForApproval was called synchronously inside the
    // handler, un-awaited. Fixed, it must not run until an after() callback
    // is invoked.
    expect(m.fireWebhooksForApproval).not.toHaveBeenCalled();
    expect(m.afterCalls.length).toBeGreaterThan(0);

    const returned = flushAfterAndCapture(m.fireWebhooksForApproval);
    expect(m.fireWebhooksForApproval).toHaveBeenCalledWith(
      'org_test',
      'approval_granted',
      expect.objectContaining({ action_id: 'act_123', status: 'running' }),
      m.sql,
    );

    // after() must have been handed a real promise (not undefined) that only
    // settles once delivery actually settles.
    expect(returned).toBeTruthy();
    expect(typeof returned.then).toBe('function');
    let settled = false;
    returned.then(() => { settled = true; });
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);

    releaseWebhook();
    await returned;
    expect(settled).toBe(true);
  });
});

describe('POST /api/capabilities/[capabilityId]/invoke — health_status write deferred via after()', () => {
  beforeEach(() => {
    m.prepareCapabilityInvocation.mockResolvedValue({
      capability: { capability_id: 'cap_1', name: 'Research', slug: 'research', risk_level: 'low', requires_approval: false },
      schema: { method: 'POST' },
      endpoint: 'https://api.example.com/run',
      authHeaders: {},
    });
    m.evaluateGuard.mockResolvedValue({ decision: 'allow', risk_score: 10 });
    m.checkCircuitBreaker.mockResolvedValue({ open: false });
    m.resolveAgentIdentity.mockResolvedValue({ agent_id: 'agt_x', verification_status: 'unverified', verified: false });
    m.evaluateAccess.mockResolvedValue({ access: 'allow', rule: null });
    m.createActionRecord.mockResolvedValue({ action_id: 'act_1' });
    m.executeCapabilityInvocation.mockResolvedValue({ success: true, data: { ok: true }, elapsed_ms: 5 });
  });

  it('does not write health_status before the response, and after() receives a promise tied to the write', async () => {
    let releaseUpdate;
    const gate = new Promise((resolve) => { releaseUpdate = resolve; });
    m.updateCapability.mockImplementation(() => gate);

    const res = await invokePOST(
      makeRequest('http://localhost/api/capabilities/cap_1/invoke', { body: { agent_id: 'agt_x' } }),
      { params: Promise.resolve({ capabilityId: 'cap_1' }) },
    );
    expect(res.status).toBe(200);

    // The bug: updateCapability was called synchronously inside the handler,
    // un-awaited. Fixed, it must not run until an after() callback is invoked.
    expect(m.updateCapability).not.toHaveBeenCalled();
    expect(m.afterCalls.length).toBeGreaterThan(0);

    const returned = flushAfterAndCapture(m.updateCapability);
    expect(m.updateCapability).toHaveBeenCalledWith(m.sql, 'org_test', 'cap_1', { health_status: 'healthy' });

    expect(returned).toBeTruthy();
    expect(typeof returned.then).toBe('function');
    let settled = false;
    returned.then(() => { settled = true; });
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);

    releaseUpdate();
    await returned;
    expect(settled).toBe(true);
  });
});
