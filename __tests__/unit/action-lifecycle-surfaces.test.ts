import { describe, it, expect, vi, beforeEach } from 'vitest';

// Surfaces of the action lifecycle state machine (app/lib/action-lifecycle.ts):
// the PATCH/GET action route, the outcome route, the approval route, the shared
// error handler, and the repository backstops. Route tests mock the repository
// facade; the backstop tests import the real topic modules, which the facade
// mock does not touch.

const h = vi.hoisted(() => ({
  sql: Object.assign(vi.fn(async () => []), { query: vi.fn(async () => []) }),
  getActionStatus: vi.fn(),
  getActionWithRelations: vi.fn(),
  updateActionOutcome: vi.fn(),
  setActionOutcome: vi.fn(),
  getActionOutcome: vi.fn(),
  recordApproval: vi.fn(),
  expireOverdueApproval: vi.fn(),
  getActionSummary: vi.fn(),
  publishOrgEvent: vi.fn(async () => {}),
  maybeFireCostAlert: vi.fn(async () => ({ fired: false })),
}));

vi.mock('../../app/lib/db', () => ({ getSql: () => h.sql }));
vi.mock('../../app/lib/org', () => ({
  getOrgId: () => 'org_test',
  getOrgRole: () => 'admin',
  getUserId: () => 'user_1',
}));
vi.mock('../../app/lib/events', () => ({
  EVENTS: { ACTION_UPDATED: 'action.updated' },
  publishOrgEvent: h.publishOrgEvent,
}));
vi.mock('../../app/lib/security', () => ({
  redactAny: (value: unknown) => value,
  scanSensitiveData: (value: unknown) => ({ clean: true, redacted: value, findings: [] }),
}));
vi.mock('../../app/lib/cost-alerts', () => ({ maybeFireCostAlert: h.maybeFireCostAlert }));
vi.mock('../../app/lib/audit', () => ({ logActivity: vi.fn() }));
vi.mock('../../app/lib/webhooks', () => ({ fireWebhooksForApproval: vi.fn(async () => {}) }));
vi.mock('../../app/lib/approvalNotifications', () => ({ clearApprovalNotifications: vi.fn(async () => {}) }));
vi.mock('next/server', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return { ...mod, after: (fn: () => unknown) => { void fn(); } };
});
vi.mock('../../app/lib/repositories/actions.repository', () => ({
  getActionStatus: h.getActionStatus,
  getActionWithRelations: h.getActionWithRelations,
  updateActionOutcome: h.updateActionOutcome,
  setActionOutcome: h.setActionOutcome,
  getActionOutcome: h.getActionOutcome,
  recordApproval: h.recordApproval,
  expireOverdueApproval: h.expireOverdueApproval,
  getActionSummary: h.getActionSummary,
  isApprovalOverdue: () => false,
  setContainmentAwaiting: vi.fn(),
  stampExecutedDespite: vi.fn(),
}));

import { GET as getAction, PATCH as patchAction } from '../../app/api/actions/[actionId]/route';
import { POST as postOutcome } from '../../app/api/actions/[actionId]/outcome/route';
import { POST as postApproval } from '../../app/api/approvals/[actionId]/route';
import { apiErrorResponse } from '../../app/lib/apiErrors';
import { IllegalTransitionError, nextStates } from '../../app/lib/action-lifecycle';
import { recordApproval, recordBulkApprovals } from '../../app/lib/repositories/actions.repository.approvals';
import { updateActionOutcome } from '../../app/lib/repositories/actions.repository.outcome';

const ctx = { params: Promise.resolve({ actionId: 'act_1' }) };

function req(method: string, body?: unknown) {
  return new Request('http://localhost/api/actions/act_1', {
    method,
    headers: { 'content-type': 'application/json', 'x-org-id': 'org_test' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

type Call = { text: string; values: unknown[] };
const ROW: Record<string, unknown>[] = [{ action_id: 'act_1' }];
function countingSql() {
  const calls: Call[] = [];
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ text: strings.join('?'), values });
    return Promise.resolve(ROW);
  }) as ((strings: TemplateStringsArray, ...values: unknown[]) => Promise<Record<string, unknown>[]>) & {
    query: (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
    calls: Call[];
  };
  sql.query = (text: string, params: unknown[] = []) => {
    calls.push({ text, values: params });
    return Promise.resolve(ROW);
  };
  sql.calls = calls;
  return sql;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.getActionStatus.mockReset();
  h.getActionWithRelations.mockReset();
  h.updateActionOutcome.mockReset();
  h.setActionOutcome.mockReset();
  h.recordApproval.mockReset();
  h.maybeFireCostAlert.mockResolvedValue({ fired: false });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('PATCH /api/actions/[actionId] lifecycle guard', () => {
  it('refuses running -> pending_approval with the 409 contract and never writes', async () => {
    h.getActionStatus.mockResolvedValue({ status: 'running' });
    const res = await patchAction(req('PATCH', { status: 'pending_approval' }), ctx);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: 'illegal_transition',
      message: expect.any(String),
      current: 'running',
      requested: 'pending_approval',
      allowed: [...nextStates('running', 'agent')],
      status: 'running',
    });
    expect(h.updateActionOutcome).not.toHaveBeenCalled();
    expect(h.publishOrgEvent).not.toHaveBeenCalled();
  });

  it.each(['pending', 'blocked'])('refuses running -> %s the same way', async (requested) => {
    h.getActionStatus.mockResolvedValue({ status: 'running' });
    const res = await patchAction(req('PATCH', { status: requested }), ctx);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body).toMatchObject({ error: 'illegal_transition', current: 'running', requested, status: 'running' });
    expect(h.updateActionOutcome).not.toHaveBeenCalled();
  });

  it('refuses the Stop-hook path too (close_if_running does not bypass the table)', async () => {
    h.getActionStatus.mockResolvedValue({ status: 'running' });
    const res = await patchAction(req('PATCH', { status: 'pending_approval', close_if_running: true }), ctx);
    expect(res.status).toBe(409);
    expect(h.updateActionOutcome).not.toHaveBeenCalled();
  });

  it('answers 404 when the pre-check finds no row', async () => {
    h.getActionStatus.mockResolvedValue(null);
    const res = await patchAction(req('PATCH', { status: 'blocked' }), ctx);
    expect(res.status).toBe(404);
  });

  it('a close on a cancelled row answers the contract with allowed [] and the legacy status key', async () => {
    h.updateActionOutcome.mockResolvedValue(null);
    h.getActionStatus.mockResolvedValue({ status: 'cancelled' });
    const res = await patchAction(req('PATCH', { status: 'completed' }), ctx);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: 'illegal_transition',
      message: expect.stringMatching(/final/),
      current: 'cancelled',
      requested: 'completed',
      allowed: [],
      status: 'cancelled',
    });
  });

  it('running -> completed is accepted and the response carries allowed_next []', async () => {
    const updated = { action_id: 'act_1', status: 'completed' };
    h.updateActionOutcome.mockResolvedValue(updated);
    const res = await patchAction(req('PATCH', { status: 'completed' }), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.action).toEqual(updated);
    expect(body.allowed_next).toEqual([]);
    expect(h.updateActionOutcome.mock.calls[0]![4]).toEqual({ gateStatus: 'running', closeSource: 'outcome' });
  });

  it('a progress PATCH (running -> running) is accepted with allowed_next from running', async () => {
    h.updateActionOutcome.mockResolvedValue({ action_id: 'act_1', status: 'running' });
    const res = await patchAction(req('PATCH', { status: 'running' }), ctx);
    expect(res.status).toBe(200);
    expect((await res.json()).allowed_next).toEqual([...nextStates('running')]);
  });

  it('identity on a closed row (completed -> completed) is a no-op 200: no event, no cost alert', async () => {
    h.updateActionOutcome.mockResolvedValue(null);
    h.getActionStatus.mockResolvedValue({ status: 'completed' });
    h.getActionWithRelations.mockResolvedValue({ action: { action_id: 'act_1', status: 'completed' } });
    const res = await patchAction(req('PATCH', { status: 'completed' }), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.action.status).toBe('completed');
    expect(body.allowed_next).toEqual([]);
    expect(h.publishOrgEvent).not.toHaveBeenCalled();
    expect(h.maybeFireCostAlert).not.toHaveBeenCalled();
  });

  it('identity on an awaiting row (pending_approval -> pending_approval) writes nothing and answers 200', async () => {
    h.getActionStatus.mockResolvedValue({ status: 'pending_approval' });
    h.getActionWithRelations.mockResolvedValue({ action: { action_id: 'act_1', status: 'pending_approval' } });
    const res = await patchAction(req('PATCH', { status: 'pending_approval' }), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.action.status).toBe('pending_approval');
    expect(body.allowed_next).toEqual(['running', 'failed', 'expired']);
    expect(h.updateActionOutcome).not.toHaveBeenCalled();
    expect(h.publishOrgEvent).not.toHaveBeenCalled();
  });

  it('a repository backstop throw reaches the caller as the 409 contract', async () => {
    h.updateActionOutcome.mockRejectedValue(new IllegalTransitionError('completed', 'failed', 'agent'));
    const res = await patchAction(req('PATCH', { status: 'failed', error_message: 'x' }), ctx);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'illegal_transition', current: 'completed', requested: 'failed', allowed: [] });
  });
});

describe('GET /api/actions/[actionId] allowed_next', () => {
  it('lists the resolutions an awaiting action is waiting on', async () => {
    h.getActionWithRelations.mockResolvedValue({ action: { action_id: 'act_1', status: 'pending_approval' } });
    const res = await getAction(req('GET'), ctx);
    expect(res.status).toBe(200);
    expect((await res.json()).allowed_next).toEqual(['running', 'failed', 'expired']);
  });

  it('is [] for a terminal row', async () => {
    h.getActionWithRelations.mockResolvedValue({ action: { action_id: 'act_1', status: 'failed' } });
    const res = await getAction(req('GET'), ctx);
    expect((await res.json()).allowed_next).toEqual([]);
  });
});

describe('POST /api/actions/[actionId]/outcome refuses an expired approval', () => {
  it("answers 409 with current_status 'expired' and never records the outcome", async () => {
    h.getActionStatus.mockResolvedValue({ status: 'expired' });
    const res = await postOutcome(req('POST', { status: 'completed' }), ctx);
    expect(res.status).toBe(409);
    expect((await res.json()).current_status).toBe('expired');
    expect(h.setActionOutcome).not.toHaveBeenCalled();
  });
});

describe('POST /api/approvals/[actionId] on a non-pending row', () => {
  it('keeps 400 and its error text, and adds the contract fields', async () => {
    h.getActionStatus.mockResolvedValue({ status: 'running', agent_id: 'agent_1' });
    const res = await postApproval(req('POST', { decision: 'allow' }), ctx);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: 'Action is not pending approval',
      code: 'illegal_transition',
      current: 'running',
      requested: 'running',
      allowed: [...nextStates('running', 'user')],
    });
    expect(h.recordApproval).not.toHaveBeenCalled();
  });

  it('a deny on a denied row names failed as requested and allows nothing', async () => {
    h.getActionStatus.mockResolvedValue({ status: 'failed', agent_id: 'agent_1' });
    const res = await postApproval(req('POST', { decision: 'deny' }), ctx);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'illegal_transition', current: 'failed', requested: 'failed', allowed: [] });
  });

  it('a pending row is approved with the mapped status', async () => {
    h.getActionStatus.mockResolvedValue({ status: 'pending_approval', agent_id: 'agent_1' });
    h.recordApproval.mockResolvedValue({ action_id: 'act_1', status: 'running' });
    h.getActionSummary.mockResolvedValue({ action_id: 'act_1', status: 'running' });
    const res = await postApproval(req('POST', { decision: 'allow' }), ctx);
    expect(res.status).toBe(200);
    expect(h.recordApproval.mock.calls[0]![3]).toMatchObject({ newStatus: 'running', decision: 'allow' });
  });
});

describe('apiErrorResponse maps IllegalTransitionError to the 409 contract', () => {
  it('returns error, message, current, requested and allowed', async () => {
    const res = apiErrorResponse(new IllegalTransitionError('running', 'blocked', 'agent'), 'X');
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: 'illegal_transition',
      message: expect.any(String),
      current: 'running',
      requested: 'blocked',
      allowed: [...nextStates('running', 'agent')],
    });
  });
});

describe('repository backstops throw before any SQL', () => {
  it('recordApproval refuses a newStatus the pending_approval row cannot take', async () => {
    const sql = countingSql();
    await expect(recordApproval(sql, 'org_1', 'act_1', { newStatus: 'completed', errorMessage: null, decision: 'allow', userId: 'u1' }))
      .rejects.toMatchObject({ name: 'IllegalTransitionError', code: 'illegal_transition', current: 'pending_approval', requested: 'completed', allowed: ['running', 'failed'] });
    expect(sql.calls).toHaveLength(0);
  });

  it('recordBulkApprovals refuses the same way', async () => {
    const sql = countingSql();
    await expect(recordBulkApprovals(sql, 'org_1', ['act_1'], { newStatus: 'blocked', errorMessage: null, decision: 'deny', userId: 'u1', safeReasoning: '' }))
      .rejects.toBeInstanceOf(IllegalTransitionError);
    expect(sql.calls).toHaveLength(0);
  });

  it('updateActionOutcome refuses running -> pending_approval on a gated write', async () => {
    const sql = countingSql();
    await expect(updateActionOutcome(sql, 'org_1', 'act_1', { status: 'pending_approval' }, { gateStatus: 'running' }))
      .rejects.toMatchObject({ code: 'illegal_transition', current: 'running', requested: 'pending_approval' });
    expect(sql.calls).toHaveLength(0);
  });

  it('legal inputs pass the backstops and reach SQL', async () => {
    const approve = countingSql();
    await recordApproval(approve, 'org_1', 'act_1', { newStatus: 'running', errorMessage: null, decision: 'allow', userId: 'u1' });
    expect(approve.calls.length).toBeGreaterThan(0);

    const close = countingSql();
    await updateActionOutcome(close, 'org_1', 'act_1', { status: 'completed' }, { gateStatus: 'running', closeSource: 'outcome' });
    expect(close.calls.length).toBeGreaterThan(0);

    // An ungated write (late tokens) is not a transition and is never checked.
    const tokens = countingSql();
    await updateActionOutcome(tokens, 'org_1', 'act_1', { tokens_in: 5 });
    expect(tokens.calls.length).toBeGreaterThan(0);
  });
});
