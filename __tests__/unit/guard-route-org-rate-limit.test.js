/**
 * G5: POST /api/guard is org-rate-limited (org-keyed, not IP-keyed).
 * A limited org gets a structured 429 BEFORE any guard evaluation or action
 * write happens; the per-IP middleware limiter stays as the pre-auth fallback.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRequest } from '../helpers.js';

const {
  mockSql, mockValidateGuardInput, mockEvaluateGuard, mockListGuardDecisions,
  mockGetPriorDecision, mockCreateActionRecord, mockCreateBlockedActionRecord,
  mockGetActionByKey, mockGetOrgHalt, mockPublishOrgEvent, mockFireActionAlert,
  mockCheckOrgRateLimit, afterCalls,
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
  mockCheckOrgRateLimit: vi.fn(),
  afterCalls: [],
}));

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
vi.mock('@/lib/org-rate-limit.js', () => ({ checkOrgRateLimit: mockCheckOrgRateLimit }));

import { POST } from '@/api/guard/route.js';

function post(data) {
  mockValidateGuardInput.mockReturnValue({ valid: true, data: { ...data }, errors: [] });
  return POST(makeRequest('http://localhost/api/guard?record=true', {
    headers: { 'x-org-id': 'org_1' },
    body: data,
  }));
}

describe('POST /api/guard org rate limit', () => {
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
    mockEvaluateGuard.mockResolvedValue({ decision: 'allow', decision_id: 'act_gd_1', reasons: [], matched_policies: [], risk_score: 0 });
    mockCheckOrgRateLimit.mockResolvedValue({ allowed: true, limit: 600, remaining: 599, retryAfterMs: 0, backend: 'redis' });
  });

  it('returns a structured 429 with Retry-After when the org is over its limit', async () => {
    mockCheckOrgRateLimit.mockResolvedValue({ allowed: false, limit: 600, remaining: 0, retryAfterMs: 21000, backend: 'redis' });
    const res = await post({ action_type: 'deploy', declared_goal: 'ship it', agent_id: 'agt_1' });
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('21');
    const body = await res.json();
    expect(body.code).toBe('ORG_RATE_LIMITED');
    expect(body.retry_after_ms).toBe(21000);
    expect(body).toHaveProperty('error');
  });

  it('keys the limit by the caller org', async () => {
    await post({ action_type: 'deploy', declared_goal: 'ship it', agent_id: 'agt_1' });
    expect(mockCheckOrgRateLimit).toHaveBeenCalledWith('org_1');
  });

  it('does not evaluate or record anything for a limited request', async () => {
    mockCheckOrgRateLimit.mockResolvedValue({ allowed: false, limit: 600, remaining: 0, retryAfterMs: 5000, backend: 'memory' });
    await post({ action_type: 'deploy', declared_goal: 'ship it', agent_id: 'agt_1' });
    expect(mockEvaluateGuard).not.toHaveBeenCalled();
    expect(mockCreateActionRecord).not.toHaveBeenCalled();
    expect(mockCreateBlockedActionRecord).not.toHaveBeenCalled();
  });

  it('proceeds normally when the org is under its limit', async () => {
    const res = await post({ action_type: 'deploy', declared_goal: 'ship it', agent_id: 'agt_1' });
    expect(res.status).not.toBe(429);
    expect(mockEvaluateGuard).toHaveBeenCalledTimes(1);
  });
});
