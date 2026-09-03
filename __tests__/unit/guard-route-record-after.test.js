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

/**
 * Stated confidence at guard time: the agent's 0-100 prediction, declared
 * BEFORE the act, has to reach the action_records row the guard creates —
 * and a junk value has to be dropped rather than 400 the guard hot path or
 * be persisted as a prediction nobody made.
 */
describe('/api/guard?record=true stated confidence', () => {
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

  const base = { action_type: 'deploy', declared_goal: 'ship', agent_id: 'agt_1' };
  const recordedData = () => mockCreateActionRecord.mock.calls[0][1].data;

  it('lands an integer confidence on the inserted record', async () => {
    await post({ ...base, confidence: 80 });
    expect(recordedData().confidence).toBe(80);
  });

  it('coerces a numeric string to an integer', async () => {
    await post({ ...base, confidence: '80' });
    expect(recordedData().confidence).toBe(80);
  });

  it('is put back by the route after the REAL validator strips it', async () => {
    // The mocked validator above spreads the raw body, which would hide a
    // missing route line. GUARD_INPUT_SCHEMA has no `confidence` entry on
    // purpose (a schema entry would 400 the hot path), so the real validator
    // drops the field and only the route's own threading puts it back.
    const actual = await vi.importActual('@/lib/validate');
    const body = { ...base, confidence: 80 };
    expect(actual.validateGuardInput(body).data).not.toHaveProperty('confidence');

    mockValidateGuardInput.mockImplementation(actual.validateGuardInput);
    await POST(makeRequest('http://localhost/api/guard?record=true', {
      headers: { 'x-org-id': 'org_1' },
      body,
    }));

    expect(recordedData().confidence).toBe(80);
  });

  // Each junk value must leave the field ABSENT so the column default (50 =
  // unstated) applies — never persisted, and never a 400 on the hot path.
  for (const bad of [150, -1, 79.5, 'high', true, null, '']) {
    it(`omits an unusable confidence (${JSON.stringify(bad)}) instead of rejecting the call`, async () => {
      const res = await post({ ...base, confidence: bad });
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.decision).toBe('allow');
      expect(recordedData()).not.toHaveProperty('confidence');
    });
  }

  it('does not change the decision, the risk score, or what evaluation sees', async () => {
    const withOut = await (await post({ ...base })).json();
    const seenWithout = mockEvaluateGuard.mock.calls[0][1];
    vi.clearAllMocks();
    mockEvaluateGuard.mockResolvedValue({ decision: 'allow', reasons: [], warnings: [], matched_policies: [], risk_score: 10 });
    mockCreateActionRecord.mockResolvedValue({ action_id: 'act_new1' });
    const withIt = await (await post({ ...base, confidence: 80 })).json();
    const seenWith = mockEvaluateGuard.mock.calls[0][1];

    expect(withIt.decision).toBe(withOut.decision);
    expect(withIt.risk_score).toBe(withOut.risk_score);
    // Stored, never decided on: the only difference the evaluator sees is the
    // advisory field itself, and every decision-relevant field is identical.
    expect({ ...seenWith, confidence: undefined }).toEqual({ ...seenWithout, confidence: undefined });
  });
});
