/**
 * FIX B2 (2026-08-14 adversarial review): two concurrent ?record=true calls
 * carrying the SAME idempotency_key can both pass recordRunningAction's
 * pre-insert `reads.existing` lookup (neither row exists yet) and then race
 * createActionRecord's INSERT. The DB's unique index
 * (drizzle/0004 action_records_idempotency_idx) lets exactly one insert win;
 * the loser used to surface as a bare recorded:false ("Failed to create
 * action record") — a false negative, since the action WAS recorded, by the
 * winner. On a 23505 unique-violation with an idempotency_key present, the
 * route re-queries by key and reports recorded:true with the winner's row.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRequest } from '../helpers.js';

const {
  mockSql, mockValidateGuardInput, mockEvaluateGuard, mockListGuardDecisions,
  mockGetPriorDecision, mockCreateActionRecord, mockGetActionByKey, mockGetOrgHalt,
} = vi.hoisted(() => ({
  mockSql: Object.assign(vi.fn(async () => []), { query: vi.fn(async () => []) }),
  mockValidateGuardInput: vi.fn(),
  mockEvaluateGuard: vi.fn(),
  mockListGuardDecisions: vi.fn(),
  mockGetPriorDecision: vi.fn(),
  mockCreateActionRecord: vi.fn(),
  mockGetActionByKey: vi.fn(),
  mockGetOrgHalt: vi.fn(),
}));

vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, after: (cb) => { void cb(); } };
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
  publishOrgEvent: vi.fn(),
}));
vi.mock('@/lib/repositories/jti-replay.repository.js', () => ({
  checkAndRecord: vi.fn(async () => 'unique'),
  sweep: vi.fn(async () => 0),
}));

import { POST } from '@/api/guard/route.js';

const KEY = 'race'.padEnd(64, '0');

function post(data) {
  mockValidateGuardInput.mockReturnValue({ valid: true, data: { ...data }, errors: [] });
  return POST(makeRequest('http://localhost/api/guard?record=true', {
    headers: { 'x-org-id': 'org_1' },
    body: data,
  }));
}

describe('/api/guard?record=true idempotency insert-race recovery (FIX B2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATABASE_URL = 'postgres://unit-test';
    process.env.DASHCLAW_MODE = 'cloud';
    mockSql.mockImplementation(async () => []);
    mockSql.query.mockImplementation(async () => []);
    mockGetPriorDecision.mockResolvedValue(null);
    mockGetOrgHalt.mockResolvedValue(null);
    mockEvaluateGuard.mockResolvedValue({ decision: 'allow', reasons: [], warnings: [], matched_policies: [], risk_score: 10 });
  });

  it('recovers recorded:true from the winner row when createActionRecord throws a 23505 unique violation', async () => {
    // Pre-insert lookup finds nothing (this request believed it was first)...
    mockGetActionByKey.mockResolvedValueOnce(null);
    // ...the INSERT then loses the race...
    mockCreateActionRecord.mockRejectedValueOnce(Object.assign(new Error('duplicate key value violates unique constraint "action_records_idempotency_idx"'), { code: '23505' }));
    // ...and the recovery re-query finds the winner's row.
    mockGetActionByKey.mockResolvedValueOnce({ action_id: 'act_winner', idempotency_key: KEY });

    const res = await post({
      action_type: 'deploy',
      declared_goal: 'ship',
      agent_id: 'agt_1',
      idempotency_key: KEY,
    });
    const body = await res.json();

    expect(body.recorded).toBe(true);
    expect(body.action_id).toBe('act_winner');
    expect(body.recorded_error).toBeUndefined();
  });

  it('still reports recorded:false for a non-23505 create failure', async () => {
    mockGetActionByKey.mockResolvedValue(null);
    mockCreateActionRecord.mockRejectedValueOnce(Object.assign(new Error('connection reset'), { code: '08006' }));

    const res = await post({
      action_type: 'deploy',
      declared_goal: 'ship',
      agent_id: 'agt_1',
      idempotency_key: KEY,
    });
    const body = await res.json();

    expect(body.recorded).toBe(false);
    expect(body.recorded_error).toBe('Failed to create action record');
    // The recovery path must not fire a second lookup for an unrelated error.
    expect(mockGetActionByKey).toHaveBeenCalledTimes(1);
  });
});
