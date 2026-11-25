/**
 * A require_approval verdict must leave the operator something to answer.
 *
 * POST /api/guard without ?record=true used to evaluate and do nothing else. A
 * caller that never followed up with POST /api/actions left an ask no human
 * could answer: no pending_approval row, no Telegram / Discord prompt, nothing
 * on /approvals. The guard call now opens the approval request itself and
 * returns its action_id. A repeat of the same ask while that request is open
 * gets the same request back instead of a second prompt, and ?record=false
 * keeps a call evaluate-only.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRequest } from '../helpers.js';
import { computeActContentHash } from '@/lib/act-content-hash';

const {
  mockSql, mockValidateGuardInput, mockEvaluateGuard, mockListGuardDecisions,
  mockGetPriorDecision, mockCreateActionRecord, mockGetActionByKey, mockGetOrgHalt,
  mockPublishOrgEvent, mockFireApprovalSurfaces, mockFireActionAlert, mockFindOpenRequest, afterCalls,
} = vi.hoisted(() => ({
  mockSql: Object.assign(vi.fn(async () => []), { query: vi.fn(async () => []) }),
  mockValidateGuardInput: vi.fn(),
  mockEvaluateGuard: vi.fn(),
  mockListGuardDecisions: vi.fn(),
  mockGetPriorDecision: vi.fn(),
  mockCreateActionRecord: vi.fn(),
  mockGetActionByKey: vi.fn(),
  mockGetOrgHalt: vi.fn(),
  mockPublishOrgEvent: vi.fn(),
  mockFireApprovalSurfaces: vi.fn(),
  mockFireActionAlert: vi.fn(async () => undefined),
  mockFindOpenRequest: vi.fn(),
  afterCalls: [],
}));

// next/server's after() throws "outside a request scope" in unit tests.
// Capture the deferred callbacks so a test can flush them explicitly.
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, after: (cb) => { afterCalls.push(cb); } };
});

vi.mock('@/lib/db.js', () => ({ getSql: () => mockSql }));
vi.mock('@/lib/validate', () => ({ validateGuardInput: mockValidateGuardInput, boundedIdField: (v) => (typeof v === 'string' && v.length > 0 && v.length <= 200 ? v : null), enforcementModeField: (v) => (typeof v === 'string' && ['enforce', 'observe', 'warn', 'off'].includes(v.trim().toLowerCase()) ? v.trim().toLowerCase() : null) }));
vi.mock('@/lib/guard', () => ({ evaluateGuard: mockEvaluateGuard, getOrgHaltState: mockGetOrgHalt }));
vi.mock('@/lib/repositories/guard.repository.js', () => ({
  listGuardDecisions: mockListGuardDecisions,
  getGuardDecisionByIdempotencyKey: mockGetPriorDecision,
}));
vi.mock('@/lib/repositories/actions.repository.js', () => ({
  createActionRecord: mockCreateActionRecord,
  getActionByIdempotencyKey: mockGetActionByKey,
  getActionIdByIdempotencyKey: mockGetActionByKey,
}));
vi.mock('@/lib/repositories/actions.repository.approvals', () => ({ findOpenApprovalRequest: mockFindOpenRequest }));
vi.mock('@/lib/repositories/hosted-workspace.repository.js', () => ({ incrementTrialActionCount: vi.fn(async () => undefined) }));
vi.mock('@/lib/events.js', () => ({
  EVENTS: { ACTION_CREATED: 'action.created', GUARD_DECISION_CREATED: 'guard.decision' },
  publishOrgEvent: mockPublishOrgEvent,
}));
vi.mock('@/lib/repositories/jti-replay.repository.js', () => ({
  checkAndRecord: vi.fn(async () => 'unique'),
  sweep: vi.fn(async () => 0),
}));
vi.mock('@/lib/approvalSurfaces', () => ({ fireApprovalSurfaces: mockFireApprovalSurfaces }));
vi.mock('@/lib/actionAlerts', () => ({ fireActionAlert: mockFireActionAlert }));

import { POST } from '@/api/guard/route.js';

const ASK = { action_type: 'outreach_send', declared_goal: 'Send the follow-up email', agent_id: 'agt_1' };
const NEEDS_APPROVAL = {
  decision: 'require_approval', decision_id: 'gd_1', reasons: [], warnings: [],
  matched_policies: ['pol_1'], reason: 'outreach needs a human', risk_score: 80,
};
const ALLOW = { decision: 'allow', decision_id: 'gd_2', reasons: [], warnings: [], matched_policies: [], risk_score: 10 };
// The route adds fields to the verdict object it gets back, so every test
// hands it a fresh copy.

function post(data, query = '') {
  mockValidateGuardInput.mockReturnValue({ valid: true, data: { ...data }, errors: [] });
  return POST(makeRequest(`http://localhost/api/guard${query}`, {
    headers: { 'x-org-id': 'org_1' },
    body: data,
  }));
}

async function flushAfter() {
  for (const cb of afterCalls) await cb();
}

describe('/api/guard: an approval ask opens a request a human can answer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    afterCalls.length = 0;
    process.env.DATABASE_URL = 'postgres://unit-test';
    process.env.DASHCLAW_MODE = 'cloud';
    mockSql.mockImplementation(async () => []);
    mockSql.query.mockImplementation(async () => []);
    mockGetPriorDecision.mockResolvedValue(null);
    mockGetActionByKey.mockResolvedValue(null);
    mockGetOrgHalt.mockResolvedValue(null);
    mockFindOpenRequest.mockResolvedValue(null);
    mockCreateActionRecord.mockImplementation(async (_sql, payload) => ({ action_id: payload.action_id, status: payload.actionStatus }));
  });

  it('opens a pending approval request and returns its id when the caller did not ask to record', async () => {
    mockEvaluateGuard.mockImplementation(async () => ({ ...NEEDS_APPROVAL }));

    const body = await (await post(ASK)).json();

    expect(body.decision).toBe('require_approval');
    expect(body.recorded).toBe(true);
    expect(body.action_id).toMatch(/^act_/);
    expect(mockCreateActionRecord).toHaveBeenCalledTimes(1);
    expect(mockCreateActionRecord.mock.calls[0][1]).toMatchObject({
      orgId: 'org_1', action_id: body.action_id, actionStatus: 'pending_approval',
    });
  });

  it('prompts the operator for the request it opened', async () => {
    mockEvaluateGuard.mockImplementation(async () => ({ ...NEEDS_APPROVAL }));

    const body = await (await post(ASK)).json();
    await flushAfter();

    expect(mockFireApprovalSurfaces).toHaveBeenCalledWith(
      expect.objectContaining({ action_id: body.action_id, status: 'pending_approval' }),
      mockSql,
      'org_1',
      expect.objectContaining({ matched_policies: ['pol_1'] }),
    );
  });

  it('stays evaluate-only for an allow verdict', async () => {
    mockEvaluateGuard.mockImplementation(async () => ({ ...ALLOW }));

    const body = await (await post(ASK)).json();

    expect(body.decision).toBe('allow');
    expect(body).not.toHaveProperty('recorded');
    expect(body).not.toHaveProperty('action_id');
    expect(mockCreateActionRecord).not.toHaveBeenCalled();
  });

  it('stays evaluate-only when the caller passes ?record=false', async () => {
    mockEvaluateGuard.mockImplementation(async () => ({ ...NEEDS_APPROVAL }));

    const body = await (await post(ASK, '?record=false')).json();

    expect(body.decision).toBe('require_approval');
    expect(body).not.toHaveProperty('recorded');
    expect(body).not.toHaveProperty('action_id');
    expect(mockFindOpenRequest).not.toHaveBeenCalled();
    expect(mockCreateActionRecord).not.toHaveBeenCalled();
  });

  it('leaves the response unchanged for an ask that names no agent', async () => {
    mockEvaluateGuard.mockImplementation(async () => ({ ...NEEDS_APPROVAL }));

    const body = await (await post({ action_type: 'rm_rf', declared_goal: 'Automated probe: purge project folder' })).json();

    expect(body.decision).toBe('require_approval');
    expect(body).not.toHaveProperty('recorded');
    expect(body).not.toHaveProperty('action_id');
    expect(mockCreateActionRecord).not.toHaveBeenCalled();
  });

  it('opens no request for a self-test ask, so a test agent never prompts a human', async () => {
    mockEvaluateGuard.mockImplementation(async () => ({ ...NEEDS_APPROVAL }));

    const body = await (await post({ ...ASK, agent_id: 'policy-verify', self_test: true })).json();

    expect(body.decision).toBe('require_approval');
    expect(body).not.toHaveProperty('recorded');
    expect(mockFindOpenRequest).not.toHaveBeenCalled();
    expect(mockCreateActionRecord).not.toHaveBeenCalled();
  });

  it('returns the request that is already open for the same ask and sends no second prompt', async () => {
    mockEvaluateGuard.mockImplementation(async () => ({ ...NEEDS_APPROVAL }));
    mockFindOpenRequest.mockResolvedValue({ action_id: 'act_open1', status: 'pending_approval' });

    const body = await (await post(ASK)).json();
    await flushAfter();

    expect(body.recorded).toBe(true);
    expect(body.action_id).toBe('act_open1');
    expect(mockFindOpenRequest).toHaveBeenCalledWith(mockSql, 'org_1', {
      agentId: 'agt_1',
      actionType: 'outreach_send',
      declaredGoal: 'Send the follow-up email',
      actContentHash: null,
      createdBy: null,
    });
    expect(mockCreateActionRecord).not.toHaveBeenCalled();
    expect(mockFireApprovalSurfaces).not.toHaveBeenCalled();
    expect(mockFireActionAlert).not.toHaveBeenCalled();
  });

  it('matches an open request on the act as well, so a different command is a different ask', async () => {
    mockEvaluateGuard.mockImplementation(async () => ({ ...NEEDS_APPROVAL }));
    const act = { kind: 'shell', command: 'git push --force origin main' };

    await post({ ...ASK, act });

    const expected = computeActContentHash(act);
    expect(expected).toEqual(expect.any(String));
    expect(mockFindOpenRequest.mock.calls[0][2].actContentHash).toBe(expected);
  });

  it('does not look for an open request on the ?record=true path', async () => {
    mockEvaluateGuard.mockImplementation(async () => ({ ...NEEDS_APPROVAL }));
    mockFindOpenRequest.mockResolvedValue({ action_id: 'act_open1', status: 'pending_approval' });

    const body = await (await post(ASK, '?record=true')).json();

    expect(mockFindOpenRequest).not.toHaveBeenCalled();
    expect(mockCreateActionRecord).toHaveBeenCalledTimes(1);
    expect(body.action_id).not.toBe('act_open1');
  });

  it('answers a keyed retry of the ask with the request the first call opened', async () => {
    const key = 'a'.repeat(64);
    mockGetPriorDecision.mockResolvedValue({
      id: 'gd_prior1',
      decision: 'require_approval',
      reason: 'outreach needs a human',
      risk_score: 80,
      matched_policies: '["pol_1"]',
      verification_status: 'unverified',
      agent_id: 'agt_1',
      agent_name: null,
      created_at: '2026-06-12T10:00:00.000Z',
      context: JSON.stringify({ ...ASK, act_status: 'not_applicable', verification_status: 'unverified' }),
    });
    mockGetActionByKey.mockResolvedValue({ action_id: 'act_open1' });

    const body = await (await post({ ...ASK, idempotency_key: key })).json();

    expect(body.idempotent_replay).toBe(true);
    expect(body.decision_id).toBe('gd_prior1');
    expect(body.recorded).toBe(true);
    expect(body.action_id).toBe('act_open1');
    expect(mockEvaluateGuard).not.toHaveBeenCalled();
    expect(mockCreateActionRecord).not.toHaveBeenCalled();
  });
});
