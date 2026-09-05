// Preflight Plan Authorization (docs/rfcs/2026-07-06-preflight-plan-authorization.md).
// Route tests for POST|GET /api/plans. Mock style copied from
// __tests__/unit/approvals-route.test.js (adapted to TS the way
// __tests__/unit/policies-review.route.test.ts does: vi.hoisted mocks used
// directly in vi.mock factories, and a typed makeRequest wrapper around the
// duck-typed helper).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRequest as rawRequest } from '../helpers.js';

/** helpers.js returns a duck-typed request object; route handlers expect Request. */
function makeRequest(
  url: string,
  opts: { headers?: Record<string, string>; body?: unknown } = {},
): Request {
  return rawRequest(url, opts) as unknown as Request;
}

const {
  mockGetSql,
  mockGetOrgId,
  mockGetUserId,
  mockResolveAgentIdentity,
  mockPublishOrgEvent,
  mockEvaluateGuard,
  mockGetSettings,
  mockCreatePlanWithSteps,
  mockStampStepPreview,
  mockListPlans,
  mockCountPendingPlans,
  mockMarkPlanPending,
  mockReviewPlan,
  mockListStepsForPlans,
  mockListDeviationsForPlans,
} = vi.hoisted(() => ({
  mockGetSql: vi.fn(),
  mockGetOrgId: vi.fn(() => 'org_test'),
  mockGetUserId: vi.fn(() => 'user_1'),
  mockResolveAgentIdentity: vi.fn(async (_req: unknown, opts: { agentId?: string | null } = {}) => ({
    agent_id: opts.agentId ?? null,
    agent_name: null,
    verification_status: 'unverified',
    verified: false,
    jti: null,
    verification: null,
  })),
  mockPublishOrgEvent: vi.fn((_event: string, _payload: unknown) => Promise.resolve()),
  mockEvaluateGuard: vi.fn(),
  mockGetSettings: vi.fn(async () => [] as Array<{ key: string; value: string }>),
  mockCreatePlanWithSteps: vi.fn(),
  mockStampStepPreview: vi.fn(async () => {}),
  mockListPlans: vi.fn(async () => [] as unknown[]),
  mockCountPendingPlans: vi.fn(async () => 0),
  mockMarkPlanPending: vi.fn(async () => null as unknown),
  mockReviewPlan: vi.fn(async () => null as unknown),
  mockListStepsForPlans: vi.fn(async () => [] as unknown[]),
  mockListDeviationsForPlans: vi.fn(async () => [] as unknown[]),
}));

vi.mock('@/lib/db.js', () => ({ getSql: () => mockGetSql }));
vi.mock('@/lib/org.js', () => ({ getOrgId: mockGetOrgId, getUserId: mockGetUserId }));
vi.mock('@/lib/identity-resolution.js', () => ({ resolveAgentIdentity: mockResolveAgentIdentity }));
vi.mock('@/lib/events.js', () => ({
  EVENTS: { ACTION_UPDATED: 'action.updated' },
  publishOrgEvent: mockPublishOrgEvent,
}));
vi.mock('@/lib/guard.js', () => ({ evaluateGuard: mockEvaluateGuard }));
vi.mock('@/lib/repositories/settings.repository.js', () => ({ getSettings: mockGetSettings }));
vi.mock('@/lib/repositories/plans.repository.js', () => ({
  createPlanWithSteps: mockCreatePlanWithSteps,
  stampStepPreview: mockStampStepPreview,
  listPlans: mockListPlans,
  countPendingPlans: mockCountPendingPlans,
  markPlanPending: mockMarkPlanPending,
  reviewPlan: mockReviewPlan,
  listStepsForPlans: mockListStepsForPlans,
}));
vi.mock('@/lib/repositories/plan-deviations.repository.js', () => ({
  listDeviationsForPlans: mockListDeviationsForPlans,
}));

const { POST, GET } = await import('@/api/plans/route.js');

// --- Helpers ---

function postReq(body: unknown) {
  return makeRequest('http://localhost:3000/api/plans', {
    headers: { 'x-api-key': 'oc_live_test' },
    body,
  });
}

function getReq(qs = '') {
  return makeRequest(`http://localhost:3000/api/plans${qs}`, {
    headers: { 'x-api-key': 'oc_live_test' },
  });
}

const validBody = {
  agent_id: 'agent_1',
  declared_goal: 'ship the feature',
  steps: [
    { action_type: 'deploy', step_goal: 'deploy service' },
    { action_type: 'code_change', step_goal: 'edit file' },
  ],
};

describe('POST /api/plans', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetOrgId.mockReturnValue('org_test');
    mockGetUserId.mockReturnValue('user_1');
    mockResolveAgentIdentity.mockImplementation(async (_req: unknown, opts: { agentId?: string | null } = {}) => ({
      agent_id: opts.agentId ?? null,
      agent_name: null,
      verification_status: 'unverified',
      verified: false,
      jti: null,
      verification: null,
    }));
    mockGetSettings.mockResolvedValue([]);
    mockCountPendingPlans.mockResolvedValue(0);
    mockMarkPlanPending.mockResolvedValue(null);
  });

  it('returns 400 when steps is missing', async () => {
    const { steps: _steps, ...rest } = validBody;
    const res = await POST(postReq(rest));
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toMatch(/steps/i);
    expect(mockCreatePlanWithSteps).not.toHaveBeenCalled();
  });

  it('returns 400 when steps is an empty array', async () => {
    const res = await POST(postReq({ ...validBody, steps: [] }));
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toMatch(/steps/i);
  });

  it('returns 400 when a step is missing action_type', async () => {
    const res = await POST(postReq({
      ...validBody,
      steps: [{ step_goal: 'no action type' }],
    }));
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toMatch(/action_type/i);
  });

  it('returns 400 when a step is missing step_goal', async () => {
    const res = await POST(postReq({
      ...validBody,
      steps: [{ action_type: 'deploy' }],
    }));
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toMatch(/step_goal/i);
  });

  it('returns 400 when a step act is not a plain object (scalar act), and never creates the plan', async () => {
    const res = await POST(postReq({
      ...validBody,
      steps: [{ action_type: 'deploy', step_goal: 'deploy service', act: 'not-an-object' }],
    }));
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toMatch(/steps\[0\]\.act must be an object/);
    expect(mockCreatePlanWithSteps).not.toHaveBeenCalled();
  });

  it('returns 400 when steps.length exceeds PLAN_MAX_STEPS', async () => {
    mockGetSettings.mockResolvedValueOnce([{ key: 'PLAN_MAX_STEPS', value: '1' }]);

    const res = await POST(postReq(validBody)); // 2 steps > cap of 1
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toMatch(/PLAN_MAX_STEPS/);
    expect(mockCreatePlanWithSteps).not.toHaveBeenCalled();
  });

  it('S3: a PLAN_MAX_STEPS setting above the hard ceiling still caps at 25, never widens it', async () => {
    mockGetSettings.mockResolvedValueOnce([{ key: 'PLAN_MAX_STEPS', value: '100' }]);
    const steps = Array.from({ length: 26 }, (_, i) => ({ action_type: 'deploy', step_goal: `step ${i}` }));

    const res = await POST(postReq({ ...validBody, steps }));
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toMatch(/25-step cap/);
    expect(mockCreatePlanWithSteps).not.toHaveBeenCalled();
  });

  it('returns 409 when there are already 10 pending plans', async () => {
    mockCountPendingPlans.mockResolvedValueOnce(10);

    const res = await POST(postReq(validBody));
    const data = await res.json();

    expect(res.status).toBe(409);
    expect(data.error).toMatch(/pending plans/i);
    expect(mockCreatePlanWithSteps).not.toHaveBeenCalled();
  });

  it('R3: returns 409 when createPlanWithSteps returns null (SQL-enforced cap lost a race the pre-read missed)', async () => {
    mockCreatePlanWithSteps.mockResolvedValueOnce(null);

    const res = await POST(postReq(validBody));
    const data = await res.json();

    expect(res.status).toBe(409);
    expect(data.error).toMatch(/pending plans/i);
    expect(mockEvaluateGuard).not.toHaveBeenCalled();
  });

  it('happy path: creates the plan, dry-runs every step through evaluateGuard with simulate:true, and stamps previews', async () => {
    const planRow = {
      plan_id: 'pa_1234567890abcdef', org_id: 'org_test', agent_id: 'agent_1',
      declared_goal: 'ship the feature', status: 'pending', ttl_minutes: 60,
      created_by: 'user_1',
    };
    const stepRows = [
      { step_id: 'ps_1111111111111111', plan_id: planRow.plan_id, seq: 1, action_type: 'deploy', step_goal: 'deploy service', act: null },
      { step_id: 'ps_2222222222222222', plan_id: planRow.plan_id, seq: 2, action_type: 'code_change', step_goal: 'edit file', act: null },
    ];
    mockCreatePlanWithSteps.mockResolvedValueOnce({ plan: planRow, steps: stepRows });
    mockEvaluateGuard.mockResolvedValue({ decision: 'allow', risk_score: 12, reasons: [], simulated: true });

    const res = await POST(postReq(validBody));
    const data = await res.json();

    expect(res.status).toBe(201);
    const { created_by: _createdBy, ...planRowWithoutCreatedBy } = planRow;
    expect(data.plan).toEqual(planRowWithoutCreatedBy);
    expect(data.plan).not.toHaveProperty('created_by');
    expect(data.steps).toHaveLength(2);

    // evaluateGuard called once per step, simulate:true, with a plain preview
    // context — no signature/jwt/jti fields.
    expect(mockEvaluateGuard).toHaveBeenCalledTimes(2);
    expect(mockEvaluateGuard).toHaveBeenNthCalledWith(
      1, 'org_test',
      { agent_id: 'agent_1', action_type: 'deploy', declared_goal: 'deploy service' },
      mockGetSql, { simulate: true },
    );
    expect(mockEvaluateGuard).toHaveBeenNthCalledWith(
      2, 'org_test',
      { agent_id: 'agent_1', action_type: 'code_change', declared_goal: 'edit file' },
      mockGetSql, { simulate: true },
    );

    // Previews stamped per step with the real evaluateGuard result field names.
    expect(mockStampStepPreview).toHaveBeenCalledWith(
      mockGetSql, 'org_test', 'ps_1111111111111111',
      { decision: 'allow', riskScore: 12, reasons: [] },
    );
    expect(mockStampStepPreview).toHaveBeenCalledWith(
      mockGetSql, 'org_test', 'ps_2222222222222222',
      { decision: 'allow', riskScore: 12, reasons: [] },
    );

    expect(mockPublishOrgEvent).toHaveBeenCalledWith(
      'action.updated', expect.objectContaining({ orgId: 'org_test', plan: planRowWithoutCreatedBy }),
    );
    // X3: created_by must not escape into the event payload either.
    const eventPayload = mockPublishOrgEvent.mock.calls[0]![1] as { plan: Record<string, unknown> };
    expect(eventPayload.plan).not.toHaveProperty('created_by');

    // T1: SoD — the submitting principal is stamped as created_by so the
    // review route can reject reviewer === created_by.
    expect(mockCreatePlanWithSteps).toHaveBeenCalledWith(
      mockGetSql, 'org_test', expect.objectContaining({ createdBy: 'user_1' }),
    );
  });

  // U4: the plan is inserted as 'previewing' (createPlanWithSteps) and the
  // route flips it to 'pending' once every step has a stamped preview — the
  // 'pending' row markPlanPending returns is what the response/event carry,
  // not the pre-flip 'previewing' row createPlanWithSteps returned.
  it('U4: flips the plan to pending via markPlanPending after the preview loop, and returns the flipped row', async () => {
    const previewingPlan = {
      plan_id: 'pa_1234567890abcdef', org_id: 'org_test', agent_id: 'agent_1',
      declared_goal: 'ship the feature', status: 'previewing', ttl_minutes: 60,
    };
    const pendingPlan = { ...previewingPlan, status: 'pending' };
    const stepRows = [
      { step_id: 'ps_1111111111111111', plan_id: previewingPlan.plan_id, seq: 1, action_type: 'deploy', step_goal: 'deploy service', act: null },
      { step_id: 'ps_2222222222222222', plan_id: previewingPlan.plan_id, seq: 2, action_type: 'code_change', step_goal: 'edit file', act: null },
    ];
    mockCreatePlanWithSteps.mockResolvedValueOnce({ plan: previewingPlan, steps: stepRows });
    mockEvaluateGuard.mockResolvedValue({ decision: 'allow', risk_score: 12, reasons: [], simulated: true });
    mockMarkPlanPending.mockResolvedValueOnce(pendingPlan);

    const res = await POST(postReq(validBody));
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(data.plan).toEqual(pendingPlan);
    expect(mockMarkPlanPending).toHaveBeenCalledWith(mockGetSql, 'org_test', previewingPlan.plan_id);
    expect(mockPublishOrgEvent).toHaveBeenCalledWith(
      'action.updated', expect.objectContaining({ orgId: 'org_test', plan: pendingPlan }),
    );
  });

  // U4: a concurrent revoke/expiry can beat markPlanPending's SQL-guarded
  // UPDATE (status='previewing' precondition) — the route must fall back to
  // the pre-flip row rather than fabricate a 'pending' plan that was never
  // actually reachable.
  it('U4: falls back to the previewing plan row when markPlanPending loses its status race', async () => {
    const previewingPlan = { plan_id: 'pa_1234567890abcdef', status: 'previewing' };
    mockCreatePlanWithSteps.mockResolvedValueOnce({
      plan: previewingPlan,
      steps: [{ step_id: 'ps_1', seq: 1, action_type: 'deploy', step_goal: 'deploy service', act: null }],
    });
    mockEvaluateGuard.mockResolvedValue({ decision: 'allow', risk_score: 12, reasons: [], simulated: true });
    mockMarkPlanPending.mockResolvedValueOnce(null);

    const res = await POST(postReq(validBody));
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(data.plan).toEqual(previewingPlan);
  });

  // X1: an unattributed request (empty x-user-id, e.g. the OAuth Bearer auth
  // channel) must not insert a principal-less created_by NULL row — that
  // would make the SoD reviewer!==created_by gate an unconditional no-op for
  // the row. Fail closed instead, mirroring the review route's
  // APPROVER_IDENTITY_REQUIRED guard.
  it('X1: returns 403 SUBMITTER_IDENTITY_REQUIRED when the request carries no attributable principal, and never creates the plan', async () => {
    mockGetUserId.mockReturnValueOnce('');

    const res = await POST(postReq(validBody));
    const data = await res.json();

    expect(res.status).toBe(403);
    expect(data.code).toBe('SUBMITTER_IDENTITY_REQUIRED');
    expect(mockCreatePlanWithSteps).not.toHaveBeenCalled();
  });

  it('T4: dry-runs against the RAW act from the request body, not the stored/redacted step act', async () => {
    const rawAct = { kind: 'shell', command: 'echo hello' };
    const redactedAct = { kind: 'shell', command: '[REDACTED:example]' };
    const planRow = { plan_id: 'pa_1234567890abcdef' };
    const stepRows = [
      { step_id: 'ps_1111111111111111', plan_id: planRow.plan_id, seq: 1, action_type: 'deploy', step_goal: 'deploy service', act: redactedAct },
    ];
    mockCreatePlanWithSteps.mockResolvedValueOnce({ plan: planRow, steps: stepRows });
    mockEvaluateGuard.mockResolvedValue({ decision: 'allow', risk_score: 12, reasons: [], simulated: true });

    await POST(postReq({
      ...validBody,
      steps: [{ action_type: 'deploy', step_goal: 'deploy service', act: rawAct }],
    }));

    expect(mockEvaluateGuard).toHaveBeenCalledWith(
      'org_test',
      expect.objectContaining({ act: rawAct }),
      mockGetSql, { simulate: true },
    );
    // The stored/displayed step keeps its redacted copy — evaluateGuard never
    // saw it.
    expect(mockEvaluateGuard).not.toHaveBeenCalledWith(
      'org_test',
      expect.objectContaining({ act: redactedAct }),
      mockGetSql, { simulate: true },
    );
  });

  // X4: reasons can quote act content; the stored act is already redacted
  // (S2), so a secret-shaped string surfacing in a preview reason must be
  // redacted the same way before it's stamped — and before it reaches the
  // response, or the response would leak what the stamp just redacted.
  // Uses AWS's own published example key (same split-join convention as
  // security-scanner.test.js) so this isn't flagged as a real credential.
  it('X4: a secret-shaped preview reason is redacted before stampStepPreview and in the response', async () => {
    const TEST_AWS_KEY = ['AKIA', 'IOSFODNN7EXAMPLE'].join('');
    const planRow = { plan_id: 'pa_1234567890abcdef' };
    const stepRows = [
      { step_id: 'ps_1111111111111111', plan_id: planRow.plan_id, seq: 1, action_type: 'deploy', step_goal: 'deploy service', act: null },
    ];
    mockCreatePlanWithSteps.mockResolvedValueOnce({ plan: planRow, steps: stepRows });
    mockEvaluateGuard.mockResolvedValueOnce({
      decision: 'warn', risk_score: 40,
      reasons: [`act contains ${TEST_AWS_KEY}`],
      simulated: true,
    });

    const res = await POST(postReq(validBody));
    const data = await res.json();

    expect(res.status).toBe(201);
    expect(mockStampStepPreview).toHaveBeenCalledWith(
      mockGetSql, 'org_test', 'ps_1111111111111111',
      { decision: 'warn', riskScore: 40, reasons: ['act contains [REDACTED:aws_access_key]'] },
    );
    expect(data.steps[0].preview_reasons).toEqual(['act contains [REDACTED:aws_access_key]']);
  });

  it('returns 500 on unexpected error', async () => {
    mockCreatePlanWithSteps.mockRejectedValueOnce(new Error('DB down'));

    const res = await POST(postReq(validBody));
    const data = await res.json();

    expect(res.status).toBe(500);
    expect(data.error).toMatch(/internal server error/i);
  });

  // U5: ttl_minutes must never reach the DB (or become a grant's effective
  // lifetime) unclamped — an int4 overflow / absurd value clamps to 480.
  it('U5: clamps an oversized ttl_minutes (3e9) to 480 at parse', async () => {
    mockCreatePlanWithSteps.mockResolvedValueOnce({
      plan: { plan_id: 'pa_1234567890abcdef', status: 'previewing' },
      steps: [{ step_id: 'ps_1', seq: 1, action_type: 'deploy', step_goal: 'deploy service', act: null }],
    });
    mockEvaluateGuard.mockResolvedValue({ decision: 'allow', risk_score: 12, reasons: [], simulated: true });

    const res = await POST(postReq({ ...validBody, ttl_minutes: 3e9 }));

    expect(res.status).toBe(201);
    expect(mockCreatePlanWithSteps).toHaveBeenCalledWith(
      mockGetSql, 'org_test', expect.objectContaining({ ttlMinutes: 480 }),
    );
  });

  it('U5: clamps a zero/negative ttl_minutes up to the 1-minute floor', async () => {
    mockCreatePlanWithSteps.mockResolvedValueOnce({
      plan: { plan_id: 'pa_1234567890abcdef', status: 'previewing' },
      steps: [{ step_id: 'ps_1', seq: 1, action_type: 'deploy', step_goal: 'deploy service', act: null }],
    });
    mockEvaluateGuard.mockResolvedValue({ decision: 'allow', risk_score: 12, reasons: [], simulated: true });

    const res = await POST(postReq({ ...validBody, ttl_minutes: -5 }));

    expect(res.status).toBe(201);
    expect(mockCreatePlanWithSteps).toHaveBeenCalledWith(
      mockGetSql, 'org_test', expect.objectContaining({ ttlMinutes: 1 }),
    );
  });

  // V4: a plan that dies mid-preview must not sit forever in 'previewing',
  // silently holding a pending-plan cap slot — a best-effort system-attributed
  // revoke runs before the original error is rethrown as the route's 500.
  it('V4: a throwing preview step best-effort revokes the previewing plan before rethrowing', async () => {
    const planRow = { plan_id: 'pa_1234567890abcdef', status: 'previewing' };
    mockCreatePlanWithSteps.mockResolvedValueOnce({
      plan: planRow,
      steps: [{ step_id: 'ps_1', plan_id: planRow.plan_id, seq: 1, action_type: 'deploy', step_goal: 'deploy service', act: null }],
    });
    mockEvaluateGuard.mockRejectedValueOnce(new Error('guard blew up'));
    mockReviewPlan.mockResolvedValueOnce({ plan: { ...planRow, status: 'revoked' }, steps: [] });

    const res = await POST(postReq(validBody));
    const data = await res.json();

    expect(res.status).toBe(500);
    expect(data.error).toMatch(/internal server error/i);
    expect(mockReviewPlan).toHaveBeenCalledWith(
      mockGetSql, 'org_test', planRow.plan_id,
      { verdict: 'revoke', reviewedBy: 'system:preview-failure', ttlClampMinutes: 480 },
    );
    expect(mockMarkPlanPending).not.toHaveBeenCalled();
  });

  it('V4: if the best-effort revoke itself throws, the original preview error still surfaces as the 500', async () => {
    const planRow = { plan_id: 'pa_1234567890abcdef', status: 'previewing' };
    mockCreatePlanWithSteps.mockResolvedValueOnce({
      plan: planRow,
      steps: [{ step_id: 'ps_1', plan_id: planRow.plan_id, seq: 1, action_type: 'deploy', step_goal: 'deploy service', act: null }],
    });
    mockEvaluateGuard.mockRejectedValueOnce(new Error('guard blew up'));
    mockReviewPlan.mockRejectedValueOnce(new Error('revoke also failed'));

    const res = await POST(postReq(validBody));
    const data = await res.json();

    expect(res.status).toBe(500);
    expect(data.error).toMatch(/internal server error/i);
  });

  // V6: bounds the preview loop's whole wall clock, not just each step's own
  // guard-evaluation deadline — once the budget is spent, remaining steps
  // ship un-previewed (the review card already renders "no preview" for a
  // step with no preview_decision) and the route still completes with 201.
  it('V6: steps beyond the preview budget ship with no preview, and the route still 201s', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1000);
      const planRow = { plan_id: 'pa_1234567890abcdef', status: 'previewing' };
      const stepRows = [
        { step_id: 'ps_1', plan_id: planRow.plan_id, seq: 1, action_type: 'deploy', step_goal: 'step 1', act: null },
        { step_id: 'ps_2', plan_id: planRow.plan_id, seq: 2, action_type: 'deploy', step_goal: 'step 2', act: null },
        { step_id: 'ps_3', plan_id: planRow.plan_id, seq: 3, action_type: 'deploy', step_goal: 'step 3', act: null },
      ];
      mockCreatePlanWithSteps.mockResolvedValueOnce({ plan: planRow, steps: stepRows });
      // The first (and only) evaluateGuard call jumps system time past the
      // 20s budget before resolving, so the loop's next budget check sees it.
      mockEvaluateGuard.mockImplementation(async () => {
        vi.setSystemTime(Date.now() + 25000);
        return { decision: 'allow', risk_score: 5, reasons: [], simulated: true };
      });
      mockMarkPlanPending.mockResolvedValueOnce({ ...planRow, status: 'pending' });

      const res = await POST(postReq({
        ...validBody,
        steps: [
          { action_type: 'deploy', step_goal: 'step 1' },
          { action_type: 'deploy', step_goal: 'step 2' },
          { action_type: 'deploy', step_goal: 'step 3' },
        ],
      }));
      const data = await res.json();

      expect(res.status).toBe(201);
      expect(mockEvaluateGuard).toHaveBeenCalledTimes(1);
      expect(data.steps).toHaveLength(3);
      expect(data.steps[0].preview_decision).toBe('allow');
      expect(data.steps[1].preview_decision).toBeUndefined();
      expect(data.steps[2].preview_decision).toBeUndefined();
      expect(mockMarkPlanPending).toHaveBeenCalledWith(mockGetSql, 'org_test', planRow.plan_id);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('GET /api/plans', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetOrgId.mockReturnValue('org_test');
  });

  it('returns the listPlans result', async () => {
    const plans = [{ plan_id: 'pa_1', status: 'pending' }, { plan_id: 'pa_2', status: 'approved' }];
    mockListPlans.mockResolvedValueOnce(plans);

    const res = await GET(getReq('?status=pending&agent_id=agent_1&limit=10'));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.plans).toEqual(plans);
    expect(mockListPlans).toHaveBeenCalledWith(
      mockGetSql, 'org_test',
      { status: 'pending', agentId: 'agent_1', limit: 10 },
    );
  });

  it('R4: clamps a negative limit to the 1..200 range instead of passing a negative LIMIT to SQL', async () => {
    mockListPlans.mockResolvedValueOnce([]);

    const res = await GET(getReq('?limit=-5'));

    // -5 is truthy so it survives the `|| 50` fallback; Math.max floors it at 1.
    expect(res.status).toBe(200);
    expect(mockListPlans).toHaveBeenCalledWith(
      mockGetSql, 'org_test',
      expect.objectContaining({ limit: 1 }),
    );
  });

  // V7: created_by is a reviewer/creator principal — never leak it to an
  // agent-facing GET (reviewed_by stays; it's intentional approver
  // attribution).
  it('V7: strips created_by from every plan in the response, keeps reviewed_by', async () => {
    mockListPlans.mockResolvedValueOnce([
      { plan_id: 'pa_1', status: 'pending', created_by: 'user_submitter', reviewed_by: null },
      { plan_id: 'pa_2', status: 'approved', created_by: 'user_other', reviewed_by: 'user_1' },
    ]);

    const res = await GET(getReq());
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.plans).toHaveLength(2);
    for (const plan of data.plans) {
      expect(plan).not.toHaveProperty('created_by');
    }
    expect(data.plans[1].reviewed_by).toBe('user_1');
  });

  // FIX A (2026-09-04): expand=details batches steps/deviations into ONE
  // extra call each, regardless of how many plans are on the page — this is
  // what replaced the approvals page's one GET /api/plans/{planId} per plan.
  it('expand=details returns steps and deviations for every plan using exactly 2 extra calls, regardless of plan count', async () => {
    const plans = [
      { plan_id: 'pa_1', status: 'pending' },
      { plan_id: 'pa_2', status: 'pending' },
      { plan_id: 'pa_3', status: 'pending' },
    ];
    mockListPlans.mockResolvedValueOnce(plans);
    mockListStepsForPlans.mockResolvedValueOnce([
      { step_id: 'ps_1', plan_id: 'pa_1', seq: 1 },
      { step_id: 'ps_2', plan_id: 'pa_2', seq: 1 },
    ]);
    mockListDeviationsForPlans.mockResolvedValueOnce([
      { deviation_id: 'dv_1', plan_id: 'pa_2' },
    ]);

    const res = await GET(getReq('?status=pending&expand=details'));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(mockListStepsForPlans).toHaveBeenCalledTimes(1);
    expect(mockListDeviationsForPlans).toHaveBeenCalledTimes(1);
    expect(mockListStepsForPlans).toHaveBeenCalledWith(mockGetSql, 'org_test', ['pa_1', 'pa_2', 'pa_3']);
    expect(mockListDeviationsForPlans).toHaveBeenCalledWith(mockGetSql, 'org_test', ['pa_1', 'pa_2', 'pa_3']);

    expect(data.plans).toHaveLength(3);
    expect(data.plans[0]).toEqual({
      plan: { plan_id: 'pa_1', status: 'pending' },
      steps: [{ step_id: 'ps_1', plan_id: 'pa_1', seq: 1 }],
      deviations: [],
    });
    expect(data.plans[1]).toEqual({
      plan: { plan_id: 'pa_2', status: 'pending' },
      steps: [{ step_id: 'ps_2', plan_id: 'pa_2', seq: 1 }],
      deviations: [{ deviation_id: 'dv_1', plan_id: 'pa_2' }],
    });
    expect(data.plans[2]).toEqual({
      plan: { plan_id: 'pa_3', status: 'pending' },
      steps: [],
      deviations: [],
    });
  });

  it('without expand, the response stays the flat { plans } shape and never calls the batched helpers', async () => {
    const plans = [{ plan_id: 'pa_1', status: 'pending' }];
    mockListPlans.mockResolvedValueOnce(plans);

    const res = await GET(getReq('?status=pending'));
    const data = await res.json();

    expect(data.plans).toEqual(plans);
    expect(mockListStepsForPlans).not.toHaveBeenCalled();
    expect(mockListDeviationsForPlans).not.toHaveBeenCalled();
  });

  it('expand=details: a deviations read failure logs and yields [] rather than failing the response', async () => {
    mockListPlans.mockResolvedValueOnce([{ plan_id: 'pa_1', status: 'pending' }]);
    mockListStepsForPlans.mockResolvedValueOnce([]);
    mockListDeviationsForPlans.mockRejectedValueOnce(new Error('deviations table down'));

    const res = await GET(getReq('?status=pending&expand=details'));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.plans[0].deviations).toEqual([]);
  });
});
