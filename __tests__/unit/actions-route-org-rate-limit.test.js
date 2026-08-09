/**
 * G5: POST /api/actions (the record path) is org-rate-limited, same contract
 * as POST /api/guard — structured 429, no action row written when limited.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRequest } from '../helpers.js';

const {
  mockSql,
  mockValidateActionRecord,
  mockCreateActionRecord,
  mockCreateBlockedActionRecord,
  mockGetActionByIdempotencyKey,
  mockEvaluateGuard,
  mockVerifyAgentSignature,
  mockPublishOrgEvent,
  mockScanSensitiveData,
  mockEstimateCost,
  mockResolveAgentIdentity,
  mockGuardDecisionExists,
  mockCheckOrgRateLimit,
  mockAfter,
} = vi.hoisted(() => ({
  mockSql: Object.assign(vi.fn(async () => []), { query: vi.fn(async () => []) }),
  mockValidateActionRecord: vi.fn(),
  mockCreateActionRecord: vi.fn(),
  mockCreateBlockedActionRecord: vi.fn(),
  mockGetActionByIdempotencyKey: vi.fn(),
  mockEvaluateGuard: vi.fn(),
  mockVerifyAgentSignature: vi.fn(),
  mockPublishOrgEvent: vi.fn(),
  mockScanSensitiveData: vi.fn(),
  mockEstimateCost: vi.fn(),
  mockResolveAgentIdentity: vi.fn(),
  mockGuardDecisionExists: vi.fn(),
  mockCheckOrgRateLimit: vi.fn(),
  mockAfter: vi.fn((cb) => cb()),
}));

vi.mock('next/server', async () => {
  const actual = await vi.importActual('next/server');
  return { ...actual, after: (cb) => mockAfter(cb) };
});

vi.mock('@/lib/db.js', () => ({ getSql: () => mockSql }));
vi.mock('@/lib/validate.js', () => ({
  validateActionRecord: mockValidateActionRecord,
  boundedIdField: (v) => (typeof v === 'string' && v.length > 0 && v.length <= 200 ? v : null),
  enforcementModeField: (v) => (typeof v === 'string' && ['enforce', 'observe', 'warn', 'off'].includes(v.trim().toLowerCase()) ? v.trim().toLowerCase() : null),
}));
vi.mock('@/lib/repositories/actions.repository.js', () => ({
  createActionRecord: mockCreateActionRecord,
  createBlockedActionRecord: mockCreateBlockedActionRecord,
  getActionByIdempotencyKey: mockGetActionByIdempotencyKey,
}));
vi.mock('@/lib/guard.js', () => ({ evaluateGuard: mockEvaluateGuard }));
vi.mock('@/lib/identity.js', () => ({ verifyAgentSignature: mockVerifyAgentSignature }));
vi.mock('@/lib/identity-resolution.js', () => ({ resolveAgentIdentity: mockResolveAgentIdentity }));
vi.mock('@/lib/events.js', () => ({
  EVENTS: { ACTION_CREATED: 'action.created', ACTION_UPDATED: 'action.updated' },
  publishOrgEvent: mockPublishOrgEvent,
}));
vi.mock('@/lib/security.js', () => ({
  scanSensitiveData: mockScanSensitiveData,
  redactAny: (value) => value,
}));
vi.mock('@/lib/billing.js', () => ({ estimateCost: mockEstimateCost }));
vi.mock('@/lib/repositories/guard.repository.js', () => ({ guardDecisionExists: mockGuardDecisionExists }));
vi.mock('@/lib/org-rate-limit.js', () => ({ checkOrgRateLimit: mockCheckOrgRateLimit }));

import { POST } from '@/api/actions/route.js';

function post(data) {
  return POST(makeRequest('http://localhost/api/actions', {
    method: 'POST',
    headers: { 'x-org-id': 'org_1' },
    body: data,
  }));
}

describe('POST /api/actions org rate limit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATABASE_URL = 'postgres://unit-test';
    mockSql.mockImplementation(async () => []);
    mockSql.query.mockImplementation(async () => []);
    mockCheckOrgRateLimit.mockResolvedValue({ allowed: true, limit: 600, remaining: 599, retryAfterMs: 0, backend: 'redis' });
    mockValidateActionRecord.mockReturnValue({ valid: true, data: { agent_id: 'agt_1', action_type: 'deploy', declared_goal: 'ship it' }, errors: [] });
  });

  it('returns a structured 429 with Retry-After when the org is over its limit', async () => {
    mockCheckOrgRateLimit.mockResolvedValue({ allowed: false, limit: 600, remaining: 0, retryAfterMs: 42000, backend: 'redis' });
    const res = await post({ agent_id: 'agt_1', action_type: 'deploy', declared_goal: 'ship it' });
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('42');
    const body = await res.json();
    expect(body.code).toBe('ORG_RATE_LIMITED');
    expect(body.retry_after_ms).toBe(42000);
  });

  it('keys the limit by the caller org and writes nothing when limited', async () => {
    mockCheckOrgRateLimit.mockResolvedValue({ allowed: false, limit: 600, remaining: 0, retryAfterMs: 1000, backend: 'memory' });
    await post({ agent_id: 'agt_1', action_type: 'deploy', declared_goal: 'ship it' });
    expect(mockCheckOrgRateLimit).toHaveBeenCalledWith('org_1');
    expect(mockCreateActionRecord).not.toHaveBeenCalled();
    expect(mockCreateBlockedActionRecord).not.toHaveBeenCalled();
  });

  it('proceeds past the limiter when the org is under its limit', async () => {
    const res = await post({ agent_id: 'agt_1', action_type: 'deploy', declared_goal: 'ship it' });
    expect(res.status).not.toBe(429);
    expect(mockCheckOrgRateLimit).toHaveBeenCalledWith('org_1');
  });
});
