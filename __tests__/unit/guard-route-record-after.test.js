/**
 * ?record=true side effects must be scheduled via next/server after(), not
 * fired-and-forgotten mid-request.
 *
 * On Vercel the function can freeze the moment the response returns; a bare
 * `void promise` / un-awaited Promise.all drops the meter increment (a
 * billing/quota undercount that never self-heals) and the Approvals
 * event. POST /api/actions already wraps the identical side effects in
 * after() — this pins the guard route's record path to the same contract.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRequest } from '../helpers.js';

const {
  mockSql, mockValidateGuardInput, mockEvaluateGuard, mockListGuardDecisions,
  mockGetPriorDecision, mockCreateActionRecord, mockGetActionByKey, mockGetOrgHalt,
  mockPublishOrgEvent, afterCalls,
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
  getActionByIdempotencyKey: mockGetActionByKey,
}));
vi.mock('@/lib/repositories/hosted-workspace.repository.js', () => ({ incrementTrialActionCount: vi.fn(async () => undefined) }));
vi.mock('@/lib/events.js', () => ({
  EVENTS: { ACTION_CREATED: 'action.created', GUARD_DECISION_CREATED: 'guard.decision' },
  publishOrgEvent: mockPublishOrgEvent,
}));
vi.mock('@/lib/repositories/jti-replay.repository.js', () => ({
  checkAndRecord: vi.fn(async () => 'unique'),
  sweep: vi.fn(async () => 0),
}));

import { POST } from '@/api/guard/route.js';

function post(data) {
  mockValidateGuardInput.mockReturnValue({ valid: true, data: { ...data }, errors: [] });
  return POST(makeRequest('http://localhost/api/guard?record=true', {
    headers: { 'x-org-id': 'org_1' },
    body: data,
  }));
}

describe('/api/guard?record=true side-effect scheduling', () => {
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
    mockEvaluateGuard.mockResolvedValue({ decision: 'allow', reasons: [], warnings: [], matched_policies: [], risk_score: 10 });
    mockCreateActionRecord.mockResolvedValue({ action_id: 'act_new1' });
  });

  it('defers meter increment and org event via after() instead of firing mid-request', async () => {
    const res = await post({ action_type: 'deploy', declared_goal: 'ship', agent_id: 'agt_1' });
    const body = await res.json();
    expect(body.recorded).toBe(true);

    // The side effects must be scheduled post-response, not already fired.
    expect(afterCalls.length).toBeGreaterThan(0);
    expect(mockPublishOrgEvent).not.toHaveBeenCalled();

    for (const cb of afterCalls) await cb();

    expect(mockPublishOrgEvent).toHaveBeenCalledWith('action.created', expect.objectContaining({ orgId: 'org_1' }));
  });
});
