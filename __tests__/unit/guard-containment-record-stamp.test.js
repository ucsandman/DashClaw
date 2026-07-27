// Containment Verdicts (RFC 2026-07-06, drizzle/0064) — ?record=true stamp.
// Mock style copied from __tests__/unit/guard-route-record-after.test.js:
// evaluateGuard's decision is stubbed directly so recordRunningAction's
// insert payload can be inspected without exercising the full evaluator.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRequest } from '../helpers.js';

const {
  mockSql, mockValidateGuardInput, mockEvaluateGuard, mockGetPriorDecision,
  mockCreateActionRecord, mockGetActionByKey, mockGetOrgHalt, mockPublishOrgEvent,
} = vi.hoisted(() => ({
  mockSql: Object.assign(vi.fn(async () => []), { query: vi.fn(async () => []) }),
  mockValidateGuardInput: vi.fn(),
  mockEvaluateGuard: vi.fn(),
  mockGetPriorDecision: vi.fn(),
  mockCreateActionRecord: vi.fn(),
  mockGetActionByKey: vi.fn(),
  mockGetOrgHalt: vi.fn(),
  mockPublishOrgEvent: vi.fn(),
}));

vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, after: (cb) => { cb(); } };
});

vi.mock('@/lib/db.js', () => ({ getSql: () => mockSql }));
vi.mock('@/lib/validate', () => ({
  validateGuardInput: mockValidateGuardInput,
  boundedIdField: (v) => (typeof v === 'string' && v.length > 0 && v.length <= 200 ? v : null),
  enforcementModeField: (v) => (typeof v === 'string' && ['enforce', 'observe', 'warn', 'off'].includes(v.trim().toLowerCase()) ? v.trim().toLowerCase() : null),
}));
vi.mock('@/lib/guard', () => ({ evaluateGuard: mockEvaluateGuard, getOrgHaltState: mockGetOrgHalt }));
vi.mock('@/lib/repositories/guard.repository.js', () => ({
  listGuardDecisions: vi.fn(),
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

describe('/api/guard?record=true — containment_status stamp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATABASE_URL = 'postgres://unit-test';
    process.env.DASHCLAW_MODE = 'cloud';
    mockSql.mockImplementation(async () => []);
    mockSql.query.mockImplementation(async () => []);
    mockGetPriorDecision.mockResolvedValue(null);
    mockGetActionByKey.mockResolvedValue(null);
    mockGetOrgHalt.mockResolvedValue(null);
    mockCreateActionRecord.mockResolvedValue({ action_id: 'act_new1' });
  });

  it("stamps containment_status: 'contained' on the insert when the decision is allow_contained", async () => {
    mockEvaluateGuard.mockResolvedValue({
      decision: 'allow_contained', reasons: [], warnings: [], matched_policies: [], risk_score: 10,
    });

    const res = await post({ action_type: 'apply', declared_goal: 'edit a file', agent_id: 'agt_1' });
    const body = await res.json();

    expect(body.recorded).toBe(true);
    expect(mockCreateActionRecord).toHaveBeenCalledTimes(1);
    const [, payload] = mockCreateActionRecord.mock.calls[0];
    expect(payload.data.containment_status).toBe('contained');
    expect(payload.actionStatus).toBe('running');
  });

  it('does not stamp containment_status for every other decision (allow)', async () => {
    mockEvaluateGuard.mockResolvedValue({
      decision: 'allow', reasons: [], warnings: [], matched_policies: [], risk_score: 10,
    });

    await post({ action_type: 'deploy', declared_goal: 'ship', agent_id: 'agt_1' });

    expect(mockCreateActionRecord).toHaveBeenCalledTimes(1);
    const [, payload] = mockCreateActionRecord.mock.calls[0];
    expect(payload.data.containment_status).toBeUndefined();
  });
});
