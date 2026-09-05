// __tests__/unit/approvals-grant-route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockSql,
  mockGetActionForGrant,
  mockListPendingApprovalsForGrant,
  mockCreateApprovalGrant,
  mockGetActivePolicies,
  mockGetGuardDecisionById,
  mockLogActivity,
} = vi.hoisted(() => ({
  mockSql: Object.assign(vi.fn(async () => []), { query: vi.fn(async () => []) }),
  mockGetActionForGrant: vi.fn(),
  mockListPendingApprovalsForGrant: vi.fn(),
  mockCreateApprovalGrant: vi.fn(),
  mockGetActivePolicies: vi.fn(),
  mockGetGuardDecisionById: vi.fn(),
  mockLogActivity: vi.fn(),
}));

// after() has no request scope in a unit test; run the callback inline so the
// audit-log assertion still exercises the real call.
vi.mock('next/server', async (importOriginal) => {
  const mod = await importOriginal<typeof import('next/server')>();
  return { ...mod, after: (fn: () => unknown) => { void fn(); } };
});

vi.mock('@/lib/db.js', () => ({ getSql: () => mockSql }));
vi.mock('@/lib/audit.js', () => ({ logActivity: mockLogActivity }));
vi.mock('@/lib/repositories/actions.repository.js', () => ({
  getActionForGrant: mockGetActionForGrant,
  listPendingApprovalsForGrant: mockListPendingApprovalsForGrant,
  createApprovalGrant: mockCreateApprovalGrant,
  isApprovalOverdue: (row: { approval_expires_at?: string }) => Boolean(row.approval_expires_at && Date.parse(row.approval_expires_at) < Date.now()),
}));
vi.mock('@/lib/repositories/guardrails.repository.js', () => ({
  getActivePolicies: mockGetActivePolicies,
  getGuardDecisionById: mockGetGuardDecisionById,
}));

import { GET, POST } from '@/api/approvals/[actionId]/grant/route.js';

const SCRATCH = 'C:/Users/sandm/AppData/Local/Temp/claude/audit/scratchpad/build.mjs';

function req(body: unknown = {}, headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/approvals/act_self/grant', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-org-id': 'org_1',
      'x-org-role': 'admin',
      'x-user-id': 'user_wes',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

const params = Promise.resolve({ actionId: 'act_self' });

const ACTION = {
  action_id: 'act_self',
  action_type: 'apply',
  status: 'pending_approval',
  risk_score: 65,
  context: JSON.stringify({ target: SCRATCH }),
  guard_decision_id: 'gd_1',
};

async function post(body: unknown = {}, headers: Record<string, string> = {}) {
  const res = await POST(req(body, headers), { params });
  return { status: res.status, body: await res.json() };
}

async function get(ttlHours = '24', headers: Record<string, string> = {}) {
  const request = new Request(`http://localhost/api/approvals/act_self/grant?ttl_hours=${ttlHours}`, {
    headers: { 'x-org-id': 'org_1', 'x-org-role': 'admin', 'x-user-id': 'user_wes', ...headers },
  });
  const res = await GET(request, { params });
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetActionForGrant.mockResolvedValue({ ...ACTION });
  mockListPendingApprovalsForGrant.mockResolvedValue({ rows: [], truncated: false });
  mockGetActivePolicies.mockResolvedValue([]);
  mockGetGuardDecisionById.mockResolvedValue({ matched_policies: '[]' });
  mockCreateApprovalGrant.mockImplementation(async (_sql, _org, _action, _actor, data) => ({ id: 'gp_1', ...data }));
});

describe('POST /api/approvals/[actionId]/grant — refusals', () => {
  it('refuses a non-admin', async () => {
    expect((await post({}, { 'x-org-role': 'member' })).status).toBe(403);
  });

  it('refuses an unattributable principal', async () => {
    const res = await post({}, { 'x-user-id': '' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('APPROVER_IDENTITY_REQUIRED');
  });

  it('404s an unknown action', async () => {
    mockGetActionForGrant.mockResolvedValue(null);
    expect((await post()).status).toBe(404);
  });

  it('refuses an action that is no longer pending', async () => {
    mockGetActionForGrant.mockResolvedValue({ ...ACTION, status: 'running' });
    expect((await post()).status).toBe(400);
  });

  it('refuses a ttl outside the menu', async () => {
    const res = await post({ ttl_hours: 5 });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_TTL');
  });

  // The ceiling is enforced by the route, not just hidden in the UI.
  it('refuses at the risk ceiling', async () => {
    mockGetActionForGrant.mockResolvedValue({ ...ACTION, risk_score: 70 });
    const res = await post();
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('GRANT_RISK_CEILING');
    expect(mockCreateApprovalGrant).not.toHaveBeenCalled();
  });

  // F1: an unscoped grant blanket-allows the whole action type.
  it('refuses a shape with no target scope', async () => {
    mockGetActionForGrant.mockResolvedValue({ ...ACTION, context: JSON.stringify({}) });
    const res = await post();
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('UNSCOPED_GRANT_REJECTED');
    expect(mockCreateApprovalGrant).not.toHaveBeenCalled();
  });

  it('refuses when a matched gating policy is ungrantable', async () => {
    mockGetGuardDecisionById.mockResolvedValue({ matched_policies: '["gp_block"]' });
    mockGetActivePolicies.mockResolvedValue([
      { id: 'gp_block', name: 'Catastrophe rail', policy_type: 'require_approval', rules: '{"ungrantable":true}' },
    ]);
    const res = await post();
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('GRANT_REFUSED_BY_POLICY');
    expect(mockCreateApprovalGrant).not.toHaveBeenCalled();
  });

  // An ungrantable rule the action did NOT trip must not block the grant.
  it('allows the grant when the ungrantable policy was not matched', async () => {
    mockGetGuardDecisionById.mockResolvedValue({ matched_policies: '["gp_other"]' });
    mockGetActivePolicies.mockResolvedValue([
      { id: 'gp_block', name: 'Catastrophe rail', policy_type: 'require_approval', rules: '{"ungrantable":true}' },
    ]);
    expect((await post()).status).toBe(201);
  });
});

describe('POST /api/approvals/[actionId]/grant — minting', () => {
  it('mints a scoped, expiring, ceilinged grant', async () => {
    const res = await post();
    expect(res.status).toBe(201);
    const rules = JSON.parse(mockCreateApprovalGrant.mock.calls[0]![4].rules);
    expect(rules.action_type).toBe('apply');
    expect(rules.target_prefix).toBe(SCRATCH);
    expect(rules.max_risk).toBe(70);
    expect(rules._grant).toBe(true);
    expect(new Date(rules.expires_at).getTime()).toBeGreaterThan(Date.now());
  });

  it('defaults the lease to 24h and honors an explicit one', async () => {
    await post();
    const def = JSON.parse(mockCreateApprovalGrant.mock.calls[0]![4].rules);
    const defHours = (new Date(def.expires_at).getTime() - Date.now()) / 3_600_000;
    expect(defHours).toBeGreaterThan(23);
    expect(defHours).toBeLessThan(25);

    mockCreateApprovalGrant.mockClear();
    await post({ ttl_hours: 1 });
    const short = JSON.parse(mockCreateApprovalGrant.mock.calls[0]![4].rules);
    expect((new Date(short.expires_at).getTime() - Date.now()) / 3_600_000).toBeLessThan(1.1);
  });

  it('returns the clicked action first', async () => {
    const res = await post();
    expect(res.body.release_ids[0]).toBe('act_self');
  });

  it('includes a matching sibling', async () => {
    mockListPendingApprovalsForGrant.mockResolvedValue({ rows: [
      { action_id: 'act_self', action_type: 'apply', risk_score: 65, context: JSON.stringify({ target: SCRATCH }) },
      { action_id: 'act_twin', action_type: 'apply', risk_score: 65, context: JSON.stringify({ target: SCRATCH }) },
    ], truncated: false });
    const res = await post();
    expect(res.body.release_ids).toEqual(['act_self', 'act_twin']);
  });

  it('excludes a sibling above the ceiling', async () => {
    mockListPendingApprovalsForGrant.mockResolvedValue({ rows: [
      { action_id: 'act_hot', action_type: 'apply', risk_score: 95, context: JSON.stringify({ target: SCRATCH }) },
    ], truncated: false });
    const res = await post();
    expect(res.body.release_ids).toEqual(['act_self']);
  });

  it('excludes a sibling whose target is outside the grant scope', async () => {
    mockListPendingApprovalsForGrant.mockResolvedValue({ rows: [
      { action_id: 'act_elsewhere', action_type: 'apply', risk_score: 10, context: JSON.stringify({ target: 'C:/Projects/DashClaw/app/page.tsx' }) },
    ], truncated: false });
    const res = await post();
    expect(res.body.release_ids).toEqual(['act_self']);
  });

  // The clicked action must never appear twice, however the lister returns it.
  it('never duplicates the clicked action', async () => {
    mockListPendingApprovalsForGrant.mockResolvedValue({ rows: [
      { action_id: 'act_self', action_type: 'apply', risk_score: 65, context: JSON.stringify({ target: SCRATCH }) },
    ], truncated: false });
    const res = await post();
    expect(res.body.release_ids).toEqual(['act_self']);
  });

  it('records the grant in the audit log', async () => {
    await post();
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'policy.grant_created', actorId: 'user_wes' }),
      mockSql,
    );
  });

  it('returns 409 when the source loses eligibility during the atomic write', async () => {
    mockCreateApprovalGrant.mockResolvedValueOnce(null);
    const res = await post();
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('GRANT_SOURCE_CHANGED');
  });
});

describe('GET /api/approvals/[actionId]/grant — preview', () => {
  it('rejects a lease outside the supported menu', async () => {
    const res = await get('5');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_TTL');
  });

  it('returns the same bounded shape without creating a policy', async () => {
    mockListPendingApprovalsForGrant.mockResolvedValue({ rows: [
      { action_id: 'act_twin', action_type: 'apply', risk_score: 65, context: JSON.stringify({ target: SCRATCH }), created_by: 'agent' },
    ], truncated: true });
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({
      scope: 'apply', target: SCRATCH, matching_count: 2,
      release_ids: ['act_self', 'act_twin'], truncated: true,
    }));
    expect(mockCreateApprovalGrant).not.toHaveBeenCalled();
  });

  it('rejects a creator preview for the same principal', async () => {
    mockGetActionForGrant.mockResolvedValue({ ...ACTION, created_by: 'user_wes' });
    const res = await get();
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('SELF_APPROVAL_FORBIDDEN');
  });

  it('keeps the root operator exemption', async () => {
    mockGetActionForGrant.mockResolvedValue({ ...ACTION, created_by: 'operator' });
    expect((await get('24', { 'x-user-id': 'operator' })).status).toBe(200);
  });
});
