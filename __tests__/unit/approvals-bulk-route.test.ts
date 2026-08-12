import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockListIds, mockBulkRecord, mockClear, mockRole, mockGetPolicy, mockSweep, mockUserId, mockApprovalFacts, mockIngestBatch } = vi.hoisted(() => ({
  mockListIds: vi.fn(async () => ['act_1', 'act_2']),
  mockBulkRecord: vi.fn(async () => ['act_1', 'act_2']),
  mockClear: vi.fn(async () => {}),
  mockRole: vi.fn(() => 'admin'),
  mockGetPolicy: vi.fn(async () => ({ id: 'gp_a', name: '[Tightened] other', policy_type: 'require_approval', rules: JSON.stringify({ action_types: ['other'], _tightened: true }) })),
  mockSweep: vi.fn(async () => []),
  mockUserId: vi.fn(() => 'user1'),
  mockApprovalFacts: vi.fn(async () => [{ action_id: 'act_1', agent_id: 'ag', risk_score: 75 }]),
  mockIngestBatch: vi.fn(async () => 1),
}));
vi.mock('../../app/lib/org', () => ({ getOrgId: () => 'org1', getOrgRole: mockRole, getUserId: mockUserId }));
vi.mock('../../app/lib/db', () => ({ getSql: () => ({}) }));
vi.mock('../../app/lib/repositories/actions.repository', () => ({
  listPendingApprovalIdsByPolicy: mockListIds,
  recordBulkApprovals: mockBulkRecord,
  sweepExpiredApprovals: mockSweep,
  listActionApprovalFacts: mockApprovalFacts,
}));
vi.mock('../../app/lib/guard/calibration-feedback', () => ({
  ingestApprovalAdjudicationBatch: mockIngestBatch,
}));
vi.mock('../../app/lib/repositories/guardrails.repository', () => ({ getPolicyById: mockGetPolicy }));
vi.mock('../../app/lib/approvalNotifications', () => ({ clearApprovalNotifications: mockClear }));
vi.mock('../../app/lib/audit', () => ({ logActivity: vi.fn() }));
vi.mock('next/server', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return { ...mod, after: (fn: () => unknown) => { void fn(); } };
});

import { POST } from '../../app/api/approvals/bulk/route';

function req(body: unknown) {
  return new Request('http://x/api/approvals/bulk', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRole.mockReturnValue('admin');
  mockUserId.mockReturnValue('user1');
  mockListIds.mockResolvedValue(['act_1', 'act_2']);
  mockBulkRecord.mockResolvedValue(['act_1', 'act_2']);
  mockGetPolicy.mockResolvedValue({ id: 'gp_a', name: '[Tightened] other', policy_type: 'require_approval', rules: JSON.stringify({ action_types: ['other'], _tightened: true }) });
});

describe('POST /api/approvals/bulk', () => {
  it('requires admin', async () => {
    mockRole.mockReturnValue('member');
    expect((await POST(req({ decision: 'allow', filter: { policy_id: 'gp_a' } }))).status).toBe(403);
  });
  it('rejects an unattributed approver (empty user id) with 403', async () => {
    // Security review 2026-07-05: same attribution gate as the single route —
    // a bulk resolution must never be attributed to nobody.
    mockUserId.mockReturnValue('');
    const res = await POST(req({ decision: 'allow', filter: { policy_id: 'gp_a' } }));
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('APPROVER_IDENTITY_REQUIRED');
    expect(mockBulkRecord).not.toHaveBeenCalled();
  });
  it('rejects bad decisions', async () => {
    expect((await POST(req({ decision: 'nuke', filter: { policy_id: 'gp_a' } }))).status).toBe(400);
  });
  it('404s on unknown policy', async () => {
    mockGetPolicy.mockResolvedValue(null as unknown as { id: string; name: string; policy_type: string; rules: string });
    expect((await POST(req({ decision: 'allow', filter: { policy_id: 'gp_x' } }))).status).toBe(404);
  });
  // Matching runs through the guard decision that held each approval, not
  // through the policy's declared action_types — so a policy shape that can
  // never declare one resolves like any other. Both of these used to 400, which
  // meant the approval-flood banner's only button could not clear the flood it
  // was raised for (field report 2026-08-11).
  it('resolves protected_path policies (rules carry paths, never action_types)', async () => {
    mockGetPolicy.mockResolvedValue({ id: 'gp_p', name: 'p', policy_type: 'protected_path', rules: JSON.stringify({ paths: ['/etc/**'] }) });
    const res = await POST(req({ decision: 'allow', filter: { policy_id: 'gp_p' } }));
    expect(res.status).toBe(200);
    expect(mockListIds).toHaveBeenCalled();
    expect(mockBulkRecord).toHaveBeenCalled();
  });
  it('resolves rate_limit policies, which have no action_type at all', async () => {
    mockGetPolicy.mockResolvedValue({ id: 'gp_burst', name: '[Claude Code Mode] Warn on action bursts', policy_type: 'rate_limit', rules: JSON.stringify({ max_actions: 14, window_minutes: 15 }) });
    const res = await POST(req({ decision: 'allow', filter: { policy_id: 'gp_burst' } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ resolved: 2 });
  });
  it('matches by the policy id that caused the interrupt, not by action_type', async () => {
    await POST(req({ decision: 'allow', filter: { policy_id: 'gp_a' } }));
    // (sql, orgId, policyId, sinceIso, limit)
    const args = mockListIds.mock.calls[0] as unknown as unknown[];
    expect(args[2]).toBe('gp_a');
  });
  it('resolves each matching pending action via recordBulkApprovals (one call, org scoped)', async () => {
    const res = await POST(req({ decision: 'allow', filter: { policy_id: 'gp_a' } }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.resolved).toBe(2);
    expect(mockBulkRecord).toHaveBeenCalledTimes(1);
    expect(mockBulkRecord).toHaveBeenCalledWith(
      expect.anything(),
      'org1',
      ['act_1', 'act_2'],
      expect.objectContaining({ decision: 'allow', newStatus: 'running' }),
    );
    expect(mockClear).toHaveBeenCalledTimes(2);
  });
  it('reports per-action failures without aborting the batch', async () => {
    // recordBulkApprovals returns only act_1 — act_2 was already resolved by a race
    mockBulkRecord.mockResolvedValueOnce(['act_1']);
    const res = await POST(req({ decision: 'deny', filter: { policy_id: 'gp_a' } }));
    const body = await res.json();
    expect(body.resolved).toBe(1);
    expect(body.failed).toBe(1);
  });
  it('sweeps expired approvals before listing candidates (roadmap v2.3)', async () => {
    await POST(req({ decision: 'allow', filter: { policy_id: 'gp_a' } }));
    expect(mockSweep).toHaveBeenCalledWith(expect.anything(), 'org1');
    // Order matters: dead rows must be flipped before the candidate list is read.
    expect(mockSweep.mock.invocationCallOrder[0] ?? Infinity).toBeLessThan(mockListIds.mock.invocationCallOrder[0] ?? 0);
  });
  it('a sweep failure does not abort bulk resolution', async () => {
    mockSweep.mockRejectedValueOnce(new Error('sweep down'));
    const res = await POST(req({ decision: 'allow', filter: { policy_id: 'gp_a' } }));
    expect(res.status).toBe(200);
  });
});
