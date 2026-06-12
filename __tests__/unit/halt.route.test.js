/**
 * /api/halt — org kill switch endpoint (Organ 3, Phase 4).
 *
 * Admin-gated per the approvals/bulk pattern; both transitions write an
 * activity_logs audit row; setting the switch eagerly invalidates the guard
 * settings cache so it takes effect immediately.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRequest } from '../helpers.js';

const { mockSql, mockGetSettings, mockUpsertSetting, mockInvalidate, mockLogActivity } = vi.hoisted(() => ({
  mockSql: Object.assign(vi.fn(async () => []), { query: vi.fn(async () => []) }),
  mockGetSettings: vi.fn(async () => []),
  mockUpsertSetting: vi.fn(async () => undefined),
  mockInvalidate: vi.fn(),
  mockLogActivity: vi.fn(),
}));

vi.mock('@/lib/db.js', () => ({ getSql: () => mockSql }));
vi.mock('@/lib/repositories/settings.repository.js', () => ({
  getSettings: mockGetSettings,
  upsertSetting: mockUpsertSetting,
}));
vi.mock('@/lib/guard.js', () => ({ invalidateGuardSettingsCache: mockInvalidate }));
vi.mock('@/lib/audit.js', () => ({ logActivity: mockLogActivity }));

import { GET, POST } from '@/api/halt/route.js';

function adminHeaders(extra = {}) {
  return { 'x-org-id': 'org_1', 'x-org-role': 'admin', 'x-user-id': 'user_alice', ...extra };
}

describe('/api/halt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSettings.mockResolvedValue([]);
  });

  it('GET rejects non-admin callers with 403', async () => {
    const res = await GET(makeRequest('http://localhost/api/halt', {
      headers: { 'x-org-id': 'org_1', 'x-org-role': 'member' },
    }));
    expect(res.status).toBe(403);
  });

  it('POST rejects non-admin callers with 403 and writes nothing', async () => {
    const res = await POST(makeRequest('http://localhost/api/halt', {
      headers: { 'x-org-id': 'org_1', 'x-org-role': 'member' },
      body: { halted: true },
    }));
    expect(res.status).toBe(403);
    expect(mockUpsertSetting).not.toHaveBeenCalled();
    expect(mockLogActivity).not.toHaveBeenCalled();
  });

  it('POST rejects a non-boolean halted with 400', async () => {
    const res = await POST(makeRequest('http://localhost/api/halt', {
      headers: adminHeaders(),
      body: { halted: 'yes' },
    }));
    expect(res.status).toBe(400);
  });

  it('POST halted:true persists the state, invalidates eagerly, and audits org.halted', async () => {
    const res = await POST(makeRequest('http://localhost/api/halt', {
      headers: adminHeaders(),
      body: { halted: true, reason: 'incident response' },
    }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.halt.halted).toBe(true);
    expect(body.halt.actor).toBe('user_alice');
    expect(body.halt.reason).toBe('incident response');

    const upsert = mockUpsertSetting.mock.calls[0];
    expect(upsert[1]).toBe('org_1');
    expect(upsert[2].key).toBe('DASHCLAW_ORG_HALT');
    expect(upsert[2].category).toBe('general');
    expect(JSON.parse(upsert[2].value).halted).toBe(true);

    // Eager invalidation: the switch must not lag the guard cache TTL.
    expect(mockInvalidate).toHaveBeenCalledWith('org_1');

    const audit = mockLogActivity.mock.calls[0][0];
    expect(audit.action).toBe('org.halted');
    expect(audit.actorId).toBe('user_alice');
    expect(audit.resourceId).toBe('DASHCLAW_ORG_HALT');
    expect(audit.details.reason).toBe('incident response');
  });

  it('POST halted:false audits org.resumed', async () => {
    const res = await POST(makeRequest('http://localhost/api/halt', {
      headers: adminHeaders(),
      body: { halted: false },
    }));
    expect(res.status).toBe(200);
    expect(mockInvalidate).toHaveBeenCalledWith('org_1');
    expect(mockLogActivity.mock.calls[0][0].action).toBe('org.resumed');
  });

  it('GET returns the parsed halt state for admins', async () => {
    mockGetSettings.mockResolvedValue([
      { key: 'DASHCLAW_ORG_HALT', value: JSON.stringify({ halted: true, actor: 'alice', reason: 'incident', at: '2026-06-12T12:00:00.000Z' }) },
    ]);
    const res = await GET(makeRequest('http://localhost/api/halt', { headers: adminHeaders() }));
    const body = await res.json();
    expect(body.halt).toEqual({ halted: true, actor: 'alice', reason: 'incident', at: '2026-06-12T12:00:00.000Z' });
  });

  it('GET reports not-halted when no setting exists', async () => {
    const res = await GET(makeRequest('http://localhost/api/halt', { headers: adminHeaders() }));
    const body = await res.json();
    expect(body.halt.halted).toBe(false);
  });
});
