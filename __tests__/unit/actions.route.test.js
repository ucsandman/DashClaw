import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRequest } from '../helpers.js';

const {
  mockSql,
  mockValidateActionRecord,
  mockListActions,
  mockCreateActionRecord,
  mockCreateBlockedActionRecord,
  mockHasAgentAction,
  mockInsertActionEmbedding,
  mockDeleteActionsByIds,
  mockListActionIdsByFilter,
  mockMaybeSweepLostOutcomes,
  mockGetActionByIdempotencyKey,
  mockEvaluateGuard,
  mockVerifyAgentSignature,
  mockPublishOrgEvent,
  mockScanSensitiveData,
  mockEstimateCost,
  mockResolveAgentIdentity,
  mockGuardDecisionExists,
  mockAfter,
} = vi.hoisted(() => ({
  mockSql: Object.assign(vi.fn(async () => []), { query: vi.fn(async () => []) }),
  mockValidateActionRecord: vi.fn(),
  mockListActions: vi.fn(),
  mockCreateActionRecord: vi.fn(),
  mockCreateBlockedActionRecord: vi.fn(),
  mockHasAgentAction: vi.fn(),
  mockInsertActionEmbedding: vi.fn(),
  mockDeleteActionsByIds: vi.fn(),
  mockListActionIdsByFilter: vi.fn(async () => []),
  mockMaybeSweepLostOutcomes: vi.fn(async () => []),
  mockGetActionByIdempotencyKey: vi.fn(),
  mockEvaluateGuard: vi.fn(),
  mockVerifyAgentSignature: vi.fn(),
  mockPublishOrgEvent: vi.fn(),
  mockScanSensitiveData: vi.fn(),
  mockEstimateCost: vi.fn(),
  mockResolveAgentIdentity: vi.fn(),
  mockGuardDecisionExists: vi.fn(),
  mockAfter: vi.fn(),
}));

// next/server's `after()` throws "outside a request scope" in unit tests.
// Mock it via mockAfter (default: invoke immediately) so individual tests can
// capture the deferred callbacks instead.
vi.mock('next/server', async () => {
  const actual = await vi.importActual('next/server');
  return { ...actual, after: (cb) => mockAfter(cb) };
});

vi.mock('@/lib/db.js', () => ({ getSql: () => mockSql }));
vi.mock('@/lib/validate.js', () => ({ validateActionRecord: mockValidateActionRecord, boundedIdField: (v) => (typeof v === 'string' && v.length > 0 && v.length <= 200 ? v : null) }));
vi.mock('@/lib/repositories/actions.repository.js', () => ({
  listActions: mockListActions,
  createActionRecord: mockCreateActionRecord,
  createBlockedActionRecord: mockCreateBlockedActionRecord,
  deleteActionsByIds: mockDeleteActionsByIds,
  listActionIdsByFilter: mockListActionIdsByFilter,
  maybeSweepLostOutcomes: mockMaybeSweepLostOutcomes,
  hasAgentAction: mockHasAgentAction,
  insertActionEmbedding: mockInsertActionEmbedding,
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
  redactAny: function redactAny(value, findings) {
    if (typeof value === 'string') {
      const scan = mockScanSensitiveData(value);
      if (!scan.clean) findings.push(...scan.findings);
      return scan.redacted;
    }
    if (Array.isArray(value)) return value.map((v) => redactAny(v, findings));
    if (value && typeof value === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(value)) out[k] = redactAny(v, findings);
      return out;
    }
    return value;
  },
}));
vi.mock('@/lib/billing.js', () => ({ estimateCost: mockEstimateCost }));
vi.mock('@/lib/repositories/guard.repository.js', () => ({ guardDecisionExists: mockGuardDecisionExists }));

import { GET, POST, DELETE } from '@/api/actions/route.js';

const defaultGuardDecision = { decision: 'allow', reasons: [], warnings: [], matched_policies: [] };
const defaultAction = { action_id: 'act_test', agent_id: 'agent_1', action_type: 'build', declared_goal: 'Test' };

beforeEach(() => {
  vi.clearAllMocks();
  mockAfter.mockImplementation((cb) => { try { cb(); } catch { /* see next/server mock note */ } });
  process.env.DATABASE_URL = 'postgres://unit-test';
  process.env.NODE_ENV = 'test';
  delete process.env.ENFORCE_AGENT_SIGNATURES;
  delete process.env.DASHCLAW_CLOSED_ENROLLMENT;

  mockSql.mockImplementation(async () => []);
  mockSql.query.mockImplementation(async () => []);
  mockEvaluateGuard.mockResolvedValue(defaultGuardDecision);
  mockHasAgentAction.mockResolvedValue(true);
  mockScanSensitiveData.mockReturnValue({ clean: true, redacted: undefined, findings: [] });
  mockPublishOrgEvent.mockResolvedValue(undefined);
  mockEstimateCost.mockReturnValue(0);
  // Default: no bearer token → self-asserted identity echoed back, unverified.
  mockResolveAgentIdentity.mockImplementation(async (_req, { agentId = null, agentName = null } = {}) => ({
    agent_id: agentId, agent_name: agentName, verification_status: 'unverified', verified: false, jti: null, verification: null,
  }));
});

describe('/api/actions GET', () => {
  it('returns actions with pagination defaults', async () => {
    mockListActions.mockResolvedValue({ actions: [defaultAction], total: 1, stats: {} });

    const res = await GET(makeRequest('http://localhost/api/actions', {
      headers: { 'x-org-id': 'org_1' },
    }));

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.actions).toHaveLength(1);
    expect(data.total).toBe(1);
  });

  it('passes filters to listActions', async () => {
    mockListActions.mockResolvedValue({ actions: [], total: 0, stats: {} });

    await GET(makeRequest('http://localhost/api/actions?agent_id=a1&status=running&action_type=build&risk_min=50', {
      headers: { 'x-org-id': 'org_1' },
    }));

    expect(mockListActions).toHaveBeenCalledWith(
      mockSql,
      'org_1',
      expect.objectContaining({
        agent_id: 'a1',
        status: 'running',
        action_type: 'build',
        risk_min: '50',
      })
    );
  });

  it('caps limit at 200', async () => {
    mockListActions.mockResolvedValue({ actions: [], total: 0, stats: {} });

    await GET(makeRequest('http://localhost/api/actions?limit=9999', {
      headers: { 'x-org-id': 'org_1' },
    }));

    const call = mockListActions.mock.calls[0][2];
    expect(call.limit).toBe(200);
  });

  it('returns 500 on repository error', async () => {
    mockListActions.mockRejectedValue(new Error('db down'));

    const res = await GET(makeRequest('http://localhost/api/actions', {
      headers: { 'x-org-id': 'org_1' },
    }));

    expect(res.status).toBe(500);
  });
});

describe('/api/actions POST', () => {
  const validBody = {
    agent_id: 'agent_1',
    action_type: 'build',
    declared_goal: 'Build the project',
  };

  beforeEach(() => {
    mockValidateActionRecord.mockReturnValue({ valid: true, data: { ...validBody }, errors: [] });
    mockCreateActionRecord.mockResolvedValue({ ...validBody, action_id: 'act_new' });
    mockScanSensitiveData.mockImplementation((val) => ({ clean: true, redacted: val, findings: [] }));
    mockGuardDecisionExists.mockResolvedValue(true);
  });

  describe('guard_decision_id stamp validation (2026-07-01 security review)', () => {
    it('rejects a malformed guard_decision_id with 400 without hitting the DB', async () => {
      mockValidateActionRecord.mockReturnValue({
        valid: true,
        data: { ...validBody, guard_decision_id: 'act_gd_NOT-HEX' },
        errors: [],
      });
      const res = await POST(makeRequest('http://localhost/api/actions', {
        headers: { 'x-org-id': 'org_1' },
        body: { ...validBody, guard_decision_id: 'act_gd_NOT-HEX' },
      }));
      expect(res.status).toBe(400);
      expect(mockGuardDecisionExists).not.toHaveBeenCalled();
      expect(mockCreateActionRecord).not.toHaveBeenCalled();
    });

    it('rejects a well-formed id that does not resolve in this org with 400', async () => {
      mockValidateActionRecord.mockReturnValue({
        valid: true,
        data: { ...validBody, guard_decision_id: 'act_gd_0123456789abcdef' },
        errors: [],
      });
      mockGuardDecisionExists.mockResolvedValue(false);
      const res = await POST(makeRequest('http://localhost/api/actions', {
        headers: { 'x-org-id': 'org_1' },
        body: { ...validBody, guard_decision_id: 'act_gd_0123456789abcdef' },
      }));
      expect(res.status).toBe(400);
      expect(mockGuardDecisionExists).toHaveBeenCalledWith(mockSql, 'org_1', 'act_gd_0123456789abcdef');
      expect(mockCreateActionRecord).not.toHaveBeenCalled();
    });

    it('accepts a well-formed id that resolves in this org and persists it', async () => {
      mockValidateActionRecord.mockReturnValue({
        valid: true,
        data: { ...validBody, guard_decision_id: 'act_gd_0123456789abcdef' },
        errors: [],
      });
      const res = await POST(makeRequest('http://localhost/api/actions', {
        headers: { 'x-org-id': 'org_1' },
        body: { ...validBody, guard_decision_id: 'act_gd_0123456789abcdef' },
      }));
      expect(res.status).toBe(201);
      expect(mockCreateActionRecord).toHaveBeenCalledWith(
        mockSql,
        expect.objectContaining({
          data: expect.objectContaining({ guard_decision_id: 'act_gd_0123456789abcdef' }),
        }),
      );
    });
  });

  it('returns 201 for a valid action with allow decision', async () => {
    const res = await POST(makeRequest('http://localhost/api/actions', {
      headers: { 'x-org-id': 'org_1' },
      body: validBody,
    }));

    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.action_id).toBeDefined();
    expect(data.decision.decision).toBe('allow');
  });

  it('uses the JWKS-verified identity over the body agent_id and stores verified=true (R3)', async () => {
    mockValidateActionRecord.mockReturnValue({
      valid: true,
      data: { ...validBody, agent_id: 'attacker_chosen' },
      errors: [],
    });
    mockResolveAgentIdentity.mockResolvedValue({
      agent_id: 'verified_sub', agent_name: 'V', verification_status: 'verified', verified: true, jti: 'j1', verification: {},
    });

    await POST(makeRequest('http://localhost/api/actions', {
      headers: { 'x-org-id': 'org_1', authorization: 'Bearer tok' },
      body: { ...validBody, agent_id: 'attacker_chosen' },
    }));

    expect(mockCreateActionRecord).toHaveBeenCalledWith(
      mockSql,
      expect.objectContaining({
        verified: true,
        data: expect.objectContaining({ agent_id: 'verified_sub' }),
      }),
    );
  });

  it('persists the authoritative guard risk_score, not the client-asserted value (R1)', async () => {
    // Agent self-reports risk 5; server-authoritative guard score is 88.
    mockValidateActionRecord.mockReturnValue({
      valid: true,
      data: { ...validBody, risk_score: 5 },
      errors: [],
    });
    mockEvaluateGuard.mockResolvedValue({ ...defaultGuardDecision, risk_score: 88 });

    const res = await POST(makeRequest('http://localhost/api/actions', {
      headers: { 'x-org-id': 'org_1' },
      body: { ...validBody, risk_score: 5 },
    }));

    expect(res.status).toBe(201);
    expect(mockCreateActionRecord).toHaveBeenCalledWith(
      mockSql,
      expect.objectContaining({ riskScore: 88 }),
    );
  });

  it('stores the guard authoritative score (consistent with guard_decisions), not the raw client value (R1)', async () => {
    // The engine already folds the client's report into its score
    // (effectiveRiskScore = max(server, client)); the route must persist exactly
    // what the guard decided on so action_records == guard_decisions. Here the
    // guard's authoritative score is 88 — that is stored, not the client's 95.
    mockValidateActionRecord.mockReturnValue({
      valid: true,
      data: { ...validBody, risk_score: 95 },
      errors: [],
    });
    mockEvaluateGuard.mockResolvedValue({ ...defaultGuardDecision, risk_score: 88 });

    await POST(makeRequest('http://localhost/api/actions', {
      headers: { 'x-org-id': 'org_1' },
      body: { ...validBody, risk_score: 95 },
    }));

    expect(mockCreateActionRecord).toHaveBeenCalledWith(
      mockSql,
      expect.objectContaining({ riskScore: 88 }),
    );
  });

  it('passes the authoritative risk to the blocked action record (R1)', async () => {
    mockEvaluateGuard.mockResolvedValue({
      decision: 'block', reasons: ['Policy violation'], warnings: [], matched_policies: ['gp_1'], risk_score: 91,
    });
    mockValidateActionRecord.mockReturnValue({ valid: true, data: { ...validBody, risk_score: 0 }, errors: [] });
    mockCreateBlockedActionRecord.mockResolvedValue({ action_id: 'act_blocked', status: 'blocked' });

    await POST(makeRequest('http://localhost/api/actions', {
      headers: { 'x-org-id': 'org_1' },
      body: { ...validBody, risk_score: 0 },
    }));

    expect(mockCreateBlockedActionRecord).toHaveBeenCalledWith(
      mockSql,
      expect.objectContaining({ riskScore: 91 }),
    );
  });

  it('returns 400 on validation failure', async () => {
    mockValidateActionRecord.mockReturnValue({
      valid: false,
      data: {},
      errors: ['agent_id is required', 'action_type is required'],
    });

    const res = await POST(makeRequest('http://localhost/api/actions', {
      headers: { 'x-org-id': 'org_1' },
      body: {},
    }));

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.details).toContain('agent_id is required');
  });


  it('returns 403 when guard blocks the action and creates blocked action record', async () => {
    mockEvaluateGuard.mockResolvedValue({
      decision: 'block',
      reasons: ['Policy violation'],
      warnings: [],
      matched_policies: ['gp_1'],
    });
    mockCreateBlockedActionRecord.mockResolvedValue({ ...validBody, action_id: 'act_blocked', status: 'blocked' });

    const res = await POST(makeRequest('http://localhost/api/actions', {
      headers: { 'x-org-id': 'org_1' },
      body: validBody,
    }));

    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.decision.decision).toBe('block');
    expect(data.action).toBeDefined();
    expect(data.action.status).toBe('blocked');
    expect(mockCreateBlockedActionRecord).toHaveBeenCalled();
  });

  it('returns 202 when guard requires approval', async () => {
    mockEvaluateGuard.mockResolvedValue({
      decision: 'require_approval',
      reasons: ['High risk action'],
      warnings: [],
      matched_policies: ['gp_2'],
    });
    mockCreateActionRecord.mockResolvedValue({ ...validBody, action_id: 'act_new', status: 'pending_approval' });

    const res = await POST(makeRequest('http://localhost/api/actions', {
      headers: { 'x-org-id': 'org_1' },
      body: validBody,
    }));

    expect(res.status).toBe(202);
  });

  it('returns 403 when closed enrollment blocks unknown agent', async () => {
    process.env.DASHCLAW_CLOSED_ENROLLMENT = 'true';
    mockHasAgentAction.mockResolvedValue(false);

    const res = await POST(makeRequest('http://localhost/api/actions', {
      headers: { 'x-org-id': 'org_1' },
      body: validBody,
    }));

    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.code).toBe('AGENT_NOT_REGISTERED');
  });


  it('returns 401 when signature enforcement is opted in but signature is missing', async () => {
    process.env.ENFORCE_AGENT_SIGNATURES = 'true';

    const res = await POST(makeRequest('http://localhost/api/actions', {
      headers: { 'x-org-id': 'org_1' },
      body: validBody,
    }));

    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.code).toBe('SIGNATURE_REQUIRED');

    delete process.env.ENFORCE_AGENT_SIGNATURES;
  });

  it('includes DLP findings in security metadata', async () => {
    const findings = [{ category: 'api_key', severity: 'critical', field: 'declared_goal' }];
    mockScanSensitiveData.mockReturnValue({ clean: false, redacted: '[REDACTED]', findings });

    const res = await POST(makeRequest('http://localhost/api/actions', {
      headers: { 'x-org-id': 'org_1' },
      body: validBody,
    }));

    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.security.clean).toBe(false);
    expect(data.security.critical_count).toBe(1);
  });


  it('schedules meter background work via after(), not as an un-awaited promise (Vercel free tier)', async () => {
    // Capture after() callbacks instead of invoking them, so we can prove the
    // background meter work runs in the after() phase, not during the request.
    const deferred = [];
    mockAfter.mockImplementation((cb) => { deferred.push(cb); });

    const res = await POST(makeRequest('http://localhost/api/actions', {
      headers: { 'x-org-id': 'org_1' },
      body: validBody,
    }));

    expect(res.status).toBe(201);
    // The meter/quota work must be deferred to the after() phase so it is not
    // dropped when the lambda freezes at response time on Vercel.
    expect(mockAfter).toHaveBeenCalled();

    // Run the deferred callbacks: the meter work executes there. (Other after()
    // callbacks — alerts, digest tick — may reject against the bare mocks;
    // tolerate that.)
    await Promise.all(deferred.map((cb) => Promise.resolve().then(cb).catch(() => { /* unrelated after() work */ })));
  });

  it('returns 409 on duplicate action_id', async () => {
    mockCreateActionRecord.mockRejectedValue(new Error('unique constraint violated'));

    const res = await POST(makeRequest('http://localhost/api/actions', {
      headers: { 'x-org-id': 'org_1' },
      body: validBody,
    }));

    expect(res.status).toBe(409);
  });

  it('returns 500 on unexpected error', async () => {
    mockCreateActionRecord.mockRejectedValue(new Error('database unavailable'));

    const res = await POST(makeRequest('http://localhost/api/actions', {
      headers: { 'x-org-id': 'org_1' },
      body: validBody,
    }));

    expect(res.status).toBe(500);
  });

  // --- Durable execution finality — Phase 6 idempotency ---

  describe('idempotency_key short-circuit', () => {
    it('returns the existing row when idempotency_key already exists for this org', async () => {
      const existingRow = {
        action_id: 'act_prev',
        agent_id: 'agent_1',
        action_type: 'build',
        declared_goal: 'Build the project',
        idempotency_key: 'k1',
      };
      mockValidateActionRecord.mockReturnValue({
        valid: true,
        data: { ...validBody, idempotency_key: 'k1' },
        errors: [],
      });
      mockGetActionByIdempotencyKey.mockResolvedValue(existingRow);

      const res = await POST(makeRequest('http://localhost/api/actions', {
        headers: { 'x-org-id': 'org_1' },
        body: { ...validBody, idempotency_key: 'k1' },
      }));

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.idempotent_replay).toBe(true);
      expect(data.action.action_id).toBe('act_prev');
      // Top-level alias must match the fresh-create response shape — clients
      // reading response.action_id broke only on the replay path without it.
      expect(data.action_id).toBe('act_prev');

      // Critical: nothing downstream runs on a replay — no guard,
      // no create, no signature verification.
      expect(mockEvaluateGuard).not.toHaveBeenCalled();
      expect(mockCreateActionRecord).not.toHaveBeenCalled();
    });

    it('proceeds normally when idempotency_key is supplied but no prior row exists', async () => {
      mockValidateActionRecord.mockReturnValue({
        valid: true,
        data: { ...validBody, idempotency_key: 'k_new' },
        errors: [],
      });
      mockGetActionByIdempotencyKey.mockResolvedValue(null);

      const res = await POST(makeRequest('http://localhost/api/actions', {
        headers: { 'x-org-id': 'org_1' },
        body: { ...validBody, idempotency_key: 'k_new' },
      }));

      expect(res.status).toBe(201);
      expect(mockCreateActionRecord).toHaveBeenCalledTimes(1);
    });

    it('does not call the idempotency lookup when no key is supplied', async () => {
      mockValidateActionRecord.mockReturnValue({
        valid: true,
        data: { ...validBody },
        errors: [],
      });

      const res = await POST(makeRequest('http://localhost/api/actions', {
        headers: { 'x-org-id': 'org_1' },
        body: validBody,
      }));

      expect(res.status).toBe(201);
      expect(mockGetActionByIdempotencyKey).not.toHaveBeenCalled();
    });
  });
});

describe('/api/actions DELETE', () => {
  it('returns 403 for non-admins', async () => {
    const res = await DELETE(makeRequest('http://localhost/api/actions?action_id=act_1', {
      headers: { 'x-org-id': 'org_1', 'x-org-role': 'member' },
    }));

    expect(res.status).toBe(403);
  });

  it('deletes a single action by action_id', async () => {
    mockDeleteActionsByIds.mockResolvedValue([{ action_id: 'act_1' }]);

    const res = await DELETE(makeRequest('http://localhost/api/actions?action_id=act_1', {
      headers: { 'x-org-id': 'org_1', 'x-org-role': 'admin' },
    }));

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.deleted).toBe(1);
  });

  it('returns 400 on bulk delete with no filters', async () => {
    const res = await DELETE(makeRequest('http://localhost/api/actions', {
      headers: { 'x-org-id': 'org_1', 'x-org-role': 'admin' },
    }));

    expect(res.status).toBe(400);
  });

  it('performs bulk delete with before filter', async () => {
    mockListActionIdsByFilter.mockResolvedValue(['act_1', 'act_2']);
    mockSql.query.mockResolvedValue([{ action_id: 'act_1' }, { action_id: 'act_2' }]);

    const res = await DELETE(makeRequest('http://localhost/api/actions?before=2026-01-01', {
      headers: { 'x-org-id': 'org_1', 'x-org-role': 'admin' },
    }));

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.deleted).toBe(2);
    // Write-ahead erasure audit: the target set is resolved before deleting.
    expect(mockListActionIdsByFilter).toHaveBeenCalled();
  });

  it('fails closed: nothing is deleted when the erasure audit row cannot be written', async () => {
    // The audit INSERT is the only tagged-sql call on this path; reject it.
    mockSql.mockRejectedValueOnce(new Error('audit insert failed'));

    const res = await DELETE(makeRequest('http://localhost/api/actions?action_id=act_1', {
      headers: { 'x-org-id': 'org_1', 'x-org-role': 'admin' },
    }));

    expect(res.status).toBe(500);
    expect(mockDeleteActionsByIds).not.toHaveBeenCalled();
  });

  it('returns 500 on error', async () => {
    mockDeleteActionsByIds.mockRejectedValue(new Error('db error'));

    const res = await DELETE(makeRequest('http://localhost/api/actions?action_id=act_1', {
      headers: { 'x-org-id': 'org_1', 'x-org-role': 'admin' },
    }));

    expect(res.status).toBe(500);
  });
});
