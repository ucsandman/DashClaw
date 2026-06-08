import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRequest } from '../helpers.js';

const { mockSql, mockGetActionTraceData } = vi.hoisted(() => ({
  mockSql: vi.fn(async () => []),
  mockGetActionTraceData: vi.fn(),
}));

vi.mock('@/lib/db.js', () => ({ getSql: () => mockSql }));
vi.mock('@/lib/org.js', () => ({ getOrgId: () => 'org_test' }));
vi.mock('@/lib/repositories/actions.repository.js', () => ({
  getActionTraceData: mockGetActionTraceData,
}));

import { GET } from '@/api/actions/[actionId]/trace/route.js';

const defaultTraceData = {
  action: { action_id: 'act_1', declared_goal: 'do a thing', status: 'completed' },
  assumptions: [
    { assumption_id: 'as_1', assumption: 'A holds', validated: 1, invalidated: 0 },
    { assumption_id: 'as_2', assumption: 'B holds', validated: 0, invalidated: 1, invalidated_reason: 'nope' },
    { assumption_id: 'as_3', assumption: 'C unknown', validated: 0, invalidated: 0 },
  ],
  loops: [
    { loop_id: 'lp_1', description: 'still open', status: 'open', priority: 'high' },
    { loop_id: 'lp_2', description: 'done', status: 'resolved' },
  ],
  relatedActions: [
    { action_id: 'act_2', declared_goal: 'related ok', status: 'completed', error_message: null },
    { action_id: 'act_3', declared_goal: 'related bad', status: 'failed', error_message: 'boom' },
  ],
  subActions: [{ action_id: 'act_sub', declared_goal: 'child', status: 'completed' }],
  parentChain: [
    { action_id: 'act_parent', declared_goal: 'parent failed', status: 'failed', error_message: 'parent boom' },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetActionTraceData.mockResolvedValue(defaultTraceData);
});

describe('GET /api/actions/[actionId]/trace', () => {
  it('returns 200 with action + trace summaries on the success path', async () => {
    const req = makeRequest('http://localhost/api/actions/act_1/trace', {
      headers: { 'x-org-id': 'org_test' },
    });
    const res = await GET(req, { params: Promise.resolve({ actionId: 'act_1' }) });

    expect(res.status).toBe(200);
    const body = await res.json();

    // action is passed through verbatim
    expect(body).toHaveProperty('action');
    expect(body.action.action_id).toBe('act_1');

    // trace wrapper with all sections
    expect(body).toHaveProperty('trace');
    expect(body.trace).toHaveProperty('assumptions');
    expect(body.trace).toHaveProperty('loops');
    expect(body.trace).toHaveProperty('parent_chain');
    expect(body.trace).toHaveProperty('sub_actions');
    expect(body.trace).toHaveProperty('related_actions');
    expect(body.trace).toHaveProperty('root_cause_indicators');
  });

  it('computes assumption + loop summaries from the repository rows', async () => {
    const req = makeRequest('http://localhost/api/actions/act_1/trace');
    const res = await GET(req, { params: Promise.resolve({ actionId: 'act_1' }) });
    const body = await res.json();

    expect(body.trace.assumptions.total).toBe(3);
    expect(body.trace.assumptions.validated).toBe(1);
    expect(body.trace.assumptions.invalidated).toBe(1);
    expect(body.trace.assumptions.unvalidated).toBe(1);

    expect(body.trace.loops.total).toBe(2);
    expect(body.trace.loops.open).toBe(1);
    expect(body.trace.loops.resolved).toBe(1);
  });

  it('builds root_cause_indicators for invalidated assumptions, open loops, and failures', async () => {
    const req = makeRequest('http://localhost/api/actions/act_1/trace');
    const res = await GET(req, { params: Promise.resolve({ actionId: 'act_1' }) });
    const body = await res.json();

    const types = body.trace.root_cause_indicators.map((i) => i.type);
    expect(types).toContain('invalidated_assumptions');
    expect(types).toContain('unresolved_loops');
    expect(types).toContain('parent_failures');
    expect(types).toContain('related_failures');
  });

  it('passes the awaited actionId and resolved orgId to the repository', async () => {
    const req = makeRequest('http://localhost/api/actions/act_99/trace');
    await GET(req, { params: Promise.resolve({ actionId: 'act_99' }) });

    expect(mockGetActionTraceData).toHaveBeenCalledTimes(1);
    const callArgs = mockGetActionTraceData.mock.calls[0];
    // (sql, orgId, actionId)
    expect(callArgs[1]).toBe('org_test');
    expect(callArgs[2]).toBe('act_99');
  });

  it('returns 404 when the repository finds no action', async () => {
    mockGetActionTraceData.mockResolvedValue(null);
    const req = makeRequest('http://localhost/api/actions/missing/trace');
    const res = await GET(req, { params: Promise.resolve({ actionId: 'missing' }) });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Action not found');
  });

  it('returns 500 when the repository throws', async () => {
    mockGetActionTraceData.mockRejectedValue(new Error('db down'));
    const req = makeRequest('http://localhost/api/actions/act_1/trace');
    const res = await GET(req, { params: Promise.resolve({ actionId: 'act_1' }) });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('An error occurred while building the trace');
  });
});
