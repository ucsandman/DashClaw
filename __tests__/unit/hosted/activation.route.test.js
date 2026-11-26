import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { BROWSER_FIRST_ACTION_AGENT_ID } from '../../../app/lib/hosted/browser-action.js';

const { GET } = await import('../../../app/api/hosted/activation/route.ts');

// Middleware strips client-sent x-org-* headers and sets them from the
// verified principal (trial cookie, API key, session). The route trusts
// only that header, so these requests model what reaches it post-middleware.
function req(path, headers = {}) {
  return new Request(`http://localhost:3000${path}`, { headers });
}

const LIVE_ROW = {
  org_id: 'org_a',
  minted_at_ms: 1_700_000_000_000,
  key_used: true,
  first_key_used_at_ms: 1_700_000_010_000,
  first_seen_at_ms: null,
  last_seen_at_ms: null,
  mint_source: null,
  exported_at_ms: null,
  first_action_at_ms: 1_700_000_020_000,
  last_action_at_ms: 1_700_000_020_000,
  first_action_agent_id: 'my-agent',
  action_count: 1,
};

function sqlValues(call) {
  // tagged template: [strings, ...values]
  return call.slice(1);
}

describe('GET /api/hosted/activation', () => {
  const mockSql = vi.fn();

  beforeEach(() => {
    mockSql.mockReset();
    globalThis.__dashclaw_sql = mockSql;
    process.env.DASHCLAW_HOSTED = 'true';
  });

  afterEach(() => {
    delete globalThis.__dashclaw_sql;
    delete process.env.DASHCLAW_HOSTED;
  });

  it('404 when hosted mode is off, and reads nothing', async () => {
    delete process.env.DASHCLAW_HOSTED;
    const res = await GET(req('/api/hosted/activation', { 'x-org-id': 'org_a' }));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('Not found');
    expect(mockSql).not.toHaveBeenCalled();
  });

  it('401 when the request carries no authenticated org, and reads nothing', async () => {
    const res = await GET(req('/api/hosted/activation'));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('Unauthorized');
    expect(mockSql).not.toHaveBeenCalled();
  });

  it('403 when asking about another org, and reads nothing', async () => {
    const res = await GET(req('/api/hosted/activation?workspace_id=org_b', { 'x-org-id': 'org_a' }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('Not your workspace');
    expect(mockSql).not.toHaveBeenCalled();
  });

  it('404 when the caller org is not a live hosted trial (e.g. the operator org)', async () => {
    mockSql.mockResolvedValueOnce([]); // queryLiveTrialFacts: no live trial row
    const res = await GET(req('/api/hosted/activation', { 'x-org-id': 'org_default' }));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('Not a trial workspace');
  });

  it('200 with the caller org checklist; every query is scoped to the caller org', async () => {
    mockSql
      .mockResolvedValueOnce([LIVE_ROW]) // queryLiveTrialFacts(org_a)
      .mockResolvedValueOnce([{ first_agent_action_at_ms: null, first_approval_at_ms: 1_700_000_030_000 }]);
    const res = await GET(req('/api/hosted/activation?workspace_id=org_a', { 'x-org-id': 'org_a' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.json();
    expect(body.workspace_id).toBe('org_a');
    expect(body.steps.map((s) => [s.id, s.done])).toEqual([
      ['key_used', true],
      ['first_call', true],
      ['approval_landed', true],
    ]);
    expect(body.complete).toBe(true);
    expect(mockSql).toHaveBeenCalledTimes(2);
    for (const call of mockSql.mock.calls) {
      const values = sqlValues(call);
      expect(values).toContain('org_a');
      expect(values).not.toContain('org_b');
    }
  });

  it('a browser-only first action does not count as the first agent call', async () => {
    mockSql
      .mockResolvedValueOnce([{ ...LIVE_ROW, key_used: false, first_action_agent_id: BROWSER_FIRST_ACTION_AGENT_ID }])
      .mockResolvedValueOnce([{ first_agent_action_at_ms: null, first_approval_at_ms: null }]);
    const res = await GET(req('/api/hosted/activation', { 'x-org-id': 'org_a' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.steps.map((s) => [s.id, s.done])).toEqual([
      ['key_used', false],
      ['first_call', false],
      ['approval_landed', false],
    ]);
    expect(body.current).toBe('key_used');
  });

  it('500 with a structured error when the read fails', async () => {
    mockSql.mockRejectedValueOnce(new Error('db down'));
    const res = await GET(req('/api/hosted/activation', { 'x-org-id': 'org_a' }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('Internal server error');
  });
});
