/**
 * v8.2 enforcement liveness — POST/GET /api/enforcement-liveness contract tests.
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
vi.mock('@/lib/repositories/enforcement-liveness.repository.js', () => ({
  insertEnforcementLivenessRun: mockInsert,
  listEnforcementLivenessRunsForOrg: mockList,
}));
vi.mock('@/lib/apiErrors.js', () => ({
  apiErrorResponse: (error, label) => new Response(JSON.stringify({ error: error.message, label }), {
    status: 500,
    headers: { 'content-type': 'application/json' },
  }),
}));

import { GET, POST } from '@/api/enforcement-liveness/route.js';

const VALID_BODY = {
  source: 'manual',
  verdict: 'held',
  detail: 'probe action was blocked by require_approval',
  hook: { installed: true, timeout_seconds: 30, mode: 'enforced', exit_code: 0, cancelled: false },
  witness: { path: '/tmp/enforcement-liveness-witness.json', executed: false },
  decision: 'require_approval',
  checks: [
    { id: 'hook-installed', title: 'Hook installed', status: 'pass', durationMs: 12 },
    { id: 'witness-absent', title: 'Witness file absent', status: 'pass' },
  ],
  startedAt: '2026-07-06T06:00:00.000Z',
  finishedAt: '2026-07-06T06:00:05.000Z',
};

function postRequest(body) {
  return makeRequest('http://localhost/api/enforcement-liveness', { body });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetOrgId.mockReturnValue('org_1');
  mockInsert.mockResolvedValue({ id: 'elr_abc' });
  mockList.mockResolvedValue([]);
});

describe('POST /api/enforcement-liveness', () => {
  it('stores a valid report and returns 201 with the run id', async () => {
    const res = await POST(postRequest(VALID_BODY));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: 'elr_abc' });
    const [, orgId, input] = mockInsert.mock.calls[0];
    expect(orgId).toBe('org_1');
    expect(input.verdict).toBe('held');
    expect(input.hook.installed).toBe(true);
    expect(input.witness.executed).toBe(false);
    expect(input.checks).toHaveLength(2);
  });

  it('defaults source to manual and decision to null when omitted', async () => {
    const { source, decision, ...rest } = VALID_BODY;
    const res = await POST(postRequest(rest));
    expect(res.status).toBe(201);
    const [, , input] = mockInsert.mock.calls[0];
    expect(input.source).toBe('manual');
    expect(input.decision).toBeNull();
  });

  it('rejects a verdict outside held|executed|unprovable', async () => {
    const res = await POST(postRequest({ ...VALID_BODY, verdict: 'warn' }));
    expect(res.status).toBe(400);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('rejects a missing or oversized detail', async () => {
    expect((await POST(postRequest({ ...VALID_BODY, detail: '' }))).status).toBe(400);
    expect((await POST(postRequest({ ...VALID_BODY, detail: 'x'.repeat(1001) }))).status).toBe(400);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('rejects a missing witness or a witness with the wrong shape', async () => {
    const { witness, ...rest } = VALID_BODY;
    expect((await POST(postRequest(rest))).status).toBe(400);
    expect((await POST(postRequest({ ...VALID_BODY, witness: { path: '/tmp/x' } }))).status).toBe(400);
    expect((await POST(postRequest({ ...VALID_BODY, witness: { path: '', executed: true } }))).status).toBe(400);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('rejects a missing hook.installed or a wrongly-typed hook field', async () => {
    expect((await POST(postRequest({ ...VALID_BODY, hook: { timeout_seconds: 30 } }))).status).toBe(400);
    expect((await POST(postRequest({
      ...VALID_BODY,
      hook: { installed: true, timeout_seconds: 'thirty' },
    }))).status).toBe(400);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('rejects empty and oversized checks arrays', async () => {
    expect((await POST(postRequest({ ...VALID_BODY, checks: [] }))).status).toBe(400);
    const many = Array.from({ length: 51 }, (_, i) => ({ id: `p${i}`, title: `Probe ${i}`, status: 'pass' }));
    expect((await POST(postRequest({ ...VALID_BODY, checks: many }))).status).toBe(400);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('accepts checks[].status of info', async () => {
    const res = await POST(postRequest({
      ...VALID_BODY,
      checks: [{ id: 'x', title: 'X', status: 'info', detail: 'no signal either way' }],
    }));
    expect(res.status).toBe(201);
    const [, , input] = mockInsert.mock.calls[0];
    expect(input.checks[0].status).toBe('info');
  });

  it('rejects a non-ISO startedAt/finishedAt', async () => {
    expect((await POST(postRequest({ ...VALID_BODY, startedAt: 'yesterday' }))).status).toBe(400);
    expect((await POST(postRequest({ ...VALID_BODY, finishedAt: 'not-a-date' }))).status).toBe(400);
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

describe('GET /api/enforcement-liveness', () => {
  it('returns the latest run by default (limit 1) with derived state', async () => {
    mockList.mockResolvedValue([{ id: 'elr_1', verdict: 'held', finished_at: new Date().toISOString() }]);
    const res = await GET(makeRequest('http://localhost/api/enforcement-liveness'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.runs).toHaveLength(1);
    expect(body.state).toBe('holding');
    expect(typeof body.stale_after_ms).toBe('number');
    expect(mockList).toHaveBeenCalledWith(mockSql, 'org_1', 1);
  });

  it('reports stale when no runs exist', async () => {
    mockList.mockResolvedValue([]);
    const res = await GET(makeRequest('http://localhost/api/enforcement-liveness'));
    expect((await res.json()).state).toBe('stale');
  });

  it('caps limit at 20', async () => {
    const res = await GET(makeRequest('http://localhost/api/enforcement-liveness?limit=100'));
    expect(res.status).toBe(400);
    expect(mockList).not.toHaveBeenCalled();
  });

  it('rejects a non-integer limit', async () => {
    const res = await GET(makeRequest('http://localhost/api/enforcement-liveness?limit=abc'));
    expect(res.status).toBe(400);
    expect(mockList).not.toHaveBeenCalled();
  });
});
