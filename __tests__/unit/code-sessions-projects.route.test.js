import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRequest } from '../helpers.js';

const {
  mockSql,
  mockGetOrgId,
  mockListProjects,
} = vi.hoisted(() => ({
  mockSql: Object.assign(vi.fn(async () => []), { query: vi.fn(async () => []) }),
  mockGetOrgId: vi.fn(),
  mockListProjects: vi.fn(),
}));

vi.mock('@/lib/db.js', () => ({ getSql: () => mockSql }));
vi.mock('@/lib/org.js', () => ({ getOrgId: mockGetOrgId }));
vi.mock('@/lib/repositories/code-sessions.repository.js', () => ({
  listProjects: mockListProjects,
  clearAllCodeSessions: vi.fn(),
}));

import { GET } from '@/api/code-sessions/projects/route.js';

beforeEach(() => {
  vi.clearAllMocks();
  mockGetOrgId.mockReturnValue('org_test');
});

describe('GET /api/code-sessions/projects', () => {
  it('returns the org-scoped project list', async () => {
    const rows = [
      { id: 'cp_1', slug: 'demo', cwd: 'C:/Projects/Demo', session_count: 3, total_cost_usd: 1.25 },
      { id: 'cp_2', slug: 'other', cwd: 'C:/Projects/Other', session_count: 0, total_cost_usd: 0 },
    ];
    mockListProjects.mockResolvedValue(rows);

    const res = await GET(makeRequest('http://localhost/api/code-sessions/projects', {
      headers: { 'x-org-id': 'org_test' },
    }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.projects).toHaveLength(2);
    expect(body.projects[0].id).toBe('cp_1');
    // org scoping is passed through to the repository.
    expect(mockListProjects).toHaveBeenCalledWith(mockSql, 'org_test');
  });

  it('returns an empty collection when the org has no projects', async () => {
    mockListProjects.mockResolvedValue([]);

    const res = await GET(makeRequest('http://localhost/api/code-sessions/projects'));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.projects).toEqual([]);
  });
});
