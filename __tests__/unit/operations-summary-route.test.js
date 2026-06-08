import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSqlMock, makeRequest } from '../helpers.js';

// --- Mocks ---

let mockSqlInstance;
const mockGetOrgId = vi.fn(() => 'org_test');

vi.mock('../../app/lib/db.js', () => ({ getSql: () => mockSqlInstance }));
vi.mock('../../app/lib/org.js', () => ({ getOrgId: (...a) => mockGetOrgId(...a) }));

const { GET } = await import('../../app/api/operations/summary/route.js');

// --- Helpers ---

function getReq() {
  return makeRequest('http://localhost:3000/api/operations/summary', {
    headers: { 'x-api-key': 'oc_live_test' },
  });
}

describe('GET /api/operations/summary', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns full summary with all sections', async () => {
    mockSqlInstance = createSqlMock({
      taggedResponses: [
        // throughput
        [{ last_1h: 42, last_24h: 300 }],
        // latency
        [{ p50: 150, p95: 800 }],
        // approval backlog
        [{ pending_count: 3, oldest_minutes: 45, avg_wait_minutes: 20 }],
        // workflow health
        [{ running: 2, failed_24h: 1, completed_24h: 15, avg_duration_ms: 5000 }],
        // capability health — 'untested' is its own bucket so the denominator
        // (healthy+degraded+failing+untested) equals the true total.
        [{ healthy: 10, degraded: 2, failing: 1, untested: 4 }],
      ],
    });

    const res = await GET(getReq());
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.throughput).toEqual({ last_1h: 42, last_24h: 300 });
    expect(data.latency).toEqual({ p50_ms: 150, p95_ms: 800 });
    expect(data.approval_backlog).toEqual({ pending_count: 3, oldest_minutes: 45, avg_wait_minutes: 20 });
    expect(data.workflows).toEqual({ running: 2, failed_24h: 1, completed_24h: 15, avg_duration_ms: 5000 });
    expect(data.capabilities).toEqual({ healthy: 10, degraded: 2, failing: 1, untested: 4 });
  });

  it('returns zero defaults when queries return empty', async () => {
    mockSqlInstance = createSqlMock({
      taggedResponses: [
        [{}], // throughput — empty row
        [{}], // latency
        [{}], // approval backlog
        [{}], // workflow health
        [{}], // capability health
      ],
    });

    const res = await GET(getReq());
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.throughput).toEqual({ last_1h: 0, last_24h: 0 });
    expect(data.latency).toEqual({ p50_ms: 0, p95_ms: 0 });
    expect(data.approval_backlog).toEqual({ pending_count: 0, oldest_minutes: 0, avg_wait_minutes: 0 });
    expect(data.workflows).toEqual({ running: 0, failed_24h: 0, completed_24h: 0, avg_duration_ms: 0 });
    expect(data.capabilities).toEqual({ healthy: 0, degraded: 0, failing: 0, untested: 0 });
  });

  it('returns 500 on DB error', async () => {
    mockSqlInstance = () => { throw new Error('connection refused'); };

    const res = await GET(getReq());
    const data = await res.json();

    expect(res.status).toBe(500);
    expect(data.error).toBeDefined();
  });
});
