// Folded execution claim on POST /api/guard?record=true (app/lib/guard/route-claim.ts).
// Mock style copied from guard-containment-record-stamp.test.js; the claim
// authority (authorizeActionExecution) is stubbed so the route's contract can
// be checked without the execution repository.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRequest } from '../helpers.js';

const {
  mockSql, mockValidateGuardInput, mockEvaluateGuard, mockGetPriorDecision,
  mockCreateActionRecord, mockGetActionByKey, mockGetOrgHalt, mockPublishOrgEvent, mockAuthorize,
} = vi.hoisted(() => ({
  mockSql: Object.assign(vi.fn(async () => []), { query: vi.fn(async () => []) }),
  mockValidateGuardInput: vi.fn(),
  mockEvaluateGuard: vi.fn(),
  mockGetPriorDecision: vi.fn(),
  mockCreateActionRecord: vi.fn(),
  mockGetActionByKey: vi.fn(),
  mockGetOrgHalt: vi.fn(),
  mockPublishOrgEvent: vi.fn(),
  mockAuthorize: vi.fn(),
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
vi.mock('@/lib/guard/execution', () => ({ authorizeActionExecution: mockAuthorize }));
vi.mock('@/lib/repositories/guard.repository.js', () => ({
  listGuardDecisions: vi.fn(),
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

import { POST } from '@/api/guard/route.js';
import { requestedAttemptId } from '@/lib/guard/route-claim';

const ATTEMPT = 'attempt-0123456789abcdef';

function post(data, { record = true, userId = 'user_1' } = {}) {
  mockValidateGuardInput.mockReturnValue({ valid: true, data: { ...data }, errors: [] });
  const headers = { 'x-org-id': 'org_1' };
  if (userId) headers['x-user-id'] = userId;
  return POST(makeRequest(`http://localhost/api/guard${record ? '?record=true' : ''}`, { headers, body: data }));
}

const baseAction = { action_type: 'deploy', declared_goal: 'ship', agent_id: 'agt_1' };

describe('/api/guard?record=true — folded execution claim', () => {
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
    mockEvaluateGuard.mockResolvedValue({ decision: 'allow', reasons: [], warnings: [], matched_policies: [], risk_score: 10 });
    mockAuthorize.mockResolvedValue({ execution_claimed_at: '2026-09-06T00:00:00.000Z' });
  });

  it('claims the recorded action in the same request and echoes the claim', async () => {
    const res = await post({ ...baseAction, claim_execution: true, attempt_id: ATTEMPT, act: { kind: 'shell', command: 'echo hi' } });
    const body = await res.json();

    expect(body.recorded).toBe(true);
    expect(body.action_id).toMatch(/^act_/);
    expect(body.claimed).toBe(true);
    expect(body.attempt_id).toBe(ATTEMPT);
    expect(body.claimed_at).toBe('2026-09-06T00:00:00.000Z');
    expect(mockAuthorize).toHaveBeenCalledTimes(1);
    const [, input] = mockAuthorize.mock.calls[0];
    // The claim is bound to the action this very request recorded.
    expect(input).toMatchObject({
      orgId: 'org_1', actionId: body.action_id, principalId: 'user_1', attemptId: ATTEMPT,
      act: { kind: 'shell', command: 'echo hi' },
      identity: { agent_id: 'agt_1', verified: false, verification_status: 'unverified' },
      // the verdict this request just computed rides along, so the claim does not re-evaluate
      freshDecision: { decision: 'allow', degraded: false, containment: null },
    });
    expect(res.headers.get('Server-Timing')).toMatch(/claim;dur=\d+/);
  });

  it('also folds the claim for a warn verdict', async () => {
    mockEvaluateGuard.mockResolvedValue({ decision: 'warn', reasons: ['careful'], warnings: ['careful'], matched_policies: [], risk_score: 40 });
    const body = await (await post({ ...baseAction, claim_execution: true, attempt_id: ATTEMPT })).json();
    expect(body.claimed).toBe(true);
    expect(mockAuthorize).toHaveBeenCalledTimes(1);
  });

  it('answers claimed:false with the PATCH conflict code when the claim is refused', async () => {
    mockAuthorize.mockResolvedValue(null);
    const body = await (await post({ ...baseAction, claim_execution: true, attempt_id: ATTEMPT })).json();
    expect(body.recorded).toBe(true);
    expect(body.claimed).toBe(false);
    expect(body.claim_error).toBe('EXECUTION_CLAIM_CONFLICT');
    expect(body.attempt_id).toBe(ATTEMPT);
  });

  it('leaves the response byte-compatible when the body does not ask for a claim', async () => {
    const body = await (await post(baseAction)).json();
    expect(body.recorded).toBe(true);
    expect('claimed' in body).toBe(false);
    expect('attempt_id' in body).toBe(false);
    expect(mockAuthorize).not.toHaveBeenCalled();
  });

  it('does not claim a verdict the hook claims later or never (require_approval, block)', async () => {
    for (const decision of ['require_approval', 'block']) {
      mockAuthorize.mockClear();
      mockEvaluateGuard.mockResolvedValue({ decision, reasons: ['policy'], warnings: [], matched_policies: ['p1'], risk_score: 90 });
      const body = await (await post({ ...baseAction, claim_execution: true, attempt_id: ATTEMPT })).json();
      expect('claimed' in body).toBe(false);
      expect(mockAuthorize).not.toHaveBeenCalled();
    }
  });

  it('ignores a malformed attempt_id and a claim without ?record=true', async () => {
    let body = await (await post({ ...baseAction, claim_execution: true, attempt_id: 'short' })).json();
    expect('claimed' in body).toBe(false);
    body = await (await post({ ...baseAction, claim_execution: true, attempt_id: ATTEMPT }, { record: false })).json();
    expect('claimed' in body).toBe(false);
    expect(mockAuthorize).not.toHaveBeenCalled();
  });

  it('falls back to the PATCH path (no claimed key) when no principal is on the request', async () => {
    const body = await (await post({ ...baseAction, claim_execution: true, attempt_id: ATTEMPT }, { userId: null })).json();
    expect(body.recorded).toBe(true);
    expect('claimed' in body).toBe(false);
    expect(mockAuthorize).not.toHaveBeenCalled();
  });

  it('drops the claim keys, never the record, when the claim authority throws', async () => {
    mockAuthorize.mockRejectedValue(new Error('db down'));
    const body = await (await post({ ...baseAction, claim_execution: true, attempt_id: ATTEMPT })).json();
    expect(body.recorded).toBe(true);
    expect(body.action_id).toMatch(/^act_/);
    expect('claimed' in body).toBe(false);
    expect('attempt_id' in body).toBe(false);
  });
});

describe('requestedAttemptId', () => {
  it('accepts only claim_execution:true with a PATCH-shaped attempt_id', () => {
    expect(requestedAttemptId({ claim_execution: true, attempt_id: ATTEMPT })).toBe(ATTEMPT);
    expect(requestedAttemptId({ claim_execution: 'true', attempt_id: ATTEMPT })).toBeNull();
    expect(requestedAttemptId({ claim_execution: true, attempt_id: 'x' })).toBeNull();
    expect(requestedAttemptId({ claim_execution: true })).toBeNull();
    expect(requestedAttemptId(null)).toBeNull();
    expect(requestedAttemptId('str')).toBeNull();
  });
});
