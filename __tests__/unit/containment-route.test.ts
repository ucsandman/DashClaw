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
  mockGetActionRecord,
  mockResolveContainment,
  mockCreateActionRecord,
  mockStampPromotionApproval,
  mockFindUnconsumedPromotionGrant,
  mockListArtifacts,
  mockGetGuardDecisionById,
} = vi.hoisted(() => ({
  mockGetSql: vi.fn(),
  mockGetOrgId: vi.fn(() => 'org_test'),
  mockGetOrgRole: vi.fn(() => 'admin'),
  mockGetUserId: vi.fn(() => 'user_1'),
  mockGetActionStatus: vi.fn(),
  mockGetActionRecord: vi.fn(),
  mockResolveContainment: vi.fn(),
  mockCreateActionRecord: vi.fn(),
  mockStampPromotionApproval: vi.fn(),
  mockFindUnconsumedPromotionGrant: vi.fn(),
  mockListArtifacts: vi.fn(),
  mockGetGuardDecisionById: vi.fn(),
}));

vi.mock('@/lib/db.js', () => ({ getSql: () => mockGetSql }));
vi.mock('@/lib/org.js', () => ({
  getOrgId: mockGetOrgId,
  getOrgRole: mockGetOrgRole,
  getUserId: mockGetUserId,
}));
vi.mock('@/lib/repositories/actions.repository.js', () => ({
  getActionStatus: mockGetActionStatus,
  getActionRecord: mockGetActionRecord,
  resolveContainment: mockResolveContainment,
  createActionRecord: mockCreateActionRecord,
  stampPromotionApproval: mockStampPromotionApproval,
  findUnconsumedPromotionGrant: mockFindUnconsumedPromotionGrant,
}));
vi.mock('@/lib/repositories/artifacts.repository.js', () => ({
  listArtifacts: mockListArtifacts,
}));
// Database containment (RFC 2026-09-04): the original act the db promotion
// replays lives on the linked guard decision, not on action_records.
vi.mock('@/lib/repositories/guardrails.repository.js', () => ({
  getGuardDecisionById: mockGetGuardDecisionById,
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
    // Default: no patch artifact captured. Tests that need the promote path
    // to clear the evidence-binding check override this with a matching
    // `content.ref`.
    mockListArtifacts.mockResolvedValue({ artifacts: [] });
    // Default: the re-issue path's full-row re-fetch finds nothing, so it
    // falls back to the getActionStatus subset; re-issue shape tests override.
    mockGetActionRecord.mockResolvedValue(null);
    mockGetGuardDecisionById.mockResolvedValue(null);
  });

  function mockPatchArtifact(ref: string | undefined) {
    mockListArtifacts.mockResolvedValueOnce({ artifacts: [{ content: { ref } }] });
  }

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
    mockPatchArtifact('ref/x');
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
    mockPatchArtifact('dashclaw/contained-act_123');
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
    mockPatchArtifact('dashclaw/contained-act_123');
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
    mockPatchArtifact('dashclaw/contained-act_123');
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

  // Recorded follow-up from the v5.6.0 ship: the re-issue path returned the
  // 9-column getActionStatus subset while every other verdict path returns
  // the full row — the response `action` shape must be the full row.
  it('re-issue responds with the full re-fetched action row, not the status subset', async () => {
    mockGetActionStatus.mockResolvedValueOnce({
      agent_id: 'agent_1', created_by: 'user_2', containment_status: 'promoted',
      containment_ref: 'dashclaw/contained-act_123',
    });
    mockPatchArtifact('dashclaw/contained-act_123');
    const fullRow = {
      action_id: 'act_123', agent_id: 'agent_1', declared_goal: 'refactor the parser',
      containment_status: 'promoted', containment_ref: 'dashclaw/contained-act_123',
      containment_resolved_by: 'user_9', risk_score: 55,
    };
    mockGetActionRecord.mockResolvedValueOnce(fullRow);
    mockFindUnconsumedPromotionGrant.mockResolvedValueOnce({ action_id: 'act_promo_old' });
    mockStampPromotionApproval.mockResolvedValueOnce({ action_id: 'act_promo_old', approved_by: 'user_1' });

    const res = await POST(postReq({ verdict: 'promote' }), { params });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.reissued).toBe(true);
    expect(mockGetActionRecord).toHaveBeenCalledWith(mockGetSql, 'org_test', 'act_123');
    expect(data.action).toEqual(fullRow);
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

  // SECURITY (2026-07-27): bind the promoted ref to the REVIEWED evidence —
  // containment_ref and the patch artifact's content.ref must agree before
  // any grant is minted or re-issued.
  it('returns 409 CONTAINMENT_NO_EVIDENCE when no patch artifact exists, without mutating or minting a grant', async () => {
    mockGetActionStatus.mockResolvedValueOnce({
      agent_id: 'agent_1', created_by: 'user_2', containment_status: 'awaiting_promotion',
      containment_ref: 'dashclaw/contained-act_123',
    });
    // beforeEach default: mockListArtifacts resolves { artifacts: [] }

    const res = await POST(postReq({ verdict: 'promote' }), { params });
    const data = await res.json();

    expect(res.status).toBe(409);
    expect(data.error).toBe('CONTAINMENT_NO_EVIDENCE');
    expect(mockResolveContainment).not.toHaveBeenCalled();
    expect(mockCreateActionRecord).not.toHaveBeenCalled();
  });

  it('returns 409 CONTAINMENT_REF_MISMATCH when the patch artifact ref differs from containment_ref, without mutating or minting a grant', async () => {
    mockGetActionStatus.mockResolvedValueOnce({
      agent_id: 'agent_1', created_by: 'user_2', containment_status: 'awaiting_promotion',
      containment_ref: 'dashclaw/contained-act_123',
    });
    mockPatchArtifact('dashclaw/contained-someone-else');

    const res = await POST(postReq({ verdict: 'promote' }), { params });
    const data = await res.json();

    expect(res.status).toBe(409);
    expect(data.error).toBe('CONTAINMENT_REF_MISMATCH');
    expect(mockResolveContainment).not.toHaveBeenCalled();
    expect(mockCreateActionRecord).not.toHaveBeenCalled();
  });

  it('returns 409 CONTAINMENT_REF_MISMATCH on a re-issue (already-promoted) when the evidence no longer matches', async () => {
    mockGetActionStatus.mockResolvedValueOnce({
      agent_id: 'agent_1', created_by: 'user_2', containment_status: 'promoted',
      containment_ref: 'dashclaw/contained-act_123',
    });
    mockPatchArtifact('dashclaw/contained-someone-else');

    const res = await POST(postReq({ verdict: 'promote' }), { params });
    const data = await res.json();

    expect(res.status).toBe(409);
    expect(data.error).toBe('CONTAINMENT_REF_MISMATCH');
    expect(mockFindUnconsumedPromotionGrant).not.toHaveBeenCalled();
    expect(mockCreateActionRecord).not.toHaveBeenCalled();
  });

  it('discard is unaffected by missing or mismatched evidence (no artifact check on discard)', async () => {
    mockGetActionStatus.mockResolvedValueOnce({
      agent_id: 'agent_1', created_by: 'user_2', containment_status: 'awaiting_promotion',
      containment_ref: 'dashclaw/contained-act_123',
    });
    // beforeEach default: mockListArtifacts resolves { artifacts: [] } — must not matter for discard.
    const updated = { action_id: 'act_123', containment_status: 'discarded' };
    mockResolveContainment.mockResolvedValueOnce(updated);

    const res = await POST(postReq({ verdict: 'discard' }), { params });
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.action).toEqual(updated);
    expect(mockListArtifacts).not.toHaveBeenCalled();
  });

  // ── Database containment (RFC 2026-09-04) ────────────────────────────────
  // A `dashclaw/contained-db-` ref promotes by REPLAYING the action's original
  // recorded act on production, not by merging a branch. The act comes from
  // the linked guard decision (action_records stores only its hash), and the
  // grant carries the ORIGINAL action's risk score, because the replay IS the
  // risky act.
  describe('db ref promotion', () => {
    const DB_REF = 'dashclaw/contained-db-act_123';
    const ORIGINAL_ACT = { kind: 'shell', command: 'psql -c "alter table users add column tier text"' };

    function mockDbAction(overrides: Record<string, unknown> = {}) {
      mockGetActionStatus.mockResolvedValueOnce({
        agent_id: 'agent_1', created_by: 'user_2', containment_status: 'awaiting_promotion',
        containment_ref: DB_REF, ...overrides,
      });
      mockPatchArtifact(DB_REF);
    }

    it('mints the grant with the original recorded act and the original risk score', async () => {
      mockDbAction();
      mockGetActionRecord.mockResolvedValueOnce({ action_id: 'act_123', risk_score: 75, guard_decision_id: 'gd_1' });
      mockGetGuardDecisionById.mockResolvedValueOnce({ id: 'gd_1', context: JSON.stringify({ agent_id: 'agent_1', act: ORIGINAL_ACT }) });
      const updated = { action_id: 'act_123', containment_status: 'promoted' };
      mockResolveContainment.mockResolvedValueOnce(updated);
      mockCreateActionRecord.mockResolvedValueOnce({ action_id: 'act_promo_db' });

      const res = await POST(postReq({ verdict: 'promote' }), { params });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(mockGetGuardDecisionById).toHaveBeenCalledWith(mockGetSql, 'org_test', 'gd_1');
      const [, payload] = mockCreateActionRecord.mock.calls[0]!;
      expect(payload.data.act).toEqual(ORIGINAL_ACT);
      expect(payload.data.act).toEqual(buildPromotionAct(DB_REF, ORIGINAL_ACT));
      expect(payload.data.risk_score).toBe(75);
      expect(payload.data.declared_goal).toBe(buildPromotionGoal('act_123'));
      expect(payload.data.action_type).toBe('containment_promote');
      expect(mockStampPromotionApproval).toHaveBeenCalledWith(mockGetSql, 'org_test', data.promotion_action_id, 'user_1');
    });

    it('accepts an already-parsed context object (driver difference) and falls back to risk 20 with no score', async () => {
      mockDbAction();
      mockGetActionRecord.mockResolvedValueOnce({ action_id: 'act_123', risk_score: null, guard_decision_id: 'gd_1' });
      mockGetGuardDecisionById.mockResolvedValueOnce({ id: 'gd_1', context: { act: ORIGINAL_ACT } });
      mockResolveContainment.mockResolvedValueOnce({ action_id: 'act_123', containment_status: 'promoted' });
      mockCreateActionRecord.mockResolvedValueOnce({ action_id: 'act_promo_db' });

      const res = await POST(postReq({ verdict: 'promote' }), { params });

      expect(res.status).toBe(200);
      const [, payload] = mockCreateActionRecord.mock.calls[0]!;
      expect(payload.data.act).toEqual(ORIGINAL_ACT);
      expect(payload.data.risk_score).toBe(20);
    });

    it('refuses with 409 CONTAINMENT_ACT_MISSING when the act cannot be recovered — never a merge act', async () => {
      // No guard_decision_id on the row at all.
      mockDbAction();
      mockGetActionRecord.mockResolvedValueOnce({ action_id: 'act_123', risk_score: 75, guard_decision_id: null });

      const res = await POST(postReq({ verdict: 'promote' }), { params });
      const data = await res.json();

      expect(res.status).toBe(409);
      expect(data.error).toBe('CONTAINMENT_ACT_MISSING');
      expect(mockResolveContainment).not.toHaveBeenCalled();
      expect(mockCreateActionRecord).not.toHaveBeenCalled();
    });

    it('refuses with 409 CONTAINMENT_ACT_MISSING when the linked decision carries no act', async () => {
      mockDbAction();
      mockGetActionRecord.mockResolvedValueOnce({ action_id: 'act_123', guard_decision_id: 'gd_1' });
      mockGetGuardDecisionById.mockResolvedValueOnce({ id: 'gd_1', context: JSON.stringify({ agent_id: 'agent_1' }) });

      const res = await POST(postReq({ verdict: 'promote' }), { params });

      expect((await res.json()).error).toBe('CONTAINMENT_ACT_MISSING');
      expect(res.status).toBe(409);
      expect(mockCreateActionRecord).not.toHaveBeenCalled();
    });

    it('re-issue looks up the prior grant by the ORIGINAL act hash, not a merge-act hash', async () => {
      mockDbAction({ containment_status: 'promoted' });
      mockGetActionRecord.mockResolvedValueOnce({ action_id: 'act_123', risk_score: 75, guard_decision_id: 'gd_1' });
      mockGetGuardDecisionById.mockResolvedValueOnce({ id: 'gd_1', context: JSON.stringify({ act: ORIGINAL_ACT }) });
      mockGetActionRecord.mockResolvedValueOnce({ action_id: 'act_123', containment_status: 'promoted' });
      mockFindUnconsumedPromotionGrant.mockResolvedValueOnce({ action_id: 'act_promo_old' });

      const res = await POST(postReq({ verdict: 'promote' }), { params });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.reissued).toBe(true);
      expect(mockFindUnconsumedPromotionGrant).toHaveBeenCalledWith(
        mockGetSql,
        'org_test',
        'act_123',
        'agent_1',
        computeActContentHash(ORIGINAL_ACT),
      );
    });

    it('discard needs no act at all', async () => {
      mockGetActionStatus.mockResolvedValueOnce({
        agent_id: 'agent_1', created_by: 'user_2', containment_status: 'awaiting_promotion',
        containment_ref: DB_REF,
      });
      const updated = { action_id: 'act_123', containment_status: 'discarded' };
      mockResolveContainment.mockResolvedValueOnce(updated);

      const res = await POST(postReq({ verdict: 'discard' }), { params });

      expect(res.status).toBe(200);
      expect((await res.json()).action).toEqual(updated);
      expect(mockGetGuardDecisionById).not.toHaveBeenCalled();
    });
  });

  it('returns 500 on unexpected error', async () => {
    mockGetActionStatus.mockRejectedValueOnce(new Error('DB down'));

    const res = await POST(postReq({ verdict: 'promote' }), { params });
    const data = await res.json();

    expect(res.status).toBe(500);
    expect(data.error).toMatch(/internal server error/i);
  });
});
