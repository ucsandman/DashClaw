/**
 * v3.4 live-host canary — POST/GET /api/live-canary contract tests.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRequest } from '../helpers.js';

const { mockSql, mockGetOrgId, mockInsert, mockList } = vi.hoisted(() => ({
  mockSql: Object.assign(vi.fn(async () => []), { query: vi.fn(async () => []) }),
  mockGetOrgId: vi.fn(),
  mockInsert: vi.fn(),
  mockList: vi.fn(),
}));

vi.mock('@/lib/db.js', () => ({ getSql: () => mockSql }));
vi.mock('@/lib/org.js', () => ({ getOrgId: mockGetOrgId }));
vi.mock('@/lib/repositories/live-canary.repository.js', () => ({
  insertLiveCanaryRun: mockInsert,
  listLiveCanaryRunsForOrg: mockList,
}));
vi.mock('@/lib/apiErrors.js', () => ({
  apiErrorResponse: (error, label) => new Response(JSON.stringify({ error: error.message, label }), {
    status: 500,
    headers: { 'content-type': 'application/json' },
  }),
}));

import { GET, POST } from '@/api/live-canary/route.js';

const VALID_BODY = {
  source: 'github-actions',
  status: 'fail',
  checks: [
    { id: 'mcp-handshake', title: 'Hosted MCP handshake', status: 'fail', detail: 'expected 401, got 500', durationMs: 812, target: 'https://hosted.dashclaw.io/api/mcp' },
    { id: 'marketing-home', title: 'Marketing homepage', status: 'pass' },
  ],
  startedAt: '2026-07-04T06:00:00.000Z',
  finishedAt: '2026-07-04T06:00:20.000Z',
};

function postRequest(body) {
  return makeRequest('http://localhost/api/live-canary', { body });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetOrgId.mockReturnValue('org_1');
  mockInsert.mockResolvedValue({ id: 'lcr_abc' });
  mockList.mockResolvedValue([]);
});

describe('POST /api/live-canary', () => {
  it('stores a valid report and returns 201 with the run id', async () => {
    const res = await POST(postRequest(VALID_BODY));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: 'lcr_abc' });
    const [, orgId, input] = mockInsert.mock.calls[0];
    expect(orgId).toBe('org_1');
    expect(input.status).toBe('fail');
    expect(input.checks).toHaveLength(2);
  });

  it('rejects a status outside pass|fail', async () => {
    const res = await POST(postRequest({ ...VALID_BODY, status: 'warn' }));
    expect(res.status).toBe(400);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('rejects empty and oversized checks arrays', async () => {
    expect((await POST(postRequest({ ...VALID_BODY, checks: [] }))).status).toBe(400);
    const many = Array.from({ length: 51 }, (_, i) => ({ id: `p${i}`, title: `Probe ${i}`, status: 'pass' }));
    expect((await POST(postRequest({ ...VALID_BODY, checks: many }))).status).toBe(400);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('rejects a check with a non-ISO timestamp or missing title', async () => {
    expect((await POST(postRequest({ ...VALID_BODY, startedAt: 'yesterday' }))).status).toBe(400);
    expect((await POST(postRequest({
      ...VALID_BODY,
      checks: [{ id: 'x', status: 'pass' }],
    }))).status).toBe(400);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('strips unknown check fields rather than storing them', async () => {
    const res = await POST(postRequest({
      ...VALID_BODY,
      checks: [{ id: 'x', title: 'X', status: 'pass', extra: 'nope' }],
    }));
    expect(res.status).toBe(201);
    const [, , input] = mockInsert.mock.calls[0];
    expect(input.checks[0]).toEqual({ id: 'x', title: 'X', status: 'pass' });
  });
});

describe('GET /api/live-canary', () => {
  it('returns the latest run by default (limit 1)', async () => {
    mockList.mockResolvedValue([{ id: 'lcr_1', status: 'pass' }]);
    const res = await GET(makeRequest('http://localhost/api/live-canary'));
    expect(res.status).toBe(200);
    expect((await res.json()).runs).toHaveLength(1);
    expect(mockList).toHaveBeenCalledWith(mockSql, 'org_1', 1);
  });

  it('caps limit at 20', async () => {
    const res = await GET(makeRequest('http://localhost/api/live-canary?limit=100'));
    expect(res.status).toBe(400);
    expect(mockList).not.toHaveBeenCalled();
  });
});
