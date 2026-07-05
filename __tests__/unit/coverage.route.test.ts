/**
 * v4.2 coverage truth — POST/GET /api/coverage route.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRequest as rawRequest } from '../helpers.js';

const { mockSql, mockInsertCoverageReport, mockGetAgentCoverage } = vi.hoisted(() => ({
  mockSql: Object.assign(vi.fn(async () => []), { query: vi.fn(async () => []) }),
  mockInsertCoverageReport: vi.fn(),
  mockGetAgentCoverage: vi.fn(),
}));

vi.mock('@/lib/db.js', () => ({ getSql: () => mockSql }));
vi.mock('@/lib/repositories/coverage.repository.js', () => ({
  insertCoverageReport: mockInsertCoverageReport,
  getAgentCoverage: mockGetAgentCoverage,
}));

import { POST, GET } from '@/api/coverage/route.js';

const req = (body: unknown, url = 'http://localhost/api/coverage') =>
  rawRequest(url, { headers: { 'x-org-id': 'org_1' }, body }) as unknown as Request;

beforeEach(() => {
  vi.clearAllMocks();
  mockInsertCoverageReport.mockResolvedValue({ id: 'cov_1' });
  mockGetAgentCoverage.mockResolvedValue([]);
});

describe('POST /api/coverage', () => {
  it('201 on a valid report', async () => {
    const res = await POST(req({ agent_id: 'a1', harness: 'claude-code', harness_session_id: 's1', expected: 10, recorded: 8 }));
    expect(res.status).toBe(201);
    expect(mockInsertCoverageReport).toHaveBeenCalledWith(mockSql, expect.objectContaining({
      orgId: 'org_1', agentId: 'a1', expected: 10, recorded: 8,
    }));
  });

  it('accepts recorded > expected (records truth, clamps nothing)', async () => {
    const res = await POST(req({ agent_id: 'a1', expected: 5, recorded: 12 }));
    expect(res.status).toBe(201);
    expect(mockInsertCoverageReport).toHaveBeenCalledWith(mockSql, expect.objectContaining({ expected: 5, recorded: 12 }));
  });

  it('400 when agent_id is missing or empty', async () => {
    expect((await POST(req({ expected: 1, recorded: 1 }))).status).toBe(400);
    expect((await POST(req({ agent_id: '   ', expected: 1, recorded: 1 }))).status).toBe(400);
    expect(mockInsertCoverageReport).not.toHaveBeenCalled();
  });

  it('400 when agent_id exceeds 200 chars', async () => {
    const res = await POST(req({ agent_id: 'x'.repeat(201), expected: 1, recorded: 1 }));
    expect(res.status).toBe(400);
  });

  it('400 when expected/recorded are not non-negative integers', async () => {
    expect((await POST(req({ agent_id: 'a1', expected: -1, recorded: 0 }))).status).toBe(400);
    expect((await POST(req({ agent_id: 'a1', expected: 1.5, recorded: 0 }))).status).toBe(400);
    expect((await POST(req({ agent_id: 'a1', expected: 'x', recorded: 0 }))).status).toBe(400);
    expect((await POST(req({ agent_id: 'a1', recorded: 0 }))).status).toBe(400);
  });

  it('caps expected/recorded at 1e6', async () => {
    await POST(req({ agent_id: 'a1', expected: 5_000_000, recorded: 9_000_000 }));
    expect(mockInsertCoverageReport).toHaveBeenCalledWith(mockSql, expect.objectContaining({
      expected: 1_000_000, recorded: 1_000_000,
    }));
  });

  it('400 on a non-object body', async () => {
    expect((await POST(req(null))).status).toBe(400);
  });
});

describe('GET /api/coverage', () => {
  it('returns the per-agent coverage summary with default 24h window', async () => {
    mockGetAgentCoverage.mockResolvedValue([{ agentId: 'a1', expected: 10, recorded: 8, recordPct: 80, outcomePct: 90, outcomeSample: 20 }]);
    const res = await GET(req(undefined));
    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body.window_hours).toBe(24);
    expect((body.coverage as unknown[]).length).toBe(1);
    expect(mockGetAgentCoverage).toHaveBeenCalledWith(mockSql, 'org_1', 24, { includeSynthetic: false });
  });

  it('clamps ?window_hours to 1..168', async () => {
    await GET(req(undefined, 'http://localhost/api/coverage?window_hours=9999'));
    expect(mockGetAgentCoverage).toHaveBeenCalledWith(mockSql, 'org_1', 168, { includeSynthetic: false });
    await GET(req(undefined, 'http://localhost/api/coverage?window_hours=0'));
    expect(mockGetAgentCoverage).toHaveBeenCalledWith(mockSql, 'org_1', 1, { includeSynthetic: false });
  });

  it('?include_synthetic=1 is an ephemeral diagnostic view (flagged in the response, passed to the repository)', async () => {
    mockGetAgentCoverage.mockResolvedValue([]);
    const res = await GET(req(undefined, 'http://localhost/api/coverage?include_synthetic=1'));
    expect(mockGetAgentCoverage).toHaveBeenCalledWith(mockSql, 'org_1', 24, { includeSynthetic: true });
    const body = await res.json() as Record<string, unknown>;
    expect(body.synthetic_included).toBe(true);
  });
});
