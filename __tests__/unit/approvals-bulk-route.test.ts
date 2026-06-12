import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockListIds, mockBulkRecord, mockClear, mockRole, mockGetPolicy } = vi.hoisted(() => ({
  mockListIds: vi.fn(async () => ['act_1', 'act_2']),
  mockBulkRecord: vi.fn(async () => ['act_1', 'act_2']),
  mockClear: vi.fn(async () => {}),
  mockRole: vi.fn(() => 'admin'),
  mockGetPolicy: vi.fn(async () => ({ id: 'gp_a', name: '[Tightened] other', policy_type: 'require_approval', rules: JSON.stringify({ action_types: ['other'], _tightened: true }) })),
}));
vi.mock('../../app/lib/org', () => ({ getOrgId: () => 'org1', getOrgRole: mockRole, getUserId: () => 'user1' }));
vi.mock('../../app/lib/db', () => ({ getSql: () => ({}) }));
vi.mock('../../app/lib/repositories/actions.repository', () => ({
  listPendingApprovalIdsByActionTypes: mockListIds,
  recordBulkApprovals: mockBulkRecord,
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
  mockListIds.mockResolvedValue(['act_1', 'act_2']);
  mockBulkRecord.mockResolvedValue(['act_1', 'act_2']);
  mockGetPolicy.mockResolvedValue({ id: 'gp_a', name: '[Tightened] other', policy_type: 'require_approval', rules: JSON.stringify({ action_types: ['other'], _tightened: true }) });
});

describe('POST /api/approvals/bulk', () => {
  it('requires admin', async () => {
    mockRole.mockReturnValue('member');
    expect((await POST(req({ decision: 'allow', filter: { policy_id: 'gp_a' } }))).status).toBe(403);
  });
  it('rejects bad decisions', async () => {
    expect((await POST(req({ decision: 'nuke', filter: { policy_id: 'gp_a' } }))).status).toBe(400);
  });
  it('404s on unknown policy', async () => {
    mockGetPolicy.mockResolvedValue(null as unknown as { id: string; name: string; policy_type: string; rules: string });
    expect((await POST(req({ decision: 'allow', filter: { policy_id: 'gp_x' } }))).status).toBe(404);
  });
  it('400s on protected_path policies', async () => {
    mockGetPolicy.mockResolvedValue({ id: 'gp_p', name: 'p', policy_type: 'protected_path', rules: JSON.stringify({ paths: ['/etc/**'] }) });
    expect((await POST(req({ decision: 'allow', filter: { policy_id: 'gp_p' } }))).status).toBe(400);
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
});
