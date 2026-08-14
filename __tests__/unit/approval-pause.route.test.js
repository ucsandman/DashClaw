/**
 * /api/approval-pause — the route THROUGH the real settings repository.
 *
 * Regression: the POST 500'd in production ("Internal server error") because
 * APPROVAL_PAUSE_KEY was never added to VALID_SETTING_KEYS, and every existing
 * test mocked settings.repository so the allowlist check never executed. This
 * file mocks only the db/audit edges and lets the repository validate the key
 * for real — the exact layer that failed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRequest } from '../helpers.js';

const { mockSql, mockLogActivity } = vi.hoisted(() => ({
  mockSql: Object.assign(vi.fn(async () => []), { query: vi.fn(async () => []) }),
  mockLogActivity: vi.fn(),
}));

vi.mock('@/lib/db.js', () => ({ getSql: () => mockSql }));
vi.mock('@/lib/audit.js', () => ({ logActivity: mockLogActivity }));

import { GET, POST, DELETE } from '@/api/approval-pause/route.js';

function adminHeaders(extra = {}) {
  return { 'x-org-id': 'org_1', 'x-org-role': 'admin', 'x-user-id': 'user_alice', ...extra };
}

describe('/api/approval-pause (real settings repository)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('POST 1h succeeds through the real upsertSetting key allowlist', async () => {
    const res = await POST(makeRequest('http://localhost/api/approval-pause', {
      headers: adminHeaders(),
      body: { hours: 1 },
    }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.pause.active).toBe(true);
    expect(body.pause.actor).toBe('user_alice');
    expect(mockLogActivity.mock.calls[0][0].action).toBe('org.approvals_paused');
  });

  it('DELETE succeeds through the real upsertSetting key allowlist', async () => {
    const res = await DELETE(makeRequest('http://localhost/api/approval-pause', {
      headers: adminHeaders(),
    }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.pause.active).toBe(false);
    expect(mockLogActivity.mock.calls[0][0].action).toBe('org.approvals_resumed');
  });

  it('POST rejects a window outside the allowlist with 400', async () => {
    const res = await POST(makeRequest('http://localhost/api/approval-pause', {
      headers: adminHeaders(),
      body: { hours: 2 },
    }));
    expect(res.status).toBe(400);
  });

  it('POST rejects non-admin callers with 403', async () => {
    const res = await POST(makeRequest('http://localhost/api/approval-pause', {
      headers: { 'x-org-id': 'org_1', 'x-org-role': 'member' },
      body: { hours: 1 },
    }));
    expect(res.status).toBe(403);
  });

  it('GET reports not-paused when no setting exists', async () => {
    const res = await GET(makeRequest('http://localhost/api/approval-pause', {
      headers: adminHeaders(),
    }));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.pause.active).toBe(false);
    expect(body.window_hours).toEqual([1, 4, 8, 24]);
  });
});
