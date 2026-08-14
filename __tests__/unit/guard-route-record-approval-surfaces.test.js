/**
 * ?record=true must fire the operator approval surfaces (Telegram / Discord /
 * approval_pending webhook) when the verdict is require_approval.
 *
 * Regression: the single-call guard path created the pending_approval row via
 * createActionRecord but never called fireApprovalSurfaces — POST /api/actions
 * did (actions/route.ts), so direct action creation notified operators while
 * the hook's ?record=true path (the production path) stayed silent. Operators
 * saw pending approvals on /approvals with no Telegram/Discord ping.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRequest } from '../helpers.js';

const {
  mockSql, mockValidateGuardInput, mockEvaluateGuard, mockListGuardDecisions,
  mockGetPriorDecision, mockCreateActionRecord, mockGetActionByKey, mockGetOrgHalt,
  mockPublishOrgEvent, mockFireApprovalSurfaces, mockFireActionAlert, afterCalls,
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
  getActionIdByIdempotencyKey: mockGetActionByKey,
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
vi.mock('@/lib/approvalSurfaces', () => ({ fireApprovalSurfaces: mockFireApprovalSurfaces }));
vi.mock('@/lib/actionAlerts', () => ({ fireActionAlert: mockFireActionAlert }));

import { POST } from '@/api/guard/route.js';

function post(data) {
  mockValidateGuardInput.mockReturnValue({ valid: true, data: { ...data }, errors: [] });
  return POST(makeRequest('http://localhost/api/guard?record=true', {
    headers: { 'x-org-id': 'org_1' },
    body: data,
  }));
}

describe('/api/guard?record=true approval surfaces', () => {
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
  });

  it('fires fireApprovalSurfaces + pending_approval alert on a require_approval verdict', async () => {
    mockEvaluateGuard.mockResolvedValue({ decision: 'require_approval', reasons: [], warnings: [], matched_policies: ['pol_1'], reason: 'risk over threshold', risk_score: 80 });
    mockCreateActionRecord.mockResolvedValue({ action_id: 'act_pending1', status: 'pending_approval' });

    const res = await post({ action_type: 'deploy', declared_goal: 'ship', agent_id: 'agt_1' });
    const body = await res.json();
    expect(body.recorded).toBe(true);

    for (const cb of afterCalls) await cb();

    expect(mockFireApprovalSurfaces).toHaveBeenCalledWith(
      expect.objectContaining({ action_id: 'act_pending1', status: 'pending_approval' }),
      mockSql,
      'org_1',
      expect.objectContaining({ matched_policies: ['pol_1'] }),
    );
    expect(mockFireActionAlert).toHaveBeenCalledWith('pending_approval', expect.objectContaining({ action_id: 'act_pending1' }), mockSql, 'org_1');
  });

  it('does not fire approval surfaces on an allow verdict', async () => {
    mockEvaluateGuard.mockResolvedValue({ decision: 'allow', reasons: [], warnings: [], matched_policies: [], risk_score: 10 });
    mockCreateActionRecord.mockResolvedValue({ action_id: 'act_run1', status: 'running' });

    const res = await post({ action_type: 'deploy', declared_goal: 'ship', agent_id: 'agt_1' });
    const body = await res.json();
    expect(body.recorded).toBe(true);

    for (const cb of afterCalls) await cb();

    expect(mockFireApprovalSurfaces).not.toHaveBeenCalled();
    expect(mockFireActionAlert).not.toHaveBeenCalledWith('pending_approval', expect.anything(), expect.anything(), expect.anything());
  });
});
