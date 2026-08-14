import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRequest } from '../helpers.js';

// --- Mocks ---

const mockSqlInstance = vi.fn();
const mockGetOrgId = vi.fn(() => 'org_test');
const mockGetOrgRole = vi.fn(() => 'admin');
const mockGetUserId = vi.fn(() => 'user_admin');
const mockComputeSignals = vi.fn();
const mockAddDismissals = vi.fn();
const mockRemoveDismissals = vi.fn();

vi.mock('../../app/lib/db.js', () => ({ getSql: () => mockSqlInstance }));
vi.mock('../../app/lib/org.js', () => ({
  getOrgId: (...a) => mockGetOrgId(...a),
  getOrgRole: (...a) => mockGetOrgRole(...a),
  getUserId: (...a) => mockGetUserId(...a),
}));
vi.mock('../../app/lib/signals.js', () => ({
  computeSignals: (...a) => mockComputeSignals(...a),
}));
vi.mock('../../app/lib/repositories/signal-dismissals.repository.js', () => ({
  addDismissals: (...a) => mockAddDismissals(...a),
  removeDismissals: (...a) => mockRemoveDismissals(...a),
}));

const { GET, POST, DELETE } = await import('../../app/api/signals/route.js');

// --- Helpers ---

function getReq(params = '') {
  return makeRequest(`http://localhost:3000/api/signals${params}`, {
    headers: { 'x-api-key': 'oc_live_test' },
  });
}

describe('GET /api/signals', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns signals with severity counts', async () => {
    mockComputeSignals.mockResolvedValueOnce([
      { type: 'autonomy_spike', severity: 'red', label: 'Spike', agent_id: 'a1' },
      { type: 'stale_assumption', severity: 'amber', label: 'Stale', agent_id: 'a2' },
      { type: 'repeated_failures', severity: 'red', label: 'Failures', agent_id: 'a1' },
    ]);

    const res = await GET(getReq());
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.signals).toHaveLength(3);
    expect(data.counts.red).toBe(2);
    expect(data.counts.amber).toBe(1);
    expect(data.counts.total).toBe(3);
    expect(data.lastUpdated).toBeDefined();
  });

  it('returns empty signals when none detected', async () => {
    mockComputeSignals.mockResolvedValueOnce([]);

    const res = await GET(getReq());
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.signals).toHaveLength(0);
    expect(data.counts).toEqual({ red: 0, amber: 0, total: 0 });
  });

  it('passes agent_id filter to computeSignals', async () => {
    mockComputeSignals.mockResolvedValueOnce([]);

    await GET(getReq('?agent_id=agent_42'));

    // 4th arg is the muted sink computeSignals pushes suppressed signals into.
    expect(mockComputeSignals).toHaveBeenCalledWith('org_test', 'agent_42', expect.anything(), expect.any(Array));
  });

  it('passes null when no agent_id filter', async () => {
    mockComputeSignals.mockResolvedValueOnce([]);

    await GET(getReq());

    expect(mockComputeSignals).toHaveBeenCalledWith('org_test', null, expect.anything(), expect.any(Array));
  });

  // The panel re-mints the dismiss key from the JSON it gets back. For
  // mcp_degraded that key is built from the SERVER, so a muted entry without
  // mcp_server would mint a different key and Restore would silently no-op.
  it('carries mcp_server on muted entries so the key round-trips', async () => {
    mockComputeSignals.mockImplementationOnce(async (_org, _agent, _sql, muted) => {
      muted.push({
        type: 'mcp_degraded',
        label: 'MCP degraded: github-mcp (timeout)',
        severity: 'amber',
        agent_id: 'agent_a',
        mcp_server: 'github-mcp',
        detected_at: '2026-08-14T10:00:00.000Z',
      });
      return [];
    });

    const data = await (await GET(getReq())).json();

    expect(data.muted[0].mcp_server).toBe('github-mcp');
    expect(data.muted[0].dismiss_key).toBe('mcp_degraded:::::github-mcp');
  });

  it('returns 500 with safe defaults on error', async () => {
    mockComputeSignals.mockRejectedValueOnce(new Error('DB down'));

    const res = await GET(getReq());
    const data = await res.json();

    expect(res.status).toBe(500);
    expect(data.error).toBeDefined();
    expect(data.signals).toEqual([]);
    expect(data.counts).toEqual({ red: 0, amber: 0, total: 0 });
  });
});

function postReq(body) {
  // makeRequest's `body` is the parsed value its .json() resolves to.
  return makeRequest('http://localhost:3000/api/signals', {
    headers: { 'x-api-key': 'oc_live_test', 'content-type': 'application/json' },
    body,
  });
}

// Real six-slot keys — the route now shape-checks what it persists, so a
// placeholder like 'k1' is (correctly) rejected before it reaches the repo.
const KEY_1 = 'agent_silent:a1::::2026-08-14T10:00:00.000Z';
const KEY_2 = 'autonomy_spike:a2::::';
const manyKeys = (n) => Array.from({ length: n }, (_, i) => `agent_silent:a${i}::::2026-08-14T10:00:00.000Z`);

describe('POST /api/signals (dismissals)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('records dismiss keys for the org and reports the count', async () => {
    mockAddDismissals.mockResolvedValueOnce(2);

    const res = await POST(postReq({ dismiss_keys: [KEY_1, KEY_2] }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.dismissed).toBe(2);
    expect(data.received).toBe(2);
    expect(mockAddDismissals).toHaveBeenCalledWith(expect.anything(), 'org_test', [KEY_1, KEY_2], 'user_admin');
  });

  // A dismissal hides a live risk condition from the whole org — it has to be
  // attributable, or the audit trail says only "someone muted this".
  it('attributes the dismissal to the calling user', async () => {
    mockAddDismissals.mockResolvedValueOnce(1);
    mockGetUserId.mockReturnValueOnce('user_wes');

    await POST(postReq({ dismiss_keys: [KEY_1] }));

    expect(mockAddDismissals).toHaveBeenCalledWith(expect.anything(), 'org_test', [KEY_1], 'user_wes');
  });

  it('passes null rather than an empty string when the caller is anonymous', async () => {
    mockAddDismissals.mockResolvedValueOnce(1);
    mockGetUserId.mockReturnValueOnce('');

    await POST(postReq({ dismiss_keys: [KEY_1] }));

    expect(mockAddDismissals).toHaveBeenCalledWith(expect.anything(), 'org_test', [KEY_1], null);
  });

  it('rejects a non-admin caller with 403', async () => {
    mockGetOrgRole.mockReturnValueOnce('member');

    const res = await POST(postReq({ dismiss_keys: [KEY_1] }));

    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('Admin access required');
    expect(mockAddDismissals).not.toHaveBeenCalled();
  });

  it('rejects a missing or empty dismiss_keys array', async () => {
    expect((await POST(postReq({}))).status).toBe(400);
    expect((await POST(postReq({ dismiss_keys: [] }))).status).toBe(400);
    expect(mockAddDismissals).not.toHaveBeenCalled();
  });

  it('rejects non-string and oversized keys', async () => {
    expect((await POST(postReq({ dismiss_keys: [42] }))).status).toBe(400);
    expect((await POST(postReq({ dismiss_keys: ['x'.repeat(601)] }))).status).toBe(400);
    expect(mockAddDismissals).not.toHaveBeenCalled();
  });

  // Anything that isn't the six-slot key signalDismissKey mints can never match
  // a computed signal, so storing it is dead weight in the table forever.
  it('rejects keys that are not the minted six-slot shape', async () => {
    expect((await POST(postReq({ dismiss_keys: ['k1'] }))).status).toBe(400);
    expect((await POST(postReq({ dismiss_keys: ['agent_silent:a1'] }))).status).toBe(400);
    expect((await POST(postReq({ dismiss_keys: ['not_a_signal_type:a1::::'] }))).status).toBe(400);
    // One bad key in an otherwise valid batch rejects the whole request.
    expect((await POST(postReq({ dismiss_keys: [KEY_1, 'junk'] }))).status).toBe(400);
    expect(mockAddDismissals).not.toHaveBeenCalled();
  });

  it('rejects more than 1000 keys in one request', async () => {
    expect((await POST(postReq({ dismiss_keys: manyKeys(1001) }))).status).toBe(400);
    expect(mockAddDismissals).not.toHaveBeenCalled();
  });

  it('still accepts a full 1000-key batch', async () => {
    mockAddDismissals.mockResolvedValueOnce(1000);
    expect((await POST(postReq({ dismiss_keys: manyKeys(1000) }))).status).toBe(200);
  });

  it('returns 500 when the repository write fails', async () => {
    mockAddDismissals.mockRejectedValueOnce(new Error('DB down'));
    const res = await POST(postReq({ dismiss_keys: [KEY_1] }));
    expect(res.status).toBe(500);
  });
});

// Restore is the way back from a durable mute. Sampled-time signal types mute
// on (type, agent) rather than per occurrence, so without this endpoint one
// click could hide a live condition permanently.
describe('DELETE /api/signals (restore)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('removes the given dismiss keys and reports the count', async () => {
    mockRemoveDismissals.mockResolvedValueOnce(2);

    const res = await DELETE(postReq({ dismiss_keys: [KEY_1, KEY_2] }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.restored).toBe(2);
    expect(data.received).toBe(2);
    expect(mockRemoveDismissals).toHaveBeenCalledWith(expect.anything(), 'org_test', [KEY_1, KEY_2]);
  });

  it('rejects a non-admin caller with 403', async () => {
    mockGetOrgRole.mockReturnValueOnce('member');

    const res = await DELETE(postReq({ dismiss_keys: [KEY_1] }));

    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('Admin access required');
    expect(mockRemoveDismissals).not.toHaveBeenCalled();
  });

  it('applies the same validation caps as POST', async () => {
    expect((await DELETE(postReq({}))).status).toBe(400);
    expect((await DELETE(postReq({ dismiss_keys: [] }))).status).toBe(400);
    expect((await DELETE(postReq({ dismiss_keys: [123] }))).status).toBe(400);
    expect((await DELETE(postReq({ dismiss_keys: ['k1'] }))).status).toBe(400);
    expect((await DELETE(postReq({ dismiss_keys: manyKeys(1001) }))).status).toBe(400);
    expect(mockRemoveDismissals).not.toHaveBeenCalled();
  });

  it('returns 500 when the repository delete fails', async () => {
    mockRemoveDismissals.mockRejectedValueOnce(new Error('DB down'));
    expect((await DELETE(postReq({ dismiss_keys: [KEY_1] }))).status).toBe(500);
  });
});
