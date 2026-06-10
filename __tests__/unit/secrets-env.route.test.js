/**
 * GET /api/secrets/env — agent delivery endpoint.
 * Uses the REAL repository + REAL encryption (test ENCRYPTION_KEY) so the
 * route test exercises actual decryption, merge, and corrupt-row skipping.
 * Browser sessions (no x-api-key) must always 403, and every delivery
 * writes exactly one audit row containing names — never values.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRequest, createSqlMock } from '../helpers.js';

const { mockGetSql, mockGetOrgId, mockGetUserId, mockGetOrgRole, mockLogActivity } = vi.hoisted(() => ({
  mockGetSql: vi.fn(),
  mockGetOrgId: vi.fn(),
  mockGetUserId: vi.fn(),
  mockGetOrgRole: vi.fn(),
  mockLogActivity: vi.fn(),
}));

vi.mock('@/lib/db.js', () => ({ getSql: mockGetSql }));
vi.mock('@/lib/org.js', () => ({
  getOrgId: mockGetOrgId,
  getOrgRole: mockGetOrgRole,
  getUserId: mockGetUserId,
}));
vi.mock('@/lib/audit.js', () => ({ logActivity: mockLogActivity }));

import { GET as envRoute } from '@/api/secrets/env/route.js';
import { encrypt } from '../../app/lib/encryption.js';

const TEST_KEY = 'unit-test-encryption-key-32bytes';
const ORG_VALUE = 'org-wide-value-fixture';
const AGENT_VALUE = 'agent-specific-value-fixture';

let savedKey;
beforeAll(() => {
  savedKey = process.env.ENCRYPTION_KEY;
  process.env.ENCRYPTION_KEY = TEST_KEY;
});
afterAll(() => {
  if (savedKey === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = savedKey;
});

beforeEach(() => {
  vi.clearAllMocks();
  mockGetOrgId.mockReturnValue('org_test');
  mockGetUserId.mockReturnValue('');
});

function apiKeyRequest(url) {
  return makeRequest(url, { headers: { 'x-api-key': 'dck_test_key' } });
}

describe('GET /api/secrets/env', () => {
  it('403s readonly API keys — metadata-only principals cannot pull plaintext', async () => {
    mockGetOrgRole.mockReturnValueOnce('readonly');
    const res = await envRoute(apiKeyRequest('http://test/api/secrets/env?agent_id=clawdbot'));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/readonly/i);
  });

  it('403s browser-session requests (no x-api-key) with an explanation', async () => {
    const res = await envRoute(makeRequest('http://test/api/secrets/env?agent_id=hermes'));
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toMatch(/API-key/i);
  });

  it('400s when agent_id is missing', async () => {
    const res = await envRoute(apiKeyRequest('http://test/api/secrets/env'));
    expect(res.status).toBe(400);
  });

  it('delivers merged env (agent overrides org) and audits exactly one row with names, never values', async () => {
    const rows = [
      { id: 's1', org_id: 'org_test', agent_id: null, name: 'FOO', value_encrypted: encrypt(ORG_VALUE, 'org_test:s1') },
      { id: 's2', org_id: 'org_test', agent_id: 'hermes', name: 'FOO', value_encrypted: encrypt(AGENT_VALUE, 'org_test:s2') },
      { id: 's3', org_id: 'org_test', agent_id: null, name: 'BAR', value_encrypted: encrypt('bar-value', 'org_test:s3') },
    ];
    mockGetSql.mockReturnValue(createSqlMock({ taggedResponses: [rows] }));

    const res = await envRoute(apiKeyRequest('http://test/api/secrets/env?agent_id=hermes'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.env).toEqual({ FOO: AGENT_VALUE, BAR: 'bar-value' });
    expect(json.count).toBe(2);
    expect(json.delivered.sort()).toEqual(['BAR', 'FOO']);

    expect(mockLogActivity).toHaveBeenCalledTimes(1);
    const [opts] = mockLogActivity.mock.calls[0];
    expect(opts.action).toBe('secret.delivered');
    const serialized = JSON.stringify(opts.details);
    expect(serialized).toContain('hermes');
    expect(serialized).toContain('FOO');
    expect(serialized).toContain('BAR');
    expect(serialized).not.toContain(AGENT_VALUE);
    expect(serialized).not.toContain(ORG_VALUE);
  });

  it('skips a corrupt row without failing the bundle', async () => {
    const rows = [
      // Encrypted under a different row's AAD — auth fails, must be skipped.
      { id: 's1', org_id: 'org_test', agent_id: null, name: 'CORRUPT', value_encrypted: encrypt('x', 'org_test:other') },
      { id: 's2', org_id: 'org_test', agent_id: null, name: 'GOOD', value_encrypted: encrypt('good-value', 'org_test:s2') },
    ];
    mockGetSql.mockReturnValue(createSqlMock({ taggedResponses: [rows] }));

    const res = await envRoute(apiKeyRequest('http://test/api/secrets/env?agent_id=hermes'));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.env).toEqual({ GOOD: 'good-value' });
    expect(json.delivered).toEqual(['GOOD']);
  });
});
