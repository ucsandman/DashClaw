import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRequest } from '../helpers.js';

const { mockSql, mockLogActivity } = vi.hoisted(() => ({
  mockSql: Object.assign(vi.fn(async () => []), { query: vi.fn(async () => []) }),
  mockLogActivity: vi.fn(),
}));

vi.mock('@/lib/db.js', () => ({ getSql: () => mockSql }));
vi.mock('@/lib/audit.js', () => ({ logActivity: mockLogActivity }));

import { GET, POST, DELETE } from '@/api/keys/route.js';

beforeEach(() => {
  vi.clearAllMocks();
  process.env.DATABASE_URL = 'postgres://unit-test';
  mockSql.mockImplementation(async () => []);
  mockSql.query.mockImplementation(async () => []);
  mockLogActivity.mockResolvedValue(undefined);
});

describe('/api/keys GET', () => {
  it('returns keys for the org', async () => {
    const keys = [{ id: 'key_1', key_prefix: 'oc_live_', label: 'Test Key', role: 'admin' }];
    mockSql.mockResolvedValueOnce(keys);

    const res = await GET(makeRequest('http://localhost/api/keys', {
      headers: { 'x-org-id': 'org_1' },
    }));

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.keys).toEqual(keys);
  });



  it('returns 500 on db error', async () => {
    mockSql.mockRejectedValueOnce(new Error('db fail'));

    const res = await GET(makeRequest('http://localhost/api/keys', {
      headers: { 'x-org-id': 'org_1' },
    }));

    expect(res.status).toBe(500);
  });
});

describe('/api/keys POST', () => {
  it('generates a new API key for admin', async () => {
    mockSql.mockResolvedValue([]);

    const res = await POST(makeRequest('http://localhost/api/keys', {
      headers: { 'x-org-id': 'org_1', 'x-org-role': 'admin', 'x-user-id': 'user_1' },
      body: { label: 'My Agent Key' },
    }));

    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.key.raw_key).toMatch(/^oc_live_/);
    expect(data.key.label).toBe('My Agent Key');
    expect(data.key.storageWarning).toContain('this key now');
  });

  it('returns 403 for non-admin', async () => {
    const res = await POST(makeRequest('http://localhost/api/keys', {
      headers: { 'x-org-id': 'org_1', 'x-org-role': 'member' },
      body: { label: 'Key' },
    }));

    expect(res.status).toBe(403);
  });



  it('returns 400 for label exceeding 256 chars', async () => {
    const res = await POST(makeRequest('http://localhost/api/keys', {
      headers: { 'x-org-id': 'org_1', 'x-org-role': 'admin' },
      body: { label: 'x'.repeat(257) },
    }));

    expect(res.status).toBe(400);
  });

  it('uses default label when none provided', async () => {
    mockSql.mockResolvedValue([]);

    const res = await POST(makeRequest('http://localhost/api/keys', {
      headers: { 'x-org-id': 'org_1', 'x-org-role': 'admin', 'x-user-id': 'user_1' },
      body: {},
    }));

    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.key.label).toBe('API Key');
  });

  it('defaults the key role to member when none is provided (least privilege)', async () => {
    mockSql.mockResolvedValue([]);

    const res = await POST(makeRequest('http://localhost/api/keys', {
      headers: { 'x-org-id': 'org_1', 'x-org-role': 'admin', 'x-user-id': 'user_1' },
      body: { label: 'Key' },
    }));

    expect(res.status).toBe(201);
    const data = await res.json();
    // Security review 2026-07-05: an implicit admin default let agent keys
    // approve their own pending actions. Admin must be requested explicitly.
    expect(data.key.role).toBe('member');
  });

  it('still honors an explicit admin role', async () => {
    mockSql.mockResolvedValue([]);

    const res = await POST(makeRequest('http://localhost/api/keys', {
      headers: { 'x-org-id': 'org_1', 'x-org-role': 'admin', 'x-user-id': 'user_1' },
      body: { label: 'Key', role: 'admin' },
    }));

    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.key.role).toBe('admin');
  });

  it('honors an explicit member role and returns it', async () => {
    mockSql.mockResolvedValue([]);

    const res = await POST(makeRequest('http://localhost/api/keys', {
      headers: { 'x-org-id': 'org_1', 'x-org-role': 'admin', 'x-user-id': 'user_1' },
      body: { label: 'Read/write key', role: 'member' },
    }));

    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.key.role).toBe('member');
    // the role was bound into the INSERT, not silently forced to admin
    const insertCall = mockSql.mock.calls.find((c) => Array.isArray(c[0]) && c[0].join('').includes('INSERT INTO api_keys'));
    expect(insertCall).toBeTruthy();
    expect(insertCall.slice(1)).toContain('member');
  });

  it('rejects an invalid role with 400 before inserting', async () => {
    const res = await POST(makeRequest('http://localhost/api/keys', {
      headers: { 'x-org-id': 'org_1', 'x-org-role': 'admin' },
      body: { label: 'Key', role: 'superuser' },
    }));

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/role must be one of/i);
  });

  it('returns 500 on db error', async () => {
    mockSql.mockRejectedValue(new Error('insert failed'));

    const res = await POST(makeRequest('http://localhost/api/keys', {
      headers: { 'x-org-id': 'org_1', 'x-org-role': 'admin' },
      body: { label: 'Key' },
    }));

    expect(res.status).toBe(500);
  });
});

describe('/api/keys DELETE', () => {
  it('revokes an existing key', async () => {
    mockSql
      .mockResolvedValueOnce([{ id: 'key_abc', revoked_at: null }]) // SELECT check
      .mockResolvedValueOnce([]); // UPDATE

    const res = await DELETE(makeRequest('http://localhost/api/keys?id=key_abc', {
      headers: { 'x-org-id': 'org_1', 'x-org-role': 'admin', 'x-user-id': 'user_1' },
    }));

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.revoked).toBe('key_abc');
  });

  it('returns 403 for non-admin', async () => {
    const res = await DELETE(makeRequest('http://localhost/api/keys?id=key_abc', {
      headers: { 'x-org-id': 'org_1', 'x-org-role': 'member' },
    }));

    expect(res.status).toBe(403);
  });



  it('returns 400 for missing or invalid key id', async () => {
    const res = await DELETE(makeRequest('http://localhost/api/keys', {
      headers: { 'x-org-id': 'org_1', 'x-org-role': 'admin' },
    }));

    expect(res.status).toBe(400);
  });

  it('returns 400 for id without key_ prefix', async () => {
    const res = await DELETE(makeRequest('http://localhost/api/keys?id=badid', {
      headers: { 'x-org-id': 'org_1', 'x-org-role': 'admin' },
    }));

    expect(res.status).toBe(400);
  });

  it('returns 404 when key not found', async () => {
    mockSql.mockResolvedValueOnce([]); // empty SELECT

    const res = await DELETE(makeRequest('http://localhost/api/keys?id=key_missing', {
      headers: { 'x-org-id': 'org_1', 'x-org-role': 'admin' },
    }));

    expect(res.status).toBe(404);
  });

  it('returns 409 for already-revoked key', async () => {
    mockSql.mockResolvedValueOnce([{ id: 'key_abc', revoked_at: '2026-01-01T00:00:00Z' }]);

    const res = await DELETE(makeRequest('http://localhost/api/keys?id=key_abc', {
      headers: { 'x-org-id': 'org_1', 'x-org-role': 'admin' },
    }));

    expect(res.status).toBe(409);
  });

  it('returns 500 on db error', async () => {
    mockSql.mockRejectedValue(new Error('db error'));

    const res = await DELETE(makeRequest('http://localhost/api/keys?id=key_abc', {
      headers: { 'x-org-id': 'org_1', 'x-org-role': 'admin' },
    }));

    expect(res.status).toBe(500);
  });
});
