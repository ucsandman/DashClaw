/**
 * DELETE handlers for code sessions:
 *   DELETE /api/code-sessions/sessions/[sessionId]      -> deleteCodeSession
 *   DELETE /api/code-sessions/projects/[projectId]      -> deleteCodeProject
 *   DELETE /api/code-sessions/projects?confirm=all      -> clearAllCodeSessions
 * Route wiring only — org scoping + ordering live in the repository tests.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRequest } from '../helpers.js';

const {
  mockSql,
  mockGetOrgId,
  mockGetSessionDetail,
  mockDeleteCodeSession,
  mockGetProject,
  mockDeleteCodeProject,
  mockListProjects,
  mockClearAll,
} = vi.hoisted(() => ({
  mockSql: Object.assign(vi.fn(async () => []), { query: vi.fn(async () => []) }),
  mockGetOrgId: vi.fn(),
  mockGetSessionDetail: vi.fn(),
  mockDeleteCodeSession: vi.fn(),
  mockGetProject: vi.fn(),
  mockDeleteCodeProject: vi.fn(),
  mockListProjects: vi.fn(),
  mockClearAll: vi.fn(),
}));

vi.mock('@/lib/db.js', () => ({ getSql: () => mockSql }));
vi.mock('@/lib/org.js', () => ({ getOrgId: mockGetOrgId }));
vi.mock('@/lib/repositories/code-sessions.repository.js', () => ({
  getSessionDetail: mockGetSessionDetail,
  deleteCodeSession: mockDeleteCodeSession,
  getProject: mockGetProject,
  deleteCodeProject: mockDeleteCodeProject,
  listProjects: mockListProjects,
  clearAllCodeSessions: mockClearAll,
}));

import { DELETE as DELETE_SESSION } from '@/api/code-sessions/sessions/[sessionId]/route.js';
import { DELETE as DELETE_PROJECT, GET as GET_PROJECT } from '@/api/code-sessions/projects/[projectId]/route.js';
import { DELETE as DELETE_ALL } from '@/api/code-sessions/projects/route.js';

beforeEach(() => {
  vi.clearAllMocks();
  mockGetOrgId.mockReturnValue('org_test');
});

describe('DELETE /api/code-sessions/sessions/[sessionId]', () => {
  it('deletes and returns the id', async () => {
    mockDeleteCodeSession.mockResolvedValueOnce(true);
    const res = await DELETE_SESSION(
      makeRequest('http://test/api/code-sessions/sessions/cs_1', { method: 'DELETE' }),
      { params: Promise.resolve({ sessionId: 'cs_1' }) },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: true, id: 'cs_1' });
    expect(mockDeleteCodeSession).toHaveBeenCalledWith(mockSql, 'org_test', 'cs_1');
  });

  it('404s when nothing was deleted (missing or foreign org)', async () => {
    mockDeleteCodeSession.mockResolvedValueOnce(false);
    const res = await DELETE_SESSION(
      makeRequest('http://test/api/code-sessions/sessions/cs_missing', { method: 'DELETE' }),
      { params: Promise.resolve({ sessionId: 'cs_missing' }) },
    );
    expect(res.status).toBe(404);
  });
});

describe('GET+DELETE /api/code-sessions/projects/[projectId]', () => {
  it('GET returns the project row for the header read', async () => {
    mockGetProject.mockResolvedValueOnce({ id: 'cp_1', slug: 'c--projects-demo', cwd: 'C:/Projects/Demo' });
    const res = await GET_PROJECT(
      makeRequest('http://test/api/code-sessions/projects/cp_1'),
      { params: Promise.resolve({ projectId: 'cp_1' }) },
    );
    expect(res.status).toBe(200);
    expect((await res.json()).project.cwd).toBe('C:/Projects/Demo');
  });

  it('DELETE removes the project and 404s when absent', async () => {
    mockDeleteCodeProject.mockResolvedValueOnce(true);
    const ok = await DELETE_PROJECT(
      makeRequest('http://test/api/code-sessions/projects/cp_1', { method: 'DELETE' }),
      { params: Promise.resolve({ projectId: 'cp_1' }) },
    );
    expect(ok.status).toBe(200);
    expect(mockDeleteCodeProject).toHaveBeenCalledWith(mockSql, 'org_test', 'cp_1');

    mockDeleteCodeProject.mockResolvedValueOnce(false);
    const missing = await DELETE_PROJECT(
      makeRequest('http://test/api/code-sessions/projects/cp_x', { method: 'DELETE' }),
      { params: Promise.resolve({ projectId: 'cp_x' }) },
    );
    expect(missing.status).toBe(404);
  });
});

describe('DELETE /api/code-sessions/projects (clear-all)', () => {
  it('refuses without the explicit ?confirm=all guard', async () => {
    const res = await DELETE_ALL(
      makeRequest('http://test/api/code-sessions/projects', { method: 'DELETE' }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('confirm_required');
    expect(mockClearAll).not.toHaveBeenCalled();
  });

  it('clears everything for the caller org with the guard present', async () => {
    mockClearAll.mockResolvedValueOnce({ sessions_deleted: 12, projects_deleted: 3 });
    const res = await DELETE_ALL(
      makeRequest('http://test/api/code-sessions/projects?confirm=all', { method: 'DELETE' }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: true, sessions_deleted: 12, projects_deleted: 3 });
    expect(mockClearAll).toHaveBeenCalledWith(mockSql, 'org_test');
  });
});
