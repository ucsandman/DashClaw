import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const sqlMock = vi.fn();
vi.mock('@neondatabase/serverless', () => ({ neon: vi.fn(() => sqlMock) }));

const { GET, DELETE } = await import('../../../app/api/hosted/workspaces/[workspaceId]/route.js');

function req(method, id, { role = 'admin' } = {}) {
  return new Request(`http://localhost:3000/api/hosted/workspaces/${id}`, {
    method,
    headers: {
      'x-api-key': 'admin-key',
      'x-org-id': 'org_admin',
      'x-org-role': role,
    },
  });
}

function paramsPromise(workspaceId) {
  return Promise.resolve({ workspaceId });
}

describe('GET /api/hosted/workspaces/:id', () => {
  beforeEach(() => {
    sqlMock.mockReset();
    sqlMock.mockResolvedValue([]); // default for any unstubbed calls
    process.env.DASHCLAW_HOSTED = 'true';
    process.env.DATABASE_URL = 'postgres://fake';
    globalThis.__dashclaw_sql = sqlMock;
  });

  afterEach(() => {
    delete globalThis.__dashclaw_sql;
  });

  it('returns 404 when flag off', async () => {
    delete process.env.DASHCLAW_HOSTED;
    const res = await GET(req('GET', 'org_x'), { params: paramsPromise('org_x') });
    expect(res.status).toBe(404);
  });

  it('returns 403 when role is not admin/owner', async () => {
    const res = await GET(req('GET', 'org_x', { role: 'member' }), { params: paramsPromise('org_x') });
    expect(res.status).toBe(403);
  });

  it('returns 404 for unknown workspace', async () => {
    sqlMock.mockResolvedValueOnce([]);
    const res = await GET(req('GET', 'org_missing'), { params: paramsPromise('org_missing') });
    expect(res.status).toBe(404);
  });

  it('returns 404 for non-hosted org', async () => {
    sqlMock.mockResolvedValueOnce([{
      id: 'org_real', name: 'Real', hosted_mode: false,
      trial_ends_at: null, trial_action_cap: null, trial_actions_used: 0,
    }]);
    const res = await GET(req('GET', 'org_real'), { params: paramsPromise('org_real') });
    expect(res.status).toBe(404);
  });

  it('returns workspace summary for known hosted id', async () => {
    sqlMock.mockResolvedValueOnce([{
      id: 'org_x', name: 'Trial', hosted_mode: true,
      trial_ends_at: '2026-05-18T00:00:00Z', trial_action_cap: 10000, trial_actions_used: 17,
    }]);
    const res = await GET(req('GET', 'org_x'), { params: paramsPromise('org_x') });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      workspace_id: 'org_x',
      trial_ends_at: '2026-05-18T00:00:00Z',
      trial_actions_used: 17,
    });
  });
});

describe('DELETE /api/hosted/workspaces/:id', () => {
  beforeEach(() => {
    sqlMock.mockReset();
    sqlMock.mockResolvedValue([]);
    process.env.DASHCLAW_HOSTED = 'true';
    globalThis.__dashclaw_sql = sqlMock;
  });

  afterEach(() => {
    delete globalThis.__dashclaw_sql;
  });

  it('refuses to delete non-hosted orgs (404)', async () => {
    sqlMock.mockResolvedValueOnce([{ hosted_mode: false }]);
    const res = await DELETE(req('DELETE', 'org_real'), { params: paramsPromise('org_real') });
    expect(res.status).toBe(404);
  });

  it('deletes a hosted workspace (200)', async () => {
    sqlMock.mockResolvedValueOnce([{ hosted_mode: true }]); // existence check
    sqlMock.mockResolvedValueOnce([]); // revoke keys
    sqlMock.mockResolvedValueOnce([]); // delete org
    const res = await DELETE(req('DELETE', 'org_x'), { params: paramsPromise('org_x') });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ deleted: true, workspace_id: 'org_x' });
  });
});

// --- Cleanup sweeper tests ---
const { POST: cleanupPOST } = await import('../../../app/api/hosted/cleanup/route.js');

describe('POST /api/hosted/cleanup', () => {
  beforeEach(() => {
    sqlMock.mockReset();
    sqlMock.mockResolvedValue([]);
    process.env.DASHCLAW_HOSTED = 'true';
    globalThis.__dashclaw_sql = sqlMock;
  });

  afterEach(() => {
    delete globalThis.__dashclaw_sql;
    delete process.env.HOSTED_CLEANUP_SECRET;
    delete process.env.CRON_SECRET;
  });

  function req({ role = 'admin', cleanupSecret } = {}) {
    const headers = {};
    if (role) headers['x-org-role'] = role;
    if (cleanupSecret) headers['x-cleanup-secret'] = cleanupSecret;
    return new Request('http://localhost:3000/api/hosted/cleanup', {
      method: 'POST',
      headers,
    });
  }

  it('returns 404 when flag off', async () => {
    delete process.env.DASHCLAW_HOSTED;
    const res = await cleanupPOST(req());
    expect(res.status).toBe(404);
  });

  it('returns 403 when role is not admin/owner and no cleanup secret', async () => {
    const res = await cleanupPOST(req({ role: 'member' }));
    expect(res.status).toBe(403);
  });

  it('accepts valid x-cleanup-secret header', async () => {
    process.env.HOSTED_CLEANUP_SECRET = 'super-secret';
    sqlMock.mockResolvedValueOnce([]); // findExpired returns empty
    const res = await cleanupPOST(req({ role: null, cleanupSecret: 'super-secret' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ found: 0, deleted: 0, errors: [] });
  });

  it('rejects a wrong x-cleanup-secret (403)', async () => {
    process.env.HOSTED_CLEANUP_SECRET = 'super-secret';
    const res = await cleanupPOST(req({ role: null, cleanupSecret: 'wrong' }));
    expect(res.status).toBe(403);
  });

  it('deletes each expired workspace and returns counts', async () => {
    // 1: findExpiredWorkspaces returns two orgs
    sqlMock.mockResolvedValueOnce([{ id: 'org_a' }, { id: 'org_b' }]);
    // org_a delete: existence check -> hosted, revoke keys, queryLiveTrialFacts,
    // INSERT snapshot, FK catalog discovery (no children mocked), delete org
    sqlMock.mockResolvedValueOnce([{ hosted_mode: true }]);
    sqlMock.mockResolvedValueOnce([]);
    sqlMock.mockResolvedValueOnce([{ org_id: 'org_a', minted_at_ms: Date.now() - 86400000, key_used: false, first_action_at_ms: null, last_action_at_ms: null, action_count: 0 }]); // queryLiveTrialFacts
    sqlMock.mockResolvedValueOnce([]); // INSERT snapshot
    sqlMock.mockResolvedValueOnce([]);
    sqlMock.mockResolvedValueOnce([]);
    // org_b delete: same pattern
    sqlMock.mockResolvedValueOnce([{ hosted_mode: true }]);
    sqlMock.mockResolvedValueOnce([]);
    sqlMock.mockResolvedValueOnce([{ org_id: 'org_b', minted_at_ms: Date.now() - 86400000, key_used: false, first_action_at_ms: null, last_action_at_ms: null, action_count: 0 }]); // queryLiveTrialFacts
    sqlMock.mockResolvedValueOnce([]); // INSERT snapshot
    sqlMock.mockResolvedValueOnce([]);
    sqlMock.mockResolvedValueOnce([]);
    const res = await cleanupPOST(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ found: 2, deleted: 2 });
  });

  it('collects per-org errors without aborting the sweep', async () => {
    sqlMock.mockResolvedValueOnce([{ id: 'org_fail' }, { id: 'org_ok' }]);
    // org_fail: existence check throws
    sqlMock.mockRejectedValueOnce(new Error('db flaked'));
    // org_ok: normal delete (existence, revoke, queryLiveTrialFacts, INSERT snapshot, FK discovery, org delete)
    sqlMock.mockResolvedValueOnce([{ hosted_mode: true }]);
    sqlMock.mockResolvedValueOnce([]);
    sqlMock.mockResolvedValueOnce([{ org_id: 'org_ok', minted_at_ms: Date.now() - 86400000, key_used: false, first_action_at_ms: null, last_action_at_ms: null, action_count: 0 }]); // queryLiveTrialFacts
    sqlMock.mockResolvedValueOnce([]); // INSERT snapshot
    sqlMock.mockResolvedValueOnce([]);
    sqlMock.mockResolvedValueOnce([]);
    const res = await cleanupPOST(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.found).toBe(2);
    expect(body.deleted).toBe(1);
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0]).toMatchObject({ orgId: 'org_fail' });
  });

  it('accepts Authorization: Bearer <CRON_SECRET> (Vercel cron convention)', async () => {
    process.env.CRON_SECRET = 'vercel-cron-secret';
    sqlMock.mockResolvedValueOnce([]); // findExpired returns empty
    const r = new Request('http://localhost:3000/api/hosted/cleanup', {
      method: 'POST',
      headers: { authorization: 'Bearer vercel-cron-secret' },
    });
    const res = await cleanupPOST(r);
    expect(res.status).toBe(200);
  });

  it('rejects a wrong Authorization: Bearer value (403)', async () => {
    process.env.CRON_SECRET = 'vercel-cron-secret';
    const r = new Request('http://localhost:3000/api/hosted/cleanup', {
      method: 'POST',
      headers: { authorization: 'Bearer wrong' },
    });
    const res = await cleanupPOST(r);
    expect(res.status).toBe(403);
  });
});
