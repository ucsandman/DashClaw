/**
 * ?record=true on a BLOCK verdict must create the blocked action record
 * in-request, reusing the guard evaluation that already ran.
 *
 * Regression (2026-08-06): the record path answered `recorded: false` on
 * blocks, so the hook fell back to POST /api/actions — whose unconditional
 * re-evaluation wrote a SECOND guard_decisions row. Every block appeared
 * twice in the Decisions Ledger (identical goal, ~1s apart) and doubled the
 * block counts feeding signals/posture.
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

const BLOCK_DECISION = {
  decision: 'block',
  decision_id: 'act_gd_0123456789abcdef',
  reasons: ['Block mass-destructive commands'],
  matched_policies: ['gp_test1'],
  risk_score: 100,
};

function post(data) {
  mockValidateGuardInput.mockReturnValue({ valid: true, data: { ...data }, errors: [] });
  return POST(makeRequest('http://localhost/api/guard?record=true', {
    headers: { 'x-org-id': 'org_1' },
    body: data,
  }));
}

describe('/api/guard?record=true on a block verdict', () => {
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
    mockEvaluateGuard.mockResolvedValue({ ...BLOCK_DECISION });
    mockCreateBlockedActionRecord.mockImplementation(async (_sql, payload) => ({
      action_id: payload.action_id,
      status: 'blocked',
    }));
  });

  it('records the blocked action in-request and reuses the evaluation', async () => {
    const res = await post({ action_type: 'security', declared_goal: 'rm -rf /', agent_id: 'agt_1' });
    const body = await res.json();

    expect(body.decision).toBe('block');
    expect(body.recorded).toBe(true);
    // action_id must be the blocked action row, not the decision-id alias.
    expect(body.action_id).toMatch(/^act_/);
    expect(body.action_id).not.toBe(BLOCK_DECISION.decision_id);

    // Exactly ONE evaluation — the whole point of the fix. The blocked record
    // is built FROM that evaluation, never from a second one.
    expect(mockEvaluateGuard).toHaveBeenCalledTimes(1);
    expect(mockCreateBlockedActionRecord).toHaveBeenCalledTimes(1);
    const payload = mockCreateBlockedActionRecord.mock.calls[0][1];
    expect(payload.guardDecision.decision_id).toBe(BLOCK_DECISION.decision_id);
    expect(payload.riskScore).toBe(100);
    // The record links back to the originating decision row.
    expect(payload.data.guard_decision_id).toBe(BLOCK_DECISION.decision_id);
    // The running/pending insert must not also fire.
    expect(mockCreateActionRecord).not.toHaveBeenCalled();
  });

  it('defers the org event and blocked alert via after()', async () => {
    await post({ action_type: 'security', declared_goal: 'rm -rf /', agent_id: 'agt_1' });

    expect(afterCalls.length).toBeGreaterThan(0);
    expect(mockPublishOrgEvent).not.toHaveBeenCalled();
    expect(mockFireActionAlert).not.toHaveBeenCalled();

    for (const cb of afterCalls) await cb();

    expect(mockPublishOrgEvent).toHaveBeenCalledWith('action.created', expect.objectContaining({ orgId: 'org_1' }));
    expect(mockFireActionAlert).toHaveBeenCalledWith('blocked', expect.objectContaining({ status: 'blocked' }), mockSql, 'org_1');
  });

  it('still reports recorded:false when agent_id/declared_goal are missing', async () => {
    const res = await post({ action_type: 'security' });
    const body = await res.json();

    expect(body.decision).toBe('block');
    expect(body.recorded).toBe(false);
    expect(mockCreateBlockedActionRecord).not.toHaveBeenCalled();
  });
});
