// Preflight Plan Authorization (docs/rfcs/2026-07-06-preflight-plan-authorization.md).
// Route tests for GET|POST /api/plans/[planId]. Mock style copied from
// __tests__/unit/approvals-route.test.js (adapted to TS the way
// __tests__/unit/plans-route.test.ts does: vi.hoisted mocks used directly in
// vi.mock factories, and a typed makeRequest wrapper around the duck-typed
// helper).
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
  mockGetOrgRole,
  mockGetUserId,
  mockLogActivity,
  mockPublishOrgEvent,
  mockGetSettings,
  mockGetPlanWithSteps,
  mockReviewPlan,
  mockAmendPlanFromDeviation,
  mockListDeviationsForPlan,
  mockResolveDeviation,
} = vi.hoisted(() => ({
  mockGetSql: vi.fn(),
  mockGetOrgId: vi.fn(() => 'org_test'),
  mockGetOrgRole: vi.fn(() => 'admin'),
  mockGetUserId: vi.fn(() => 'user_1'),
  mockLogActivity: vi.fn(),
  mockPublishOrgEvent: vi.fn((_event: string, _payload: unknown) => Promise.resolve()),
  mockGetSettings: vi.fn(async () => [] as Array<{ key: string; value: string }>),
  mockGetPlanWithSteps: vi.fn(),
  mockReviewPlan: vi.fn(),
  mockAmendPlanFromDeviation: vi.fn(),
  mockListDeviationsForPlan: vi.fn(async () => [] as unknown[]),
  mockResolveDeviation: vi.fn(),
}));

// after() callbacks run immediately in tests (the route defers the
// approve/deny/revoke audit write through after() so Vercel can't drop it).
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>();
  return {
    ...actual,
    after: (cb: () => unknown) => {
      try {
        const r = cb();
        if (r && typeof (r as Promise<unknown>).catch === 'function') {
          (r as Promise<unknown>).catch(() => {});
        }
      } catch { /* deferred work must not sink the test request */ }
    },
  };
});
vi.mock('@/lib/db.js', () => ({ getSql: () => mockGetSql }));
vi.mock('@/lib/org.js', () => ({
  getOrgId: mockGetOrgId,
  getOrgRole: mockGetOrgRole,
  getUserId: mockGetUserId,
}));
vi.mock('@/lib/audit.js', () => ({ logActivity: mockLogActivity }));
vi.mock('@/lib/events.js', () => ({
  EVENTS: { ACTION_UPDATED: 'action.updated' },
  publishOrgEvent: mockPublishOrgEvent,
}));
vi.mock('@/lib/repositories/settings.repository.js', () => ({ getSettings: mockGetSettings }));
vi.mock('@/lib/repositories/plans.repository.js', () => ({
  getPlanWithSteps: mockGetPlanWithSteps,
  reviewPlan: mockReviewPlan,
  amendPlanFromDeviation: mockAmendPlanFromDeviation,
}));
vi.mock('@/lib/repositories/plan-deviations.repository.js', () => ({
  listDeviationsForPlan: mockListDeviationsForPlan,
  resolveDeviation: mockResolveDeviation,
  DEVIATION_RESOLUTIONS: ['acknowledged', 'accepted', 'rejected'],
}));

const { GET, POST } = await import('@/api/plans/[planId]/route.js');

// --- Helpers ---

const params = Promise.resolve({ planId: 'pa_1234567890abcdef' });

function getReq() {
  return makeRequest('http://localhost:3000/api/plans/pa_1234567890abcdef', {
    headers: { 'x-api-key': 'oc_live_test' },
  });
}

function postReq(body: unknown) {
  return makeRequest('http://localhost:3000/api/plans/pa_1234567890abcdef', {
    headers: { 'x-api-key': 'oc_live_test' },
    body,
  });
}

describe('GET /api/plans/[planId]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetOrgId.mockReturnValue('org_test');
  });

  it('returns 404 for an unknown plan', async () => {
    mockGetPlanWithSteps.mockResolvedValueOnce(null);

    const res = await GET(getReq(), { params });
    const data = await res.json();

    expect(res.status).toBe(404);
    expect(data.error).toMatch(/not found/i);
  });

  it('returns the plan with its steps', async () => {
    const plan = { plan_id: 'pa_1234567890abcdef', status: 'pending' };
    const steps = [{ step_id: 'ps_1', seq: 1 }];
    mockGetPlanWithSteps.mockResolvedValueOnce({ plan, steps });

    const res = await GET(getReq(), { params });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.plan).toEqual(plan);
    expect(data.steps).toEqual(steps);
    expect(mockGetPlanWithSteps).toHaveBeenCalledWith(mockGetSql, 'org_test', 'pa_1234567890abcdef');
  });

  // V7: created_by is a reviewer/creator principal — never leak it to an
  // agent-facing GET (reviewed_by stays; it's intentional approver
  // attribution).
  it('V7: strips created_by from the plan, keeps reviewed_by', async () => {
    const plan = {
      plan_id: 'pa_1234567890abcdef', status: 'approved',
      created_by: 'user_submitter', reviewed_by: 'user_1',
    };
    mockGetPlanWithSteps.mockResolvedValueOnce({ plan, steps: [] });

    const res = await GET(getReq(), { params });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.plan).not.toHaveProperty('created_by');
    expect(data.plan.reviewed_by).toBe('user_1');
  });
});

describe('POST /api/plans/[planId]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetOrgId.mockReturnValue('org_test');
    mockGetOrgRole.mockReturnValue('admin');
    mockGetUserId.mockReturnValue('user_1');
    mockGetSettings.mockResolvedValue([]);
  });

  it('rejects non-admin users with 403', async () => {
    mockGetOrgRole.mockReturnValueOnce('viewer');

    const res = await POST(postReq({ verdict: 'approve' }), { params });
    const data = await res.json();

    expect(res.status).toBe(403);
    expect(data.error).toMatch(/admin/i);
    expect(mockReviewPlan).not.toHaveBeenCalled();
  });

  it('rejects an unattributed reviewer (empty user id) with 403', async () => {
    mockGetUserId.mockReturnValueOnce('');

    const res = await POST(postReq({ verdict: 'approve' }), { params });
    const data = await res.json();

    expect(res.status).toBe(403);
    expect(data.code).toBe('APPROVER_IDENTITY_REQUIRED');
    expect(mockReviewPlan).not.toHaveBeenCalled();
  });

  // T1: separation of duties — the credential that submitted a plan cannot
  // approve it (mirrors approvals-route.test.js SELF_APPROVAL_FORBIDDEN).
  it('T1: rejects self-approval with 403 SELF_APPROVAL_FORBIDDEN when reviewer === created_by', async () => {
    mockGetPlanWithSteps.mockResolvedValueOnce({
      plan: { plan_id: 'pa_1234567890abcdef', status: 'pending', raw_status: 'pending', created_by: 'user_1' },
      steps: [],
    });

    const res = await POST(postReq({ verdict: 'approve' }), { params });
    const data = await res.json();

    expect(res.status).toBe(403);
    expect(data.code).toBe('SELF_APPROVAL_FORBIDDEN');
    expect(mockReviewPlan).not.toHaveBeenCalled();
  });

  it('T1: a different admin credential may approve a plan it did not submit', async () => {
    mockGetPlanWithSteps.mockResolvedValueOnce({
      plan: { plan_id: 'pa_1234567890abcdef', status: 'pending', raw_status: 'pending', created_by: 'user_submitter' },
      steps: [],
    });
    const plan = { plan_id: 'pa_1234567890abcdef', status: 'approved' };
    mockReviewPlan.mockResolvedValueOnce({ plan, steps: [] });

    const res = await POST(postReq({ verdict: 'approve' }), { params });

    expect(res.status).toBe(200);
    expect(mockReviewPlan).toHaveBeenCalled();
  });

  it("T1: 'operator' is exempt from the self-approval gate", async () => {
    mockGetUserId.mockReturnValueOnce('operator');
    mockGetPlanWithSteps.mockResolvedValueOnce({
      plan: { plan_id: 'pa_1234567890abcdef', status: 'pending', raw_status: 'pending', created_by: 'operator' },
      steps: [],
    });
    const plan = { plan_id: 'pa_1234567890abcdef', status: 'approved' };
    mockReviewPlan.mockResolvedValueOnce({ plan, steps: [] });

    const res = await POST(postReq({ verdict: 'approve' }), { params });

    expect(res.status).toBe(200);
    expect(mockReviewPlan).toHaveBeenCalled();
  });

  // X1(b): belt-and-braces — a principal-less legacy row (created_by NULL)
  // cannot prove separation of duties either way, so it fails closed to the
  // break-glass 'operator' principal instead of staying approvable by any
  // admin.
  it('X1(b): a NULL created_by plan cannot be approved by a normal admin — 403', async () => {
    mockGetPlanWithSteps.mockResolvedValueOnce({
      plan: { plan_id: 'pa_1234567890abcdef', status: 'pending', raw_status: 'pending', created_by: null },
      steps: [],
    });

    const res = await POST(postReq({ verdict: 'approve' }), { params });
    const data = await res.json();

    expect(res.status).toBe(403);
    expect(data.code).toBe('PRINCIPAL_LESS_PLAN_REQUIRES_OPERATOR');
    expect(mockReviewPlan).not.toHaveBeenCalled();
  });

  it("X1(b): a NULL created_by plan CAN be approved by 'operator'", async () => {
    mockGetUserId.mockReturnValueOnce('operator');
    mockGetPlanWithSteps.mockResolvedValueOnce({
      plan: { plan_id: 'pa_1234567890abcdef', status: 'pending', raw_status: 'pending', created_by: null },
      steps: [],
    });
    const plan = { plan_id: 'pa_1234567890abcdef', status: 'approved' };
    mockReviewPlan.mockResolvedValueOnce({ plan, steps: [] });

    const res = await POST(postReq({ verdict: 'approve' }), { params });

    expect(res.status).toBe(200);
    expect(mockReviewPlan).toHaveBeenCalled();
  });

  it('X1(b): a NULL created_by DENIED plan cannot have its denial lifted (revoke) by a normal admin — 403', async () => {
    mockGetPlanWithSteps.mockResolvedValueOnce({
      plan: { plan_id: 'pa_1234567890abcdef', status: 'denied', raw_status: 'denied', created_by: null },
      steps: [],
    });

    const res = await POST(postReq({ verdict: 'revoke' }), { params });
    const data = await res.json();

    expect(res.status).toBe(403);
    expect(data.code).toBe('PRINCIPAL_LESS_PLAN_REQUIRES_OPERATOR');
    expect(mockReviewPlan).not.toHaveBeenCalled();
  });

  it('X1(b): a NULL created_by plan CAN be denied (plain deny, not approve/deny-lift) by a normal admin', async () => {
    mockGetPlanWithSteps.mockResolvedValueOnce({
      plan: { plan_id: 'pa_1234567890abcdef', status: 'pending', raw_status: 'pending', created_by: null },
      steps: [],
    });
    const plan = { plan_id: 'pa_1234567890abcdef', status: 'denied' };
    mockReviewPlan.mockResolvedValueOnce({ plan, steps: [] });

    const res = await POST(postReq({ verdict: 'deny' }), { params });

    expect(res.status).toBe(200);
    expect(mockReviewPlan).toHaveBeenCalled();
  });

  it('T1: revoking your own LIVE (pending) plan is allowed — revoke only closes doors', async () => {
    mockGetPlanWithSteps.mockResolvedValueOnce({
      plan: { plan_id: 'pa_1234567890abcdef', status: 'pending', raw_status: 'pending', created_by: 'user_1' },
      steps: [],
    });
    const plan = { plan_id: 'pa_1234567890abcdef', status: 'revoked' };
    mockReviewPlan.mockResolvedValueOnce({ plan, steps: [] });

    const res = await POST(postReq({ verdict: 'revoke' }), { params });

    expect(res.status).toBe(200);
    expect(mockReviewPlan).toHaveBeenCalled();
  });

  // X2: self-deny is now gated too — with org-wide denial binding, a
  // submitter denying its own plan would plant an org-wide block with zero
  // second-party involvement, the same risk a self-approval carries.
  it('X2: rejects the submitter denying their own plan with 403 SELF_APPROVAL_FORBIDDEN', async () => {
    mockGetPlanWithSteps.mockResolvedValueOnce({
      plan: { plan_id: 'pa_1234567890abcdef', status: 'pending', raw_status: 'pending', created_by: 'user_1' },
      steps: [],
    });

    const res = await POST(postReq({ verdict: 'deny' }), { params });
    const data = await res.json();

    expect(res.status).toBe(403);
    expect(data.code).toBe('SELF_APPROVAL_FORBIDDEN');
    expect(mockReviewPlan).not.toHaveBeenCalled();
  });

  it('X2: a different admin credential may deny a plan it did not submit', async () => {
    mockGetPlanWithSteps.mockResolvedValueOnce({
      plan: { plan_id: 'pa_1234567890abcdef', status: 'pending', raw_status: 'pending', created_by: 'user_submitter' },
      steps: [],
    });
    const plan = { plan_id: 'pa_1234567890abcdef', status: 'denied' };
    mockReviewPlan.mockResolvedValueOnce({ plan, steps: [] });

    const res = await POST(postReq({ verdict: 'deny' }), { params });

    expect(res.status).toBe(200);
    expect(mockReviewPlan).toHaveBeenCalled();
  });

  it("X2: 'operator' is exempt from the self-deny gate too", async () => {
    mockGetUserId.mockReturnValueOnce('operator');
    mockGetPlanWithSteps.mockResolvedValueOnce({
      plan: { plan_id: 'pa_1234567890abcdef', status: 'pending', raw_status: 'pending', created_by: 'operator' },
      steps: [],
    });
    const plan = { plan_id: 'pa_1234567890abcdef', status: 'denied' };
    mockReviewPlan.mockResolvedValueOnce({ plan, steps: [] });

    const res = await POST(postReq({ verdict: 'deny' }), { params });

    expect(res.status).toBe(200);
    expect(mockReviewPlan).toHaveBeenCalled();
  });

  // W1: a denied submitter must not lift its own denial via revoke — revoking
  // a DENIED plan is the same privilege as approving (undoing an operator's
  // explicit no), so it needs a different principal too.
  it('W1: rejects the submitter revoking their own DENIED plan with 403 SELF_APPROVAL_FORBIDDEN (deny-lift message)', async () => {
    mockGetPlanWithSteps.mockResolvedValueOnce({
      plan: { plan_id: 'pa_1234567890abcdef', status: 'denied', raw_status: 'denied', created_by: 'user_1' },
      steps: [],
    });

    const res = await POST(postReq({ verdict: 'revoke' }), { params });
    const data = await res.json();

    expect(res.status).toBe(403);
    expect(data.code).toBe('SELF_APPROVAL_FORBIDDEN');
    expect(data.error).toMatch(/cannot lift its denial/i);
    expect(mockReviewPlan).not.toHaveBeenCalled();
  });

  it('W1: a different admin credential may revoke a DENIED plan it did not submit', async () => {
    mockGetPlanWithSteps.mockResolvedValueOnce({
      plan: { plan_id: 'pa_1234567890abcdef', status: 'denied', raw_status: 'denied', created_by: 'user_submitter' },
      steps: [],
    });
    const plan = { plan_id: 'pa_1234567890abcdef', status: 'revoked' };
    mockReviewPlan.mockResolvedValueOnce({ plan, steps: [] });

    const res = await POST(postReq({ verdict: 'revoke' }), { params });

    expect(res.status).toBe(200);
    expect(mockReviewPlan).toHaveBeenCalled();
  });

  it("W1: 'operator' is exempt from the deny-lift gate too", async () => {
    mockGetUserId.mockReturnValueOnce('operator');
    mockGetPlanWithSteps.mockResolvedValueOnce({
      plan: { plan_id: 'pa_1234567890abcdef', status: 'denied', raw_status: 'denied', created_by: 'operator' },
      steps: [],
    });
    const plan = { plan_id: 'pa_1234567890abcdef', status: 'revoked' };
    mockReviewPlan.mockResolvedValueOnce({ plan, steps: [] });

    const res = await POST(postReq({ verdict: 'revoke' }), { params });

    expect(res.status).toBe(200);
    expect(mockReviewPlan).toHaveBeenCalled();
  });

  it('W1: revoking your own approved plan (not denied) is still allowed — revoke only gates the denied-status case', async () => {
    mockGetPlanWithSteps.mockResolvedValueOnce({
      plan: { plan_id: 'pa_1234567890abcdef', status: 'approved', raw_status: 'approved', created_by: 'user_1' },
      steps: [],
    });
    const plan = { plan_id: 'pa_1234567890abcdef', status: 'revoked' };
    mockReviewPlan.mockResolvedValueOnce({ plan, steps: [] });

    const res = await POST(postReq({ verdict: 'revoke' }), { params });

    expect(res.status).toBe(200);
    expect(mockReviewPlan).toHaveBeenCalled();
  });

  it('rejects an invalid verdict with 400', async () => {
    const res = await POST(postReq({ verdict: 'maybe' }), { params });
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toMatch(/invalid verdict/i);
    expect(mockReviewPlan).not.toHaveBeenCalled();
  });

  it('returns 404 when reviewPlan returns null (missing or not reviewable)', async () => {
    mockReviewPlan.mockResolvedValueOnce(null);

    const res = await POST(postReq({ verdict: 'approve' }), { params });
    const data = await res.json();

    expect(res.status).toBe(404);
    expect(data.error).toMatch(/not found or not reviewable/i);
  });

  it('approves a pending plan, clamping TTL from the PLAN_GRANT_TTL_MAX_MINUTES setting', async () => {
    mockGetSettings.mockResolvedValueOnce([{ key: 'PLAN_GRANT_TTL_MAX_MINUTES', value: '30' }]);
    const plan = { plan_id: 'pa_1234567890abcdef', status: 'approved' };
    const steps = [{ step_id: 'ps_1', grant_status: 'approved' }];
    mockReviewPlan.mockResolvedValueOnce({ plan, steps });

    const res = await POST(postReq({ verdict: 'approve' }), { params });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.plan).toEqual(plan);
    expect(data.steps).toEqual(steps);
    expect(mockReviewPlan).toHaveBeenCalledWith(
      mockGetSql, 'org_test', 'pa_1234567890abcdef',
      { verdict: 'approve', stepOverrides: {}, reviewedBy: 'user_1', ttlClampMinutes: 30, denyLiftAllowed: false },
    );
  });

  it('falls back to the default 480-minute TTL clamp when PLAN_GRANT_TTL_MAX_MINUTES is unset', async () => {
    const plan = { plan_id: 'pa_1234567890abcdef', status: 'denied' };
    mockReviewPlan.mockResolvedValueOnce({ plan, steps: [] });

    await POST(postReq({ verdict: 'deny' }), { params });

    expect(mockReviewPlan).toHaveBeenCalledWith(
      mockGetSql, 'org_test', 'pa_1234567890abcdef',
      { verdict: 'deny', stepOverrides: {}, reviewedBy: 'user_1', ttlClampMinutes: 480, denyLiftAllowed: false },
    );
  });

  it('R2: PLAN_GRANT_TTL_MAX_MINUTES may only tighten the ceiling, never widen it — 99999 clamps to 480', async () => {
    mockGetSettings.mockResolvedValueOnce([{ key: 'PLAN_GRANT_TTL_MAX_MINUTES', value: '99999' }]);
    const plan = { plan_id: 'pa_1234567890abcdef', status: 'approved' };
    mockReviewPlan.mockResolvedValueOnce({ plan, steps: [] });

    await POST(postReq({ verdict: 'approve' }), { params });

    expect(mockReviewPlan).toHaveBeenCalledWith(
      mockGetSql, 'org_test', 'pa_1234567890abcdef',
      expect.objectContaining({ ttlClampMinutes: 480 }),
    );
  });

  it('rejects an unknown step_overrides value with 400 (fail-closed, never silently approves)', async () => {
    const res = await POST(postReq({ verdict: 'approve', step_overrides: { ps_1: 'yolo' } }), { params });
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toMatch(/step_overrides\.ps_1 must be "approve" or "deny"/);
    expect(mockReviewPlan).not.toHaveBeenCalled();
  });

  it('deny-lift precondition: a principal other than the submitter passes denyLiftAllowed: true into the SQL layer', async () => {
    mockGetPlanWithSteps.mockResolvedValueOnce({
      plan: { plan_id: 'pa_1234567890abcdef', status: 'denied', raw_status: 'denied', created_by: 'user_submitter' },
      steps: [],
    });
    const plan = { plan_id: 'pa_1234567890abcdef', status: 'revoked' };
    mockReviewPlan.mockResolvedValueOnce({ plan, steps: [] });

    await POST(postReq({ verdict: 'revoke' }), { params });

    expect(mockReviewPlan).toHaveBeenCalledWith(
      mockGetSql, 'org_test', 'pa_1234567890abcdef',
      expect.objectContaining({ denyLiftAllowed: true }),
    );
  });

  it('passes step_overrides through to reviewPlan', async () => {
    const plan = { plan_id: 'pa_1234567890abcdef', status: 'partially_approved' };
    mockReviewPlan.mockResolvedValueOnce({ plan, steps: [] });
    const stepOverrides = { ps_1: 'deny' };

    await POST(postReq({ verdict: 'approve', step_overrides: stepOverrides }), { params });

    expect(mockReviewPlan).toHaveBeenCalledWith(
      mockGetSql, 'org_test', 'pa_1234567890abcdef',
      expect.objectContaining({ stepOverrides }),
    );
  });

  it('publishes an org event and logs activity on verdict', async () => {
    const plan = { plan_id: 'pa_1234567890abcdef', status: 'revoked' };
    mockReviewPlan.mockResolvedValueOnce({ plan, steps: [] });

    await POST(postReq({ verdict: 'revoke' }), { params });

    expect(mockPublishOrgEvent).toHaveBeenCalledWith(
      'action.updated', expect.objectContaining({ orgId: 'org_test', plan }),
    );
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org_test', actorId: 'user_1', action: 'plan.revoked',
        resourceType: 'plan', resourceId: 'pa_1234567890abcdef',
      }),
      mockGetSql,
    );
  });

  // X3: created_by is a reviewer/creator principal — never leak it into the
  // org event payload either (mirrors W3's response strip). Previously the
  // response stripped it but publishOrgEvent still carried the raw row.
  it('X3: strips created_by from the org event payload, not just the response', async () => {
    mockGetPlanWithSteps.mockResolvedValueOnce({
      plan: { plan_id: 'pa_1234567890abcdef', status: 'pending', raw_status: 'pending', created_by: 'user_submitter' },
      steps: [],
    });
    const plan = { plan_id: 'pa_1234567890abcdef', status: 'approved', created_by: 'user_submitter', reviewed_by: 'user_1' };
    mockReviewPlan.mockResolvedValueOnce({ plan, steps: [] });

    const res = await POST(postReq({ verdict: 'approve' }), { params });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.plan).not.toHaveProperty('created_by');
    const eventPayload = mockPublishOrgEvent.mock.calls[0]![1] as { plan: Record<string, unknown> };
    expect(eventPayload.plan).not.toHaveProperty('created_by');
    expect(eventPayload.plan.reviewed_by).toBe('user_1');
  });

  it('returns 500 on unexpected error', async () => {
    mockReviewPlan.mockRejectedValueOnce(new Error('DB down'));

    const res = await POST(postReq({ verdict: 'approve' }), { params });
    const data = await res.json();

    expect(res.status).toBe(500);
    expect(data.error).toMatch(/internal server error/i);
  });
});

// Plan deviation events (docs/rfcs/2026-08-11-plan-deviation-events.md §7):
// deviations ride the GET payload; resolve_deviation folds into POST.
describe('GET /api/plans/[planId] — deviations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetOrgId.mockReturnValue('org_test');
  });

  it('attaches deviations[] beside plan/steps', async () => {
    mockGetPlanWithSteps.mockResolvedValueOnce({
      plan: { plan_id: 'pa_1234567890abcdef', status: 'approved' },
      steps: [],
    });
    mockListDeviationsForPlan.mockResolvedValueOnce([{ deviation_id: 'dv_1', kind: 'act_substitution' }]);

    const res = await GET(getReq(), { params });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.deviations).toEqual([{ deviation_id: 'dv_1', kind: 'act_substitution' }]);
  });

  it('a deviations read failure does not break the plan poll', async () => {
    mockGetPlanWithSteps.mockResolvedValueOnce({
      plan: { plan_id: 'pa_1234567890abcdef', status: 'approved' },
      steps: [],
    });
    mockListDeviationsForPlan.mockRejectedValueOnce(new Error('table missing'));

    const res = await GET(getReq(), { params });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.deviations).toEqual([]);
  });
});

describe('POST /api/plans/[planId] — resolve_deviation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetOrgId.mockReturnValue('org_test');
    mockGetOrgRole.mockReturnValue('admin');
    mockGetUserId.mockReturnValue('user_1');
  });

  it('resolves a deviation plan-scoped and returns it', async () => {
    mockResolveDeviation.mockResolvedValueOnce({ deviation_id: 'dv_1', status: 'acknowledged' });

    const res = await POST(postReq({ verdict: 'resolve_deviation', deviation_id: 'dv_1', resolution: 'acknowledged' }), { params });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.deviation.status).toBe('acknowledged');
    expect(mockResolveDeviation).toHaveBeenCalledWith(mockGetSql, 'org_test', 'dv_1',
      expect.objectContaining({ resolution: 'acknowledged', resolvedBy: 'user_1', planId: 'pa_1234567890abcdef' }));
    // resolution never touches the plan review machinery
    expect(mockReviewPlan).not.toHaveBeenCalled();
  });

  it('400 on a missing or invalid resolution', async () => {
    const res = await POST(postReq({ verdict: 'resolve_deviation', deviation_id: 'dv_1', resolution: 'promoted' }), { params });
    expect(res.status).toBe(400);
    expect(mockResolveDeviation).not.toHaveBeenCalled();
  });

  it('400 when amend_plan rides a non-accepted resolution', async () => {
    const res = await POST(postReq({ verdict: 'resolve_deviation', deviation_id: 'dv_1', resolution: 'rejected', amend_plan: true }), { params });
    expect(res.status).toBe(400);
  });

  it('404 when the deviation is not on this plan or already resolved', async () => {
    mockResolveDeviation.mockResolvedValueOnce(null);
    const res = await POST(postReq({ verdict: 'resolve_deviation', deviation_id: 'dv_x', resolution: 'accepted' }), { params });
    expect(res.status).toBe(404);
  });

  it('SoD: the submitter cannot accept-and-amend its own plan', async () => {
    mockGetPlanWithSteps.mockResolvedValueOnce({
      plan: { plan_id: 'pa_1234567890abcdef', created_by: 'user_1', raw_status: 'approved' },
      steps: [],
    });
    const res = await POST(postReq({ verdict: 'resolve_deviation', deviation_id: 'dv_1', resolution: 'accepted', amend_plan: true }), { params });
    const data = await res.json();

    expect(res.status).toBe(403);
    expect(data.code).toBe('SELF_APPROVAL_FORBIDDEN');
    expect(mockResolveDeviation).not.toHaveBeenCalled();
    expect(mockAmendPlanFromDeviation).not.toHaveBeenCalled();
  });

  it('accept-and-amend by a different principal resolves AND appends the approved step', async () => {
    mockGetPlanWithSteps.mockResolvedValueOnce({
      plan: { plan_id: 'pa_1234567890abcdef', created_by: 'user_2', raw_status: 'approved' },
      steps: [],
    });
    mockResolveDeviation.mockResolvedValueOnce({
      deviation_id: 'dv_1', status: 'accepted',
      observed: { action_type: 'deploy', declared_goal: 'deploy prod' },
    });
    mockAmendPlanFromDeviation.mockResolvedValueOnce({ step_id: 'ps_new', grant_status: 'approved' });

    const res = await POST(postReq({ verdict: 'resolve_deviation', deviation_id: 'dv_1', resolution: 'accepted', amend_plan: true }), { params });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.amended_step.step_id).toBe('ps_new');
    expect(mockAmendPlanFromDeviation).toHaveBeenCalled();
  });
});
