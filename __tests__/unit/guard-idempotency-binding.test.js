/**
 * The idempotency replay must be bound to the ACT, not to the client's key.
 *
 * Regression (2026-08-11 adversarial review): `idempotency_key` is ordinary
 * client input, and the replay lookup filtered on (org_id, key, 10-minute
 * window) and nothing else. An agent could earn an `allow` for
 * `{kind:'shell',command:'ls'}` and then reuse the key for `rm -rf /` — the
 * cached allow came back with evaluateGuard, the evidence classifier and every
 * org policy skipped, and no decision row written for the second act.
 *
 * Also pins the blocked-action after() callback: it must RETURN the promises
 * it schedules. after() only keeps the invocation alive until the returned
 * value settles, so `void`-discarding them dropped the operator's "your agent
 * was blocked" alert on Vercel.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRequest } from '../helpers.js';

const {
  mockSql, mockValidateGuardInput, mockEvaluateGuard, mockListGuardDecisions,
  mockGetPriorDecision, mockCreateActionRecord, mockCreateBlockedActionRecord,
  mockGetActionByKey, mockGetOrgHalt, mockPublishOrgEvent, mockFireActionAlert,
  afterCalls,
} = vi.hoisted(() => ({
  mockSql: Object.assign(vi.fn(async () => []), { query: vi.fn(async () => []) }),
  mockValidateGuardInput: vi.fn(),
  mockEvaluateGuard: vi.fn(),
  mockListGuardDecisions: vi.fn(),
  mockGetPriorDecision: vi.fn(),
  mockCreateActionRecord: vi.fn(),
  mockCreateBlockedActionRecord: vi.fn(),
  mockGetActionByKey: vi.fn(),
  mockGetOrgHalt: vi.fn(),
  mockPublishOrgEvent: vi.fn(),
  mockFireActionAlert: vi.fn(),
  afterCalls: [],
}));

// next/server's after() throws "outside a request scope" in unit tests.
// Capture the deferred callbacks so the test can flush them explicitly.
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
  createBlockedActionRecord: mockCreateBlockedActionRecord,
  getActionByIdempotencyKey: mockGetActionByKey,
  getActionIdByIdempotencyKey: mockGetActionByKey,
}));
vi.mock('@/lib/repositories/hosted-workspace.repository.js', () => ({ incrementTrialActionCount: vi.fn(async () => undefined) }));
vi.mock('@/lib/actionAlerts.js', () => ({ fireActionAlert: mockFireActionAlert }));
vi.mock('@/lib/events.js', () => ({
  EVENTS: { ACTION_CREATED: 'action.created', GUARD_DECISION_CREATED: 'guard.decision' },
  publishOrgEvent: mockPublishOrgEvent,
}));
vi.mock('@/lib/repositories/jti-replay.repository.js', () => ({
  checkAndRecord: vi.fn(async () => 'unique'),
  sweep: vi.fn(async () => 0),
}));

import { POST } from '@/api/guard/route.js';

const KEY = 'a'.repeat(64);
const LS_ACT = { kind: 'shell', command: 'ls' };
const RM_ACT = { kind: 'shell', command: 'rm -rf /' };

function guardData(extra = {}) {
  return { action_type: 'review', declared_goal: 'inspect the tree', agent_id: 'agt_1', idempotency_key: KEY, ...extra };
}

/**
 * A stored guard_decisions row as the repository returns it. `context` is the
 * request the decision was made about, stamped with the identity fields
 * resolveAgentIdentity writes onto the payload before evaluation (no bearer
 * token here) plus the underscore-prefixed extras evaluate adds.
 */
function priorRow(requestContext, overrides = {}) {
  return {
    id: 'act_gd_prior1',
    decision: 'allow',
    reason: null,
    risk_score: 10,
    matched_policies: '[]',
    verification_status: 'unverified',
    agent_id: 'agt_1',
    agent_name: null,
    created_at: '2026-08-11T10:00:00.000Z',
    context: JSON.stringify({
      ...requestContext,
      verification_status: 'unverified',
      replay_status: 'not_applicable',
      jti: null,
      act_status: 'not_applicable',
      act_hash: null,
      intent_source: 'declared',
      _risk_breakdown: { base: { score: 10 } },
    }),
    ...overrides,
  };
}

function post(data, url = 'http://localhost/api/guard') {
  mockValidateGuardInput.mockReturnValue({ valid: true, data: { ...data }, errors: [] });
  return POST(makeRequest(url, { headers: { 'x-org-id': 'org_1' }, body: data }));
}

describe('/api/guard idempotency replay is bound to the act', () => {
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
    mockEvaluateGuard.mockResolvedValue({ decision: 'block', reasons: ['Block mass-destructive commands'], warnings: [], matched_policies: ['gp_destructive'], risk_score: 100 });
    mockCreateActionRecord.mockResolvedValue({ action_id: 'act_new1' });
    mockCreateBlockedActionRecord.mockImplementation(async (_sql, payload) => ({ action_id: payload.action_id, status: 'blocked' }));
    mockFireActionAlert.mockResolvedValue(undefined);
    mockPublishOrgEvent.mockResolvedValue(undefined);
  });

  it('does NOT replay an allow for a different act — it re-evaluates', async () => {
    // The `ls` allow is cached under KEY; the retry swaps in `rm -rf /`.
    mockGetPriorDecision.mockResolvedValue(priorRow(guardData({ act: LS_ACT })));

    const res = await post(guardData({ act: RM_ACT }));
    const body = await res.json();

    expect(body.idempotent_replay).toBeUndefined();
    expect(body.decision).toBe('block');
    expect(mockEvaluateGuard).toHaveBeenCalledTimes(1);
    expect(mockEvaluateGuard.mock.calls[0][1].act).toEqual(RM_ACT);
  });

  it('still replays when the key AND the act are the same', async () => {
    const request = guardData({ act: LS_ACT });
    mockGetPriorDecision.mockResolvedValue(priorRow(request));

    const res = await post(request);
    const body = await res.json();

    expect(body.idempotent_replay).toBe(true);
    expect(body.decision).toBe('allow');
    expect(body.decision_id).toBe('act_gd_prior1');
    expect(mockEvaluateGuard).not.toHaveBeenCalled();
  });

  it('re-evaluates when a decision-relevant field other than the act changed', async () => {
    // declared_goal steers policy matching and the approval an operator reads.
    mockGetPriorDecision.mockResolvedValue(priorRow(guardData({ act: LS_ACT })));

    const res = await post(guardData({ act: LS_ACT, declared_goal: 'something else entirely' }));
    const body = await res.json();

    expect(body.idempotent_replay).toBeUndefined();
    expect(mockEvaluateGuard).toHaveBeenCalledTimes(1);
  });

  it('re-evaluates when the prior row carries no context to bind against', async () => {
    mockGetPriorDecision.mockResolvedValue({ ...priorRow(guardData({ act: LS_ACT })), context: null });

    const res = await post(guardData({ act: LS_ACT }));
    const body = await res.json();

    expect(body.idempotent_replay).toBeUndefined();
    expect(mockEvaluateGuard).toHaveBeenCalledTimes(1);
  });

  it('replays an http act whose target the server derived from the act url', async () => {
    // evaluate stamps context.target from act.request.url, so the stored
    // context carries a target the live request never sent. The binding has
    // to survive that or every http retry would re-evaluate.
    const act = { kind: 'http', request: { method: 'POST', url: 'https://api.example.com/v1/send' } };
    const request = guardData({ action_type: 'api_call', act });
    mockGetPriorDecision.mockResolvedValue(priorRow({ ...request, target: act.request.url }));

    const res = await post(request);
    const body = await res.json();

    expect(body.idempotent_replay).toBe(true);
    expect(mockEvaluateGuard).not.toHaveBeenCalled();
  });

  it('replays across the declared→derived action_type swap evaluate persists', async () => {
    // On a declared/derived mismatch evaluate rewrites context.action_type and
    // parks the declared value in declared_action_type. The binding unwinds it.
    const request = guardData({ act: RM_ACT });
    mockGetPriorDecision.mockResolvedValue(
      priorRow({ ...request, action_type: 'shell_destructive', declared_action_type: 'review' }),
    );

    const res = await post(request);
    const body = await res.json();

    expect(body.idempotent_replay).toBe(true);
    expect(mockEvaluateGuard).not.toHaveBeenCalled();
  });
});

describe('/api/guard?record=true blocked-action side effects', () => {
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
    mockEvaluateGuard.mockResolvedValue({ decision: 'block', decision_id: 'act_gd_b1', reasons: ['nope'], warnings: [], matched_policies: ['gp_1'], risk_score: 100 });
    mockCreateBlockedActionRecord.mockImplementation(async (_sql, payload) => ({ action_id: payload.action_id, status: 'blocked' }));
    mockPublishOrgEvent.mockResolvedValue(undefined);
  });

  it('the after() callback returns a promise that settles only after the alert does', async () => {
    let releaseAlert;
    mockFireActionAlert.mockReturnValue(new Promise((resolve) => { releaseAlert = resolve; }));

    const res = await post({ action_type: 'security', declared_goal: 'rm -rf /', agent_id: 'agt_1' }, 'http://localhost/api/guard?record=true');
    expect((await res.json()).recorded).toBe(true);
    expect(afterCalls.length).toBe(1);

    const deferred = afterCalls[0]();
    let settled = false;
    Promise.resolve(deferred).then(() => { settled = true; });

    // Vercel may freeze the function the moment this settles — it must not
    // settle while the Discord POST is still in flight.
    await new Promise((r) => setTimeout(r, 0));
    expect(mockFireActionAlert).toHaveBeenCalledWith('blocked', expect.objectContaining({ status: 'blocked' }), mockSql, 'org_1');
    expect(settled).toBe(false);

    releaseAlert();
    await deferred;
    await new Promise((r) => setTimeout(r, 0));
    expect(settled).toBe(true);
  });
});
