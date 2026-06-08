import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRequest } from '../helpers.js';

const { mockSql, mockListArtifacts } = vi.hoisted(() => ({
  mockSql: vi.fn(async () => []),
  mockListArtifacts: vi.fn(),
}));

vi.mock('@/lib/db.js', () => ({ getSql: () => mockSql }));
vi.mock('@/lib/org.js', () => ({ getOrgId: () => 'org_test' }));
vi.mock('@/lib/repositories/artifacts.repository.js', () => ({
  listArtifacts: mockListArtifacts,
}));

import { GET } from '@/api/actions/[actionId]/artifacts/route.js';

const defaultResult = {
  artifacts: [
    {
      artifact_id: 'art_1',
      org_id: 'org_test',
      artifact_type: 'report',
      name: 'Q3 summary',
      source_action_id: 'act_1',
    },
  ],
  total: 1,
};

describe('GET /api/actions/[actionId]/artifacts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListArtifacts.mockResolvedValue(defaultResult);
  });

  it('returns 200 with the { artifacts, total } shape from the repository', async () => {
    const req = makeRequest('http://localhost/api/actions/act_1/artifacts', {
      headers: { 'x-org-id': 'org_test' },
    });
    const res = await GET(req, { params: Promise.resolve({ actionId: 'act_1' }) });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('total', 1);
    expect(Array.isArray(body.artifacts)).toBe(true);
    expect(body.artifacts[0].artifact_id).toBe('art_1');
  });

  it('passes the actionId as action_id and applies default limit/offset', async () => {
    const req = makeRequest('http://localhost/api/actions/act_42/artifacts', {
      headers: { 'x-org-id': 'org_test' },
    });
    await GET(req, { params: Promise.resolve({ actionId: 'act_42' }) });

    expect(mockListArtifacts).toHaveBeenCalledTimes(1);
    const [, orgId, filters] = mockListArtifacts.mock.calls[0];
    expect(orgId).toBe('org_test');
    expect(filters.action_id).toBe('act_42');
    expect(filters.limit).toBe(50);
    expect(filters.offset).toBe(0);
  });

  it('forwards limit and offset query params to the repository', async () => {
    const req = makeRequest(
      'http://localhost/api/actions/act_1/artifacts?limit=10&offset=20',
      { headers: { 'x-org-id': 'org_test' } },
    );
    await GET(req, { params: Promise.resolve({ actionId: 'act_1' }) });

    const [, , filters] = mockListArtifacts.mock.calls[0];
    expect(filters.limit).toBe('10');
    expect(filters.offset).toBe('20');
  });

  it('returns 500 with an error body when the repository throws', async () => {
    mockListArtifacts.mockRejectedValue(new Error('db exploded'));
    const req = makeRequest('http://localhost/api/actions/act_1/artifacts', {
      headers: { 'x-org-id': 'org_test' },
    });
    const res = await GET(req, { params: Promise.resolve({ actionId: 'act_1' }) });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toHaveProperty('error', 'Internal server error');
    expect(body).toHaveProperty('detail', 'db exploded');
  });
});
