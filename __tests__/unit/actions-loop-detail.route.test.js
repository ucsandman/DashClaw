import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRequest } from '../helpers.js';

const { mockSql, mockGetOrgId, mockRedactAny, mockPublishOrgEvent } = vi.hoisted(() => ({
  // Tagged-template SQL client: route invokes sql`...` as a function.
  mockSql: vi.fn(async () => []),
  mockGetOrgId: vi.fn(() => 'org_test'),
  // redactAny(value, findings) -> route stores the returned value; default passthrough, no findings.
  mockRedactAny: vi.fn((value) => value),
  mockPublishOrgEvent: vi.fn(async () => {}),
}));

vi.mock('@/lib/db.js', () => ({ getSql: () => mockSql }));
vi.mock('@/lib/org.js', () => ({ getOrgId: mockGetOrgId }));
vi.mock('@/lib/security.js', () => ({ redactAny: mockRedactAny }));
vi.mock('@/lib/events.js', () => ({
  publishOrgEvent: mockPublishOrgEvent,
  EVENTS: { LOOP_UPDATED: 'loop.updated' },
}));

import { GET, PATCH } from '@/api/actions/loops/[loopId]/route.js';

const sampleLoop = {
  loop_id: 'loop_1',
  org_id: 'org_test',
  action_id: 'act_1',
  status: 'open',
  agent_id: 'agent_1',
  agent_name: 'Test Agent',
  declared_goal: 'do the thing',
  action_type: 'deploy',
  action_status: 'completed',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGetOrgId.mockReturnValue('org_test');
  mockRedactAny.mockImplementation((value) => value);
  mockSql.mockResolvedValue([]);
});

describe('GET /api/actions/loops/[loopId]', () => {
  it('returns 200 with the loop when found', async () => {
    mockSql.mockResolvedValueOnce([sampleLoop]);
    const req = makeRequest('http://localhost/api/actions/loops/loop_1', {
      headers: { 'x-org-id': 'org_test' },
    });
    const res = await GET(req, { params: Promise.resolve({ loopId: 'loop_1' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('loop');
    expect(body.loop.loop_id).toBe('loop_1');
  });

  it('returns 404 when the loop does not exist', async () => {
    mockSql.mockResolvedValueOnce([]);
    const req = makeRequest('http://localhost/api/actions/loops/missing', {
      headers: { 'x-org-id': 'org_test' },
    });
    const res = await GET(req, { params: Promise.resolve({ loopId: 'missing' }) });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Open loop not found');
  });

  it('returns 500 when the query throws', async () => {
    mockSql.mockRejectedValueOnce(new Error('db down'));
    const req = makeRequest('http://localhost/api/actions/loops/loop_1', {
      headers: { 'x-org-id': 'org_test' },
    });
    const res = await GET(req, { params: Promise.resolve({ loopId: 'loop_1' }) });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('An error occurred while fetching the loop');
  });
});

describe('PATCH /api/actions/loops/[loopId]', () => {
  it('returns 200 with the updated loop and security summary on resolve', async () => {
    const updated = { ...sampleLoop, status: 'resolved', resolution: 'fixed it' };
    mockSql.mockResolvedValueOnce([updated]); // UPDATE ... RETURNING *
    const req = makeRequest('http://localhost/api/actions/loops/loop_1', {
      headers: { 'x-org-id': 'org_test' },
      body: { status: 'resolved', resolution: 'fixed it' },
    });
    const res = await PATCH(req, { params: Promise.resolve({ loopId: 'loop_1' }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.loop.status).toBe('resolved');
    expect(body.security).toMatchObject({ clean: true, findings_count: 0 });
    expect(mockPublishOrgEvent).toHaveBeenCalledWith('loop.updated', {
      orgId: 'org_test',
      loop: updated,
    });
  });

  it('returns 400 when status is missing or invalid', async () => {
    const req = makeRequest('http://localhost/api/actions/loops/loop_1', {
      headers: { 'x-org-id': 'org_test' },
      body: { status: 'bogus' },
    });
    const res = await PATCH(req, { params: Promise.resolve({ loopId: 'loop_1' }) });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('status is required');
    expect(mockSql).not.toHaveBeenCalled();
  });

  it('returns 409 when the loop exists but is no longer open', async () => {
    mockSql
      .mockResolvedValueOnce([]) // UPDATE ... RETURNING * -> no rows (not open)
      .mockResolvedValueOnce([{ status: 'resolved' }]); // existence lookup
    const req = makeRequest('http://localhost/api/actions/loops/loop_1', {
      headers: { 'x-org-id': 'org_test' },
      body: { status: 'cancelled' },
    });
    const res = await PATCH(req, { params: Promise.resolve({ loopId: 'loop_1' }) });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe('Loop is already resolved');
  });
});
