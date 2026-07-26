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
  mockResolveAgentIdentity,
  mockPublishOrgEvent,
  mockEvaluateGuard,
  mockGetSettings,
  mockCreatePlanWithSteps,
  mockStampStepPreview,
  mockListPlans,
  mockCountPendingPlans,
} = vi.hoisted(() => ({
  mockGetSql: vi.fn(),
  mockGetOrgId: vi.fn(() => 'org_test'),
  mockResolveAgentIdentity: vi.fn(async (_req: unknown, opts: { agentId?: string | null } = {}) => ({
    agent_id: opts.agentId ?? null,
    agent_name: null,
    verification_status: 'unverified',
    verified: false,
    jti: null,
    verification: null,
  })),
  mockPublishOrgEvent: vi.fn(() => Promise.resolve()),
  mockEvaluateGuard: vi.fn(),
  mockGetSettings: vi.fn(async () => [] as Array<{ key: string; value: string }>),
  mockCreatePlanWithSteps: vi.fn(),
  mockStampStepPreview: vi.fn(async () => {}),
  mockListPlans: vi.fn(async () => [] as unknown[]),
  mockCountPendingPlans: vi.fn(async () => 0),
}));

vi.mock('@/lib/db.js', () => ({ getSql: () => mockGetSql }));
vi.mock('@/lib/org.js', () => ({ getOrgId: mockGetOrgId }));
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

  it('returns 400 when steps.length exceeds PLAN_MAX_STEPS', async () => {
    mockGetSettings.mockResolvedValueOnce([{ key: 'PLAN_MAX_STEPS', value: '1' }]);

    const res = await POST(postReq(validBody)); // 2 steps > cap of 1
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toMatch(/PLAN_MAX_STEPS/);
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

  it('happy path: creates the plan, dry-runs every step through evaluateGuard with simulate:true, and stamps previews', async () => {
    const planRow = {
      plan_id: 'pa_1234567890abcdef', org_id: 'org_test', agent_id: 'agent_1',
      declared_goal: 'ship the feature', status: 'pending', ttl_minutes: 60,
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
    expect(data.plan).toEqual(planRow);
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
      'action.updated', expect.objectContaining({ orgId: 'org_test', plan: planRow }),
    );
  });

  it('returns 500 on unexpected error', async () => {
    mockCreatePlanWithSteps.mockRejectedValueOnce(new Error('DB down'));

    const res = await POST(postReq(validBody));
    const data = await res.json();

    expect(res.status).toBe(500);
    expect(data.error).toMatch(/internal server error/i);
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
});
