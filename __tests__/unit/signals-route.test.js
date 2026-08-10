import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRequest } from '../helpers.js';

// --- Mocks ---

const mockSqlInstance = vi.fn();
const mockGetOrgId = vi.fn(() => 'org_test');
const mockComputeSignals = vi.fn();
const mockAddDismissals = vi.fn();

vi.mock('../../app/lib/db.js', () => ({ getSql: () => mockSqlInstance }));
vi.mock('../../app/lib/org.js', () => ({ getOrgId: (...a) => mockGetOrgId(...a) }));
vi.mock('../../app/lib/signals.js', () => ({
  computeSignals: (...a) => mockComputeSignals(...a),
}));
vi.mock('../../app/lib/repositories/signal-dismissals.repository.js', () => ({
  addDismissals: (...a) => mockAddDismissals(...a),
}));

const { GET, POST } = await import('../../app/api/signals/route.js');

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

    expect(mockComputeSignals).toHaveBeenCalledWith('org_test', 'agent_42', expect.anything());
  });

  it('passes null when no agent_id filter', async () => {
    mockComputeSignals.mockResolvedValueOnce([]);

    await GET(getReq());

    expect(mockComputeSignals).toHaveBeenCalledWith('org_test', null, expect.anything());
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

describe('POST /api/signals (dismissals)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('records dismiss keys for the org and reports the count', async () => {
    mockAddDismissals.mockResolvedValueOnce(2);

    const res = await POST(postReq({ dismiss_keys: ['k1', 'k2'] }));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.dismissed).toBe(2);
    expect(data.received).toBe(2);
    expect(mockAddDismissals).toHaveBeenCalledWith(expect.anything(), 'org_test', ['k1', 'k2']);
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

  it('rejects more than 1000 keys in one request', async () => {
    const keys = Array.from({ length: 1001 }, (_, i) => `k${i}`);
    expect((await POST(postReq({ dismiss_keys: keys }))).status).toBe(400);
    expect(mockAddDismissals).not.toHaveBeenCalled();
  });

  it('returns 500 when the repository write fails', async () => {
    mockAddDismissals.mockRejectedValueOnce(new Error('DB down'));
    const res = await POST(postReq({ dismiss_keys: ['k1'] }));
    expect(res.status).toBe(500);
  });
});
