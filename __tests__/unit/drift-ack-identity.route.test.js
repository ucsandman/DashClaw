/**
 * P14: PATCH /api/drift/alerts/[alertId] must pass the REAL authenticated
 * identity into acknowledgeAlert — acknowledged_by was hardcoded to 'user',
 * a meaningless audit trail in a governance product.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRequest } from '../helpers.js';

const { mockAcknowledge, role, userId } = vi.hoisted(() => ({
  mockAcknowledge: vi.fn(async () => ({ id: 'da_1', acknowledged: true })),
  role: { value: 'admin' },
  userId: { value: 'usr_wes' },
}));

vi.mock('@/lib/org.js', () => ({
  getOrgId: () => 'org_test',
  getOrgRole: () => role.value,
  getUserId: () => userId.value,
}));
vi.mock('@/lib/drift.js', () => ({
  acknowledgeAlert: mockAcknowledge,
  deleteAlert: vi.fn(async () => ({ deleted: true })),
}));

const { PATCH } = await import('@/api/drift/alerts/[alertId]/route.js');

const params = Promise.resolve({ alertId: 'da_1' });

beforeEach(() => {
  mockAcknowledge.mockClear();
  role.value = 'admin';
  userId.value = 'usr_wes';
});

describe('PATCH /api/drift/alerts/[alertId]', () => {
  it('passes the session user identity to acknowledgeAlert', async () => {
    const res = await PATCH(makeRequest('http://localhost/api/drift/alerts/da_1', { method: 'PATCH' }), { params });
    expect(res.status).toBe(200);
    expect(mockAcknowledge).toHaveBeenCalledWith(expect.anything(), 'da_1', 'usr_wes');
  });

  it('passes undefined for API-key principals (drift.ts labels them)', async () => {
    userId.value = null;
    await PATCH(makeRequest('http://localhost/api/drift/alerts/da_1', { method: 'PATCH' }), { params });
    expect(mockAcknowledge).toHaveBeenCalledWith(expect.anything(), 'da_1', undefined);
  });

  it('still 403s non-admins before any acknowledgement', async () => {
    role.value = 'member';
    const res = await PATCH(makeRequest('http://localhost/api/drift/alerts/da_1', { method: 'PATCH' }), { params });
    expect(res.status).toBe(403);
    expect(mockAcknowledge).not.toHaveBeenCalled();
  });
});
