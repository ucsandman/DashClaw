/**
 * PATCH /api/pairings/[pairingId] hardening: admin gate (matching GET-list and
 * POST /approve) and a status whitelist that excludes 'approved' — approval
 * must flow through POST /approve, the only path that creates the identity.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRequest } from '../helpers.js';

const { mockSql, mockGetOrgId, mockGetOrgRole, mockUpdatePairing, mockGetPairing, mockExpirePairing } = vi.hoisted(() => ({
  mockSql: vi.fn(),
  mockGetOrgId: vi.fn(),
  mockGetOrgRole: vi.fn(),
  mockUpdatePairing: vi.fn(),
  mockGetPairing: vi.fn(),
  mockExpirePairing: vi.fn(),
}));

vi.mock('@/lib/db.js', () => ({ getSql: () => mockSql }));
vi.mock('@/lib/org.js', () => ({ getOrgId: mockGetOrgId, getOrgRole: mockGetOrgRole }));
vi.mock('@/lib/repositories/pairings.repository.js', () => ({
  getPairing: mockGetPairing,
  expirePairing: mockExpirePairing,
  updatePairing: mockUpdatePairing,
}));

import { PATCH } from '@/api/pairings/[pairingId]/route.js';

function patchReq(body) {
  return makeRequest('http://test/api/pairings/pair_1', { method: 'PATCH', body });
}
const ctx = { params: Promise.resolve({ pairingId: 'pair_1' }) };

beforeEach(() => {
  vi.clearAllMocks();
  mockGetOrgId.mockReturnValue('org_test');
  mockGetOrgRole.mockReturnValue('admin');
});

describe('PATCH /api/pairings/[pairingId]', () => {
  it('403s for non-admin callers', async () => {
    mockGetOrgRole.mockReturnValue('member');
    const res = await PATCH(patchReq({ permission_level: 'readonly' }), ctx);
    expect(res.status).toBe(403);
    expect(mockUpdatePairing).not.toHaveBeenCalled();
  });

  it("rejects status 'approved' with a pointer to POST /approve", async () => {
    const res = await PATCH(patchReq({ status: 'approved' }), ctx);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/POST \/api\/pairings\/\{id\}\/approve/);
    expect(mockUpdatePairing).not.toHaveBeenCalled();
  });

  it('rejects invented statuses', async () => {
    const res = await PATCH(patchReq({ status: 'totally-real' }), ctx);
    expect(res.status).toBe(400);
  });

  it('admin can still set permission_level', async () => {
    mockUpdatePairing.mockResolvedValueOnce({ id: 'pair_1', permission_level: 'workspace_write' });
    const res = await PATCH(patchReq({ permission_level: 'workspace_write' }), ctx);
    expect(res.status).toBe(200);
    expect(mockUpdatePairing).toHaveBeenCalledWith(mockSql, 'org_test', 'pair_1', {
      status: undefined,
      permission_level: 'workspace_write',
    });
  });
});
