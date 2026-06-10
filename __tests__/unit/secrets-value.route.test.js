/**
 * POST /api/secrets/[id]/value — write-only managed values.
 * The response and audit trail must NEVER contain the plaintext;
 * production without ENCRYPTION_KEY fails closed with 503.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRequest } from '../helpers.js';

const {
  mockSql, mockGetOrgId, mockGetOrgRole, mockGetUserId, mockLogActivity,
  mockGetSecret, mockSetSecretValue, mockClearSecretValue, mockSetDeliveryEnabled,
  mockListSecrets,
} = vi.hoisted(() => ({
  mockSql: vi.fn(),
  mockGetOrgId: vi.fn(),
  mockGetOrgRole: vi.fn(),
  mockGetUserId: vi.fn(),
  mockLogActivity: vi.fn(),
  mockGetSecret: vi.fn(),
  mockSetSecretValue: vi.fn(),
  mockClearSecretValue: vi.fn(),
  mockSetDeliveryEnabled: vi.fn(),
  mockListSecrets: vi.fn(),
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
    getSecret: mockGetSecret,
    setSecretValue: mockSetSecretValue,
    clearSecretValue: mockClearSecretValue,
    setDeliveryEnabled: mockSetDeliveryEnabled,
  };
});

import { POST as valueRoute } from '@/api/secrets/[id]/value/route.js';
import { GET as listRoute } from '@/api/secrets/route.js';

const PLAINTEXT = 'sk-live-supersecret-fixture-9000';
const ctx = { params: Promise.resolve({ id: 'sec_1' }) };

function valueReq(body) {
  return makeRequest('http://test/api/secrets/sec_1/value', { body });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetOrgId.mockReturnValue('org_test');
  mockGetOrgRole.mockReturnValue('admin');
  mockGetUserId.mockReturnValue('user_1');
  mockGetSecret.mockResolvedValue({
    id: 'sec_1', name: 'OPENAI_API_KEY', has_value: false, delivery_enabled: 0, value_set_at: null,
  });
  mockSetSecretValue.mockResolvedValue({ id: 'sec_1', name: 'OPENAI_API_KEY', value_set_at: '2026-06-10T00:00:00Z' });
  mockClearSecretValue.mockResolvedValue({ id: 'sec_1', name: 'OPENAI_API_KEY' });
  mockSetDeliveryEnabled.mockResolvedValue({ id: 'sec_1', name: 'OPENAI_API_KEY', delivery_enabled: 1 });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('fail closed without ENCRYPTION_KEY in production', () => {
  it('503s before touching the database', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('ENCRYPTION_KEY', '');
    const res = await valueRoute(valueReq({ value: PLAINTEXT }), ctx);
    expect(res.status).toBe(503);
    expect(mockSetSecretValue).not.toHaveBeenCalled();
  });
});

describe('set value', () => {
  it('sets, audits secret.value_set, and never echoes the value', async () => {
    const res = await valueRoute(valueReq({ value: PLAINTEXT }), ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.has_value).toBe(true);
    expect(JSON.stringify(json)).not.toContain(PLAINTEXT);

    expect(mockSetSecretValue).toHaveBeenCalledWith(mockSql, 'org_test', 'sec_1', PLAINTEXT);
    expect(mockLogActivity).toHaveBeenCalledTimes(1);
    const [opts] = mockLogActivity.mock.calls[0];
    expect(opts.action).toBe('secret.value_set');
    const serialized = JSON.stringify(opts.details);
    expect(serialized).toContain('OPENAI_API_KEY');
    expect(serialized).toContain('sec_1');
    expect(serialized).not.toContain(PLAINTEXT);
  });

  it('can set value and enable delivery in one call', async () => {
    const res = await valueRoute(valueReq({ value: PLAINTEXT, delivery_enabled: true }), ctx);
    expect(res.status).toBe(200);
    expect(mockSetDeliveryEnabled).toHaveBeenCalledWith(mockSql, 'org_test', 'sec_1', true);
    const json = await res.json();
    expect(json.delivery_enabled).toBe(1);
  });
});

describe('clear value', () => {
  it('clears with explicit null and audits secret.value_cleared', async () => {
    const res = await valueRoute(valueReq({ value: null }), ctx);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.has_value).toBe(false);
    expect(json.value_set_at).toBeNull();
    expect(mockClearSecretValue).toHaveBeenCalledWith(mockSql, 'org_test', 'sec_1');
    expect(mockLogActivity.mock.calls[0][0].action).toBe('secret.value_cleared');
  });
});

describe('validation', () => {
  it('400s on empty body', async () => {
    const res = await valueRoute(valueReq({}), ctx);
    expect(res.status).toBe(400);
  });

  it('400s on empty-string value', async () => {
    const res = await valueRoute(valueReq({ value: '' }), ctx);
    expect(res.status).toBe(400);
  });

  it('400s on oversized value (> 8192 chars)', async () => {
    const res = await valueRoute(valueReq({ value: 'x'.repeat(8193) }), ctx);
    expect(res.status).toBe(400);
    expect(mockSetSecretValue).not.toHaveBeenCalled();
  });

  it('400s when enabling delivery on a non-env-safe name', async () => {
    mockGetSecret.mockResolvedValue({ id: 'sec_1', name: 'stripe-prod-key', delivery_enabled: 0 });
    const res = await valueRoute(valueReq({ value: PLAINTEXT, delivery_enabled: true }), ctx);
    expect(res.status).toBe(400);
    expect(mockSetSecretValue).not.toHaveBeenCalled();
  });

  it('404s when the secret does not exist', async () => {
    mockGetSecret.mockResolvedValue(null);
    const res = await valueRoute(valueReq({ value: PLAINTEXT }), ctx);
    expect(res.status).toBe(404);
  });
});

describe('GET /api/secrets list is write-only', () => {
  it('rows expose has_value/delivery_enabled but never value_encrypted or value', async () => {
    // Row shaped exactly as the repository SELECT projects it.
    mockListSecrets.mockResolvedValueOnce([{
      id: 'sec_1', org_id: 'org_test', agent_id: null, name: 'OPENAI_API_KEY',
      last_rotated_at: '2026-06-01T00:00:00Z', rotation_interval_days: 90,
      notes: null, created_at: '2026-05-01T00:00:00Z', updated_at: '2026-06-01T00:00:00Z',
      has_value: true, value_set_at: '2026-06-01T00:00:00Z', delivery_enabled: 1,
      next_rotation_due: '2026-08-30T00:00:00Z',
    }]);
    const res = await listRoute(makeRequest('http://test/api/secrets'));
    expect(res.status).toBe(200);
    const json = await res.json();
    const row = json.secrets[0];
    expect(row.has_value).toBe(true);
    expect(row.delivery_enabled).toBe(1);
    expect(row.value_set_at).toBeTruthy();
    expect(Object.keys(row)).not.toContain('value_encrypted');
    expect(Object.keys(row)).not.toContain('value');
  });
});
