/**
 * Server-side admin gates on secrets mutations (pre-existing gap — the
 * gate lived only client-side) plus rotation-interval validation and the
 * PATCH exclusion of value/delivery mutations.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRequest } from '../helpers.js';

const {
  mockSql, mockGetOrgId, mockGetOrgRole, mockGetUserId, mockLogActivity,
  mockListSecrets, mockCreateSecret, mockUpdateSecret, mockDeleteSecret,
  mockGetSecret, mockSetSecretValue, mockClearSecretValue, mockSetDeliveryEnabled,
  mockGetDeliverableSecrets,
} = vi.hoisted(() => ({
  mockSql: vi.fn(),
  mockGetOrgId: vi.fn(),
  mockGetOrgRole: vi.fn(),
  mockGetUserId: vi.fn(),
  mockLogActivity: vi.fn(),
  mockListSecrets: vi.fn(),
  mockCreateSecret: vi.fn(),
  mockUpdateSecret: vi.fn(),
  mockDeleteSecret: vi.fn(),
  mockGetSecret: vi.fn(),
  mockSetSecretValue: vi.fn(),
  mockClearSecretValue: vi.fn(),
  mockSetDeliveryEnabled: vi.fn(),
  mockGetDeliverableSecrets: vi.fn(),
}));

vi.mock('@/lib/db.js', () => ({ getSql: () => mockSql }));
vi.mock('@/lib/org.js', () => ({
  getOrgId: mockGetOrgId,
  getOrgRole: mockGetOrgRole,
  getUserId: mockGetUserId,
}));
vi.mock('@/lib/audit.js', () => ({ logActivity: mockLogActivity }));
vi.mock('@/lib/repositories/governed-secrets.repository.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    listSecrets: mockListSecrets,
    createSecret: mockCreateSecret,
    updateSecret: mockUpdateSecret,
    deleteSecret: mockDeleteSecret,
    getSecret: mockGetSecret,
    setSecretValue: mockSetSecretValue,
    clearSecretValue: mockClearSecretValue,
    setDeliveryEnabled: mockSetDeliveryEnabled,
    getDeliverableSecrets: mockGetDeliverableSecrets,
  };
});

import { POST as createRoute } from '@/api/secrets/route.js';
import { PATCH as patchRoute, DELETE as deleteRoute } from '@/api/secrets/[id]/route.js';
import { POST as valueRoute } from '@/api/secrets/[id]/value/route.js';

const ctx = { params: Promise.resolve({ id: 'sec_1' }) };

beforeEach(() => {
  vi.clearAllMocks();
  mockGetOrgId.mockReturnValue('org_test');
  mockGetOrgRole.mockReturnValue('admin');
  mockGetUserId.mockReturnValue('user_1');
});

describe('admin gates (403 for non-admin)', () => {
  it('POST /api/secrets', async () => {
    mockGetOrgRole.mockReturnValue('member');
    const res = await createRoute(makeRequest('http://test/api/secrets', { body: { name: 'x' } }));
    expect(res.status).toBe(403);
    expect(mockCreateSecret).not.toHaveBeenCalled();
  });

  it('DELETE /api/secrets/[id]', async () => {
    mockGetOrgRole.mockReturnValue('member');
    const res = await deleteRoute(makeRequest('http://test/api/secrets/sec_1'), ctx);
    expect(res.status).toBe(403);
    expect(mockDeleteSecret).not.toHaveBeenCalled();
  });

  it('POST /api/secrets/[id]/value', async () => {
    mockGetOrgRole.mockReturnValue('member');
    const res = await valueRoute(
      makeRequest('http://test/api/secrets/sec_1/value', { body: { value: 's3cret' } }),
      ctx
    );
    expect(res.status).toBe(403);
    expect(mockSetSecretValue).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/secrets/[id] stays member-reachable but excludes value/delivery', () => {
  it('member can mark rotated', async () => {
    mockGetOrgRole.mockReturnValue('member');
    mockUpdateSecret.mockResolvedValueOnce({ id: 'sec_1' });
    const res = await patchRoute(
      makeRequest('http://test/api/secrets/sec_1', { body: { last_rotated_at: '2026-06-10T00:00:00Z' } }),
      ctx
    );
    expect(res.status).toBe(200);
  });

  it('400s when value rides PATCH', async () => {
    const res = await patchRoute(
      makeRequest('http://test/api/secrets/sec_1', { body: { value: 'nope' } }),
      ctx
    );
    expect(res.status).toBe(400);
    expect(mockUpdateSecret).not.toHaveBeenCalled();
  });

  it('400s when delivery_enabled rides PATCH', async () => {
    const res = await patchRoute(
      makeRequest('http://test/api/secrets/sec_1', { body: { delivery_enabled: true } }),
      ctx
    );
    expect(res.status).toBe(400);
    expect(mockUpdateSecret).not.toHaveBeenCalled();
  });
});

describe('POST /api/secrets validation', () => {
  it('rejects negative rotation_interval_days with 400', async () => {
    const res = await createRoute(
      makeRequest('http://test/api/secrets', { body: { name: 'x', rotation_interval_days: -5 } })
    );
    expect(res.status).toBe(400);
    expect(mockCreateSecret).not.toHaveBeenCalled();
  });

  it('rejects zero rotation_interval_days with 400', async () => {
    const res = await createRoute(
      makeRequest('http://test/api/secrets', { body: { name: 'x', rotation_interval_days: 0 } })
    );
    expect(res.status).toBe(400);
  });

  it('admin create still works', async () => {
    mockCreateSecret.mockResolvedValueOnce({ id: 'sec_9', name: 'x' });
    const res = await createRoute(
      makeRequest('http://test/api/secrets', { body: { name: 'x', rotation_interval_days: 30 } })
    );
    expect(res.status).toBe(201);
  });
});
