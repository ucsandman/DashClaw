// Containment Verdicts (RFC 2026-07-06, drizzle/0064). Route tests for
// POST /api/actions/[actionId]/containment. Mock style copied from
// __tests__/unit/plans-review-route.test.ts (vi.hoisted mocks used directly
// in vi.mock factories, typed makeRequest wrapper around the duck-typed
// helper). buildPromotionGoal/buildPromotionAct are used FOR REAL (not
// mocked) so the assertions verify the route calls the actual canonical
// builders, not a test double standing in for them.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRequest as rawRequest } from '../helpers.js';
import { buildPromotionGoal, buildPromotionAct } from '../../app/lib/guard/containment';
import { computeActContentHash } from '../../app/lib/act-content-hash';

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
  mockGetActionStatus,
  mockResolveContainment,
  mockCreateActionRecord,
  mockStampPromotionApproval,
  mockFindUnconsumedPromotionGrant,
} = vi.hoisted(() => ({
  mockGetSql: vi.fn(),
  mockGetOrgId: vi.fn(() => 'org_test'),
  mockGetOrgRole: vi.fn(() => 'admin'),
  mockGetUserId: vi.fn(() => 'user_1'),
  mockGetActionStatus: vi.fn(),
  mockResolveContainment: vi.fn(),
  mockCreateActionRecord: vi.fn(),
  mockStampPromotionApproval: vi.fn(),
  mockFindUnconsumedPromotionGrant: vi.fn(),
}));

vi.mock('@/lib/db.js', () => ({ getSql: () => mockGetSql }));
vi.mock('@/lib/org.js', () => ({
  getOrgId: mockGetOrgId,
  getOrgRole: mockGetOrgRole,
  getUserId: mockGetUserId,
}));
vi.mock('@/lib/repositories/actions.repository.js', () => ({
  getActionStatus: mockGetActionStatus,
  resolveContainment: mockResolveContainment,
  createActionRecord: mockCreateActionRecord,
  stampPromotionApproval: mockStampPromotionApproval,
  findUnconsumedPromotionGrant: mockFindUnconsumedPromotionGrant,
}));

const { POST } = await import('@/api/actions/[actionId]/containment/route.js');

const params = Promise.resolve({ actionId: 'act_123' });

function postReq(body: unknown): Request {
  return makeRequest('http://localhost:3000/api/actions/act_123/containment', {
    headers: { 'x-api-key': 'oc_live_test' },
    body,
  });
}

describe('POST /api/actions/[actionId]/containment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetOrgId.mockReturnValue('org_test');
    mockGetOrgRole.mockReturnValue('admin');
    mockGetUserId.mockReturnValue('user_1');
  });

  it('rejects non-admin roles with 403', async () => {
    mockGetOrgRole.mockReturnValueOnce('viewer');

    const res = await POST(postReq({ verdict: 'promote' }), { params });

    expect(res.status).toBe(403);
    expect(mockGetActionStatus).not.toHaveBeenCalled();
    expect(mockResolveContainment).not.toHaveBeenCalled();
  });

  it('rejects an unattributed principal (empty userId) with 403 APPROVER_IDENTITY_REQUIRED', async () => {
    mockGetUserId.mockReturnValueOnce('');

    const res = await POST(postReq({ verdict: 'promote' }), { params });
    const data = await res.json();

    expect(res.status).toBe(403);
    expect(data.code).toBe('APPROVER_IDENTITY_REQUIRED');
    expect(mockResolveContainment).not.toHaveBeenCalled();
  });

  it('rejects an invalid verdict with 400', async () => {
    const res = await POST(postReq({ verdict: 'maybe' }), { params });
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.error).toMatch(/invalid verdict/i);
    expect(mockGetActionStatus).not.toHaveBeenCalled();
    expect(mockResolveContainment).not.toHaveBeenCalled();
  });

  it('returns 404 when the action does not exist', async () => {
    mockGetActionStatus.mockResolvedValueOnce(null);

    const res = await POST(postReq({ verdict: 'promote' }), { params });

    expect(res.status).toBe(404);
    expect(mockResolveContainment).not.toHaveBeenCalled();
  });

  it('returns 409 CONTAINMENT_NOT_AWAITING when the action is not awaiting_promotion', async () => {
    mockGetActionStatus.mockResolvedValueOnce({
      agent_id: 'agent_1', created_by: 'user_2', containment_status: 'contained',
    });

    const res = await POST(postReq({ verdict: 'promote' }), { params });
    const data = await res.json();

    expect(res.status).toBe(409);
    expect(data.error).toBe('CONTAINMENT_NOT_AWAITING');
    expect(mockResolveContainment).not.toHaveBeenCalled();
  });

  it('rejects self-approval with 403 SELF_APPROVAL_FORBIDDEN', async () => {
    mockGetActionStatus.mockResolvedValueOnce({
      agent_id: 'agent_1', created_by: 'user_1', containment_status: 'awaiting_promotion',
    });

    const res = await POST(postReq({ verdict: 'promote' }), { params });
    const data = await res.json();

    expect(res.status).toBe(403);
    expect(data.code).toBe('SELF_APPROVAL_FORBIDDEN');
    expect(mockResolveContainment).not.toHaveBeenCalled();
  });

  it("'operator' is exempt from the self-approval gate", async () => {
    mockGetUserId.mockReturnValue('operator');
    mockGetActionStatus.mockResolvedValueOnce({
      agent_id: 'agent_1', created_by: 'operator', containment_status: 'awaiting_promotion', containment_ref: 'ref/x',
    });
    mockResolveContainment.mockResolvedValueOnce({ action_id: 'act_123', containment_status: 'discarded' });

    const res = await POST(postReq({ verdict: 'discard' }), { params });

    expect(res.status).toBe(200);
    expect(mockResolveContainment).toHaveBeenCalled();
  });

  it('returns 409 CONTAINMENT_REF_MISSING when promoting a ref-less row, without mutating or minting a grant', async () => {
    mockGetActionStatus.mockResolvedValueOnce({
      agent_id: 'agent_1', created_by: 'user_2', containment_status: 'awaiting_promotion', containment_ref: null,
    });

    const res = await POST(postReq({ verdict: 'promote' }), { params });
    const data = await res.json();

    expect(res.status).toBe(409);
    expect(data.error).toBe('CONTAINMENT_REF_MISSING');
    expect(mockResolveContainment).not.toHaveBeenCalled();
    expect(mockCreateActionRecord).not.toHaveBeenCalled();
  });

  it('discard is allowed on a ref-less row (no ref requirement)', async () => {
    mockGetActionStatus.mockResolvedValueOnce({
      agent_id: 'agent_1', created_by: 'user_2', containment_status: 'awaiting_promotion', containment_ref: null,
    });
    const updated = { action_id: 'act_123', containment_status: 'discarded' };
    mockResolveContainment.mockResolvedValueOnce(updated);

    const res = await POST(postReq({ verdict: 'discard' }), { params });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.action).toEqual(updated);
    expect(mockCreateActionRecord).not.toHaveBeenCalled();
  });

  it('returns 409 CONTAINMENT_NOT_AWAITING when resolveContainment races to null', async () => {
    mockGetActionStatus.mockResolvedValueOnce({
      agent_id: 'agent_1', created_by: 'user_2', containment_status: 'awaiting_promotion', containment_ref: 'ref/x',
    });
    mockResolveContainment.mockResolvedValueOnce(null);

    const res = await POST(postReq({ verdict: 'promote' }), { params });
    const data = await res.json();

    expect(res.status).toBe(409);
    expect(data.error).toBe('CONTAINMENT_NOT_AWAITING');
    expect(mockCreateActionRecord).not.toHaveBeenCalled();
  });

  it('discard flips the row to discarded and creates no grant row', async () => {
    mockGetActionStatus.mockResolvedValueOnce({
      agent_id: 'agent_1', created_by: 'user_2', containment_status: 'awaiting_promotion', containment_ref: 'ref/x',
    });
    const updated = { action_id: 'act_123', containment_status: 'discarded' };
    mockResolveContainment.mockResolvedValueOnce(updated);

    const res = await POST(postReq({ verdict: 'discard' }), { params });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.action).toEqual(updated);
    expect(data.promotion_action_id).toBeUndefined();
    expect(mockResolveContainment).toHaveBeenCalledWith(mockGetSql, 'org_test', 'act_123', { verdict: 'discard', resolvedBy: 'user_1' });
    expect(mockCreateActionRecord).not.toHaveBeenCalled();
    expect(mockStampPromotionApproval).not.toHaveBeenCalled();
  });

  it('promote flips the row to promoted, creates exactly one synthetic grant row with the canonical goal/act, and stamps a ~15min approval', async () => {
    mockGetActionStatus.mockResolvedValueOnce({
      agent_id: 'agent_1', created_by: 'user_2', containment_status: 'awaiting_promotion',
      containment_ref: 'dashclaw/contained-act_123',
    });
    const updated = { action_id: 'act_123', containment_status: 'promoted' };
    mockResolveContainment.mockResolvedValueOnce(updated);
    mockCreateActionRecord.mockResolvedValueOnce({ action_id: 'act_promo_1' });
    mockStampPromotionApproval.mockResolvedValueOnce({ action_id: 'act_promo_1', approved_by: 'user_1' });

    const res = await POST(postReq({ verdict: 'promote' }), { params });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.action).toEqual(updated);
    expect(typeof data.promotion_action_id).toBe('string');
    expect(data.promotion_action_id).toMatch(/^act_/);

    expect(mockCreateActionRecord).toHaveBeenCalledTimes(1);
    const [sqlArg, payload] = mockCreateActionRecord.mock.calls[0]!;
    expect(sqlArg).toBe(mockGetSql);
    expect(payload.orgId).toBe('org_test');
    expect(payload.action_id).toBe(data.promotion_action_id);
    expect(payload.actionStatus).toBe('running');
    expect(payload.createdBy).toBe('user_1');
    expect(payload.data.agent_id).toBe('agent_1');
    expect(payload.data.action_type).toBe('containment_promote');
    expect(payload.data.declared_goal).toBe(buildPromotionGoal('act_123'));
    expect(payload.data.act).toEqual(buildPromotionAct('dashclaw/contained-act_123'));

    expect(mockStampPromotionApproval).toHaveBeenCalledTimes(1);
    expect(mockStampPromotionApproval).toHaveBeenCalledWith(mockGetSql, 'org_test', data.promotion_action_id, 'user_1');
  });

  // CRITICAL 1 (final fix wave, 2026-07-27): re-promoting an already-
  // 'promoted' action must not 409 forever — it either re-stamps an
  // unconsumed grant's approval window or mints a fresh one.
  it('re-promote with an unconsumed prior grant re-stamps it (no new action row)', async () => {
    mockGetActionStatus.mockResolvedValueOnce({
      agent_id: 'agent_1', created_by: 'user_2', containment_status: 'promoted',
      containment_ref: 'dashclaw/contained-act_123',
    });
    mockFindUnconsumedPromotionGrant.mockResolvedValueOnce({ action_id: 'act_promo_old' });
    mockStampPromotionApproval.mockResolvedValueOnce({ action_id: 'act_promo_old', approved_by: 'user_1' });

    const res = await POST(postReq({ verdict: 'promote' }), { params });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.reissued).toBe(true);
    expect(data.promotion_action_id).toBe('act_promo_old');
    expect(mockFindUnconsumedPromotionGrant).toHaveBeenCalledWith(
      mockGetSql,
      'org_test',
      'act_123',
      'agent_1',
      computeActContentHash(buildPromotionAct('dashclaw/contained-act_123')),
    );
    expect(mockStampPromotionApproval).toHaveBeenCalledTimes(1);
    expect(mockStampPromotionApproval).toHaveBeenCalledWith(mockGetSql, 'org_test', 'act_promo_old', 'user_1');
    expect(mockCreateActionRecord).not.toHaveBeenCalled();
    expect(mockResolveContainment).not.toHaveBeenCalled();
  });

  it('re-promote after the prior grant was consumed mints a fresh grant row', async () => {
    mockGetActionStatus.mockResolvedValueOnce({
      agent_id: 'agent_1', created_by: 'user_2', containment_status: 'promoted',
      containment_ref: 'dashclaw/contained-act_123',
    });
    mockFindUnconsumedPromotionGrant.mockResolvedValueOnce(null);
    mockCreateActionRecord.mockResolvedValueOnce({ action_id: 'act_promo_new' });
    mockStampPromotionApproval.mockResolvedValueOnce({ action_id: 'act_promo_new', approved_by: 'user_1' });

    const res = await POST(postReq({ verdict: 'promote' }), { params });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.reissued).toBe(true);
    expect(typeof data.promotion_action_id).toBe('string');
    expect(mockCreateActionRecord).toHaveBeenCalledTimes(1);
    const [, payload] = mockCreateActionRecord.mock.calls[0]!;
    expect(payload.data.action_type).toBe('containment_promote');
    expect(payload.data.declared_goal).toBe(buildPromotionGoal('act_123'));
    expect(payload.data.act).toEqual(buildPromotionAct('dashclaw/contained-act_123'));
    expect(mockStampPromotionApproval).toHaveBeenCalledWith(mockGetSql, 'org_test', data.promotion_action_id, 'user_1');
    expect(mockResolveContainment).not.toHaveBeenCalled();
  });

  it('discard verdict on an already-promoted action still 409s (re-issue only applies to promote)', async () => {
    mockGetActionStatus.mockResolvedValueOnce({
      agent_id: 'agent_1', created_by: 'user_2', containment_status: 'promoted',
      containment_ref: 'dashclaw/contained-act_123',
    });

    const res = await POST(postReq({ verdict: 'discard' }), { params });
    const data = await res.json();

    expect(res.status).toBe(409);
    expect(data.error).toBe('CONTAINMENT_NOT_AWAITING');
    expect(mockFindUnconsumedPromotionGrant).not.toHaveBeenCalled();
  });

  it('a discarded action still 409s on promote (re-issue only applies from promoted)', async () => {
    mockGetActionStatus.mockResolvedValueOnce({
      agent_id: 'agent_1', created_by: 'user_2', containment_status: 'discarded',
      containment_ref: 'dashclaw/contained-act_123',
    });

    const res = await POST(postReq({ verdict: 'promote' }), { params });
    const data = await res.json();

    expect(res.status).toBe(409);
    expect(data.error).toBe('CONTAINMENT_NOT_AWAITING');
    expect(mockFindUnconsumedPromotionGrant).not.toHaveBeenCalled();
  });

  it('returns 500 on unexpected error', async () => {
    mockGetActionStatus.mockRejectedValueOnce(new Error('DB down'));

    const res = await POST(postReq({ verdict: 'promote' }), { params });
    const data = await res.json();

    expect(res.status).toBe(500);
    expect(data.error).toMatch(/internal server error/i);
  });
});
