import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRequest } from '../helpers.js';

// v7.2 graduation path routes — auth gate, bundle contract, graduation stamp.

const { mockSql } = vi.hoisted(() => ({
  mockSql: Object.assign(vi.fn(async () => []), { query: vi.fn(async () => []) }),
}));

vi.mock('@/lib/db.js', () => ({ getSql: () => mockSql }));

import { GET as exportGET } from '@/api/workspace/export/route';
import { POST as importPOST } from '@/api/workspace/import/route';
import { BUNDLE_FORMAT, BUNDLE_VERSION } from '@/lib/repositories/workspace-bundle.repository';

const adminHeaders = { 'x-org-id': 'org_1', 'x-org-role': 'admin' };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.DATABASE_URL = 'postgres://unit-test';
  mockSql.query.mockImplementation(async (text) => {
    if (text.includes('SELECT id, name FROM organizations')) return [{ id: 'org_1', name: 'Acme' }];
    return [];
  });
});

describe('GET /api/workspace/export', () => {
  it('requires the admin role', async () => {
    const res = await exportGET(makeRequest('http://localhost/api/workspace/export', {
      headers: { 'x-org-id': 'org_1', 'x-org-role': 'member' },
    }));
    expect(res.status).toBe(403);
  });

  it('returns a versioned bundle as a named download and stamps graduation', async () => {
    const res = await exportGET(makeRequest('http://localhost/api/workspace/export', {
      headers: adminHeaders,
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.format).toBe(BUNDLE_FORMAT);
    expect(body.version).toBe(BUNDLE_VERSION);
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="dashclaw-workspace-.+\.json"$/);
    // The graduation stamp ran (hosted trials only; earliest wins).
    const stamp = mockSql.query.mock.calls.find(([text]) => String(text).includes('trial_exported_at'));
    expect(stamp).toBeTruthy();
    expect(String(stamp[0])).toContain('hosted_mode = TRUE');
  });
});

describe('POST /api/workspace/import', () => {
  it('requires the admin role', async () => {
    const res = await importPOST(makeRequest('http://localhost/api/workspace/import', {
      headers: { 'x-org-id': 'org_1', 'x-org-role': 'member' },
      body: {},
    }));
    expect(res.status).toBe(403);
  });

  it('rejects a malformed bundle with a 400, loudly', async () => {
    const res = await importPOST(makeRequest('http://localhost/api/workspace/import', {
      headers: adminHeaders,
      body: { format: 'not-a-bundle' },
    }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('format');
  });

  it('imports into the caller org and reports per-table counts', async () => {
    mockSql.query.mockImplementation(async (text) =>
      text.trimStart().startsWith('INSERT INTO guard_policies') ? [1] : []);
    const res = await importPOST(makeRequest('http://localhost/api/workspace/import', {
      headers: adminHeaders,
      body: {
        format: BUNDLE_FORMAT,
        version: BUNDLE_VERSION,
        exported_at: '2026-07-05T00:00:00.000Z',
        org: { id: 'org_other', name: 'src' },
        counts: {},
        tables: { guard_policies: [{ id: 'gp_1', name: 'p', policy_type: 't', rules: '{}' }] },
      },
    }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.imported).toBe(1);
    expect(body.counts.guard_policies).toEqual({ imported: 1, skipped: 0 });
    // Rows land in the CALLER's org, never the bundle's org.
    const insert = mockSql.query.mock.calls.find(([text]) => String(text).includes('INSERT INTO guard_policies'));
    expect(insert[1][0]).toBe('org_1');
  });
});
