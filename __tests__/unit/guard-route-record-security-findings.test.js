/**
 * FIX B1 (2026-08-14 adversarial review): ?record=true built `dlpFindings`
 * via redactAny() for agent_name/declared_goal/reasoning/authorization_scope/
 * trigger/input_summary/systems_touched and then never read it — a hook
 * could not learn a secret had been redacted out of its payload before
 * persisting. Mirrors POST /api/actions' `security` response field
 * (clean/findings_count/critical_count/categories, app/api/actions/route.ts).
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

// next/server's after() throws "outside a request scope" in unit tests —
// invoke the deferred side effects immediately (same idiom as the other
// guard-route tests).
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

// security.js is deliberately NOT mocked here — the real redactAny/
// scanSensitiveData patterns are what actually populate dlpFindings.

import { POST } from '@/api/guard/route.js';

// AWS's own published example access key id (docs.aws.amazon.com) — matches
// the aws_access_key pattern (AKIA[0-9A-Z]{16}) without being a real credential.
const FAKE_AWS_KEY = 'AKIA' + 'IOSFODNN7EXAMPLE';

function post(data) {
  mockValidateGuardInput.mockReturnValue({ valid: true, data: { ...data }, errors: [] });
  return POST(makeRequest('http://localhost/api/guard?record=true', {
    headers: { 'x-org-id': 'org_1' },
    body: data,
  }));
}

describe('/api/guard?record=true security metadata (FIX B1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it('reports a security object with findings when declared_goal carries a secret pattern', async () => {
    const res = await post({
      action_type: 'deploy',
      declared_goal: `ship using ${FAKE_AWS_KEY}`,
      agent_id: 'agt_1',
    });
    const body = await res.json();

    expect(body.recorded).toBe(true);
    expect(body.security).toBeDefined();
    expect(body.security.clean).toBe(false);
    expect(body.security.findings_count).toBeGreaterThanOrEqual(1);
    expect(body.security.critical_count).toBeGreaterThanOrEqual(1);
    expect(body.security.categories).toContain('cloud_credential');

    // The persisted record must carry the REDACTED text, not the raw secret.
    const insertedData = mockCreateActionRecord.mock.calls[0][1].data;
    expect(insertedData.declared_goal).not.toContain(FAKE_AWS_KEY);
  });

  it('reports clean:true when nothing matches a secret pattern', async () => {
    const res = await post({
      action_type: 'deploy',
      declared_goal: 'ship the release',
      agent_id: 'agt_1',
    });
    const body = await res.json();

    expect(body.recorded).toBe(true);
    expect(body.security).toEqual({ clean: true, findings_count: 0, critical_count: 0, categories: [] });
  });
});
