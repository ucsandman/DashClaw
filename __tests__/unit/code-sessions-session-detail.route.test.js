/**
 * Covers the two read-only session routes:
 *   GET /api/code-sessions/sessions/[sessionId]          -> getSessionDetail passthrough
 *   GET /api/code-sessions/sessions/[sessionId]/autopsy  -> buildAutopsyFromDetail(detail)
 *
 * The autopsy route delegates the whole assembly (user turns, final-summary
 * cue, stuck-loop detection) to the pure helper buildAutopsyFromDetail, so we
 * mock that helper and assert the route passes the repository detail straight
 * through and returns its result — route wiring, not the heuristic.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRequest } from '../helpers.js';

const {
  mockSql,
  mockGetOrgId,
  mockGetSessionDetail,
  mockBuildAutopsyFromDetail,
} = vi.hoisted(() => ({
  mockSql: Object.assign(vi.fn(async () => []), { query: vi.fn(async () => []) }),
  mockGetOrgId: vi.fn(),
  mockGetSessionDetail: vi.fn(),
  mockBuildAutopsyFromDetail: vi.fn(),
}));

vi.mock('@/lib/db.js', () => ({ getSql: () => mockSql }));
vi.mock('@/lib/org.js', () => ({ getOrgId: mockGetOrgId }));
vi.mock('@/lib/repositories/code-sessions.repository.js', () => ({
  getSessionDetail: mockGetSessionDetail,
  deleteCodeSession: vi.fn(),
}));
vi.mock('@/lib/claude-code/goals.js', () => ({ buildAutopsyFromDetail: mockBuildAutopsyFromDetail }));

import { GET as GET_DETAIL } from '@/api/code-sessions/sessions/[sessionId]/route.js';
import { GET as GET_AUTOPSY } from '@/api/code-sessions/sessions/[sessionId]/autopsy/route.js';

function ctx(sessionId) {
  return { params: Promise.resolve({ sessionId }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetOrgId.mockReturnValue('org_test');
  mockBuildAutopsyFromDetail.mockReturnValue({ outcome: 'completed', where_money_went: [] });
});

describe('GET /api/code-sessions/sessions/[sessionId]', () => {
  it('returns the session detail when it exists in the org', async () => {
    const detail = {
      session: { id: 'cs_1', session_uuid: 'sess-1', project_id: 'cp_1' },
      messages: [],
      toolUses: [],
    };
    mockGetSessionDetail.mockResolvedValue(detail);

    const res = await GET_DETAIL(
      makeRequest('http://localhost/api/code-sessions/sessions/cs_1'),
      ctx('cs_1'),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.session.id).toBe('cs_1');
    expect(mockGetSessionDetail).toHaveBeenCalledWith(mockSql, 'org_test', 'cs_1');
  });

  it('returns 404 when the session is not found', async () => {
    mockGetSessionDetail.mockResolvedValue(null);

    const res = await GET_DETAIL(
      makeRequest('http://localhost/api/code-sessions/sessions/cs_missing'),
      ctx('cs_missing'),
    );

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('not_found');
  });
});

describe('GET /api/code-sessions/sessions/[sessionId]/autopsy', () => {
  it('passes the session detail to buildAutopsyFromDetail and returns its result', async () => {
    const detail = {
      session: { id: 'cs_1', session_uuid: 'sess-1' },
      messages: [
        { role: 'user', text_preview: 'fix the build' },
        { role: 'assistant', text_preview: 'all tests pass, done' },
      ],
      toolUses: [
        { name: 'Bash', request_id: 'R1', target: 'npm test' },
      ],
    };
    mockGetSessionDetail.mockResolvedValue(detail);
    const autopsy = { outcome: 'completed', goal_text: 'fix the build', where_money_went: [] };
    mockBuildAutopsyFromDetail.mockReturnValue(autopsy);

    const res = await GET_AUTOPSY(
      makeRequest('http://localhost/api/code-sessions/sessions/cs_1/autopsy'),
      ctx('cs_1'),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.outcome).toBe('completed');

    // The route is a thin wrapper: fetch detail, hand the whole object to the
    // shared assembler, return its output. The assembly itself (user turns,
    // final-summary cue, stuck loops) is unit-tested in goals.js.
    expect(mockBuildAutopsyFromDetail).toHaveBeenCalledTimes(1);
    expect(mockBuildAutopsyFromDetail).toHaveBeenCalledWith(detail);
  });

  it('returns 404 without building an autopsy when the session is not found', async () => {
    mockGetSessionDetail.mockResolvedValue(null);

    const res = await GET_AUTOPSY(
      makeRequest('http://localhost/api/code-sessions/sessions/cs_missing/autopsy'),
      ctx('cs_missing'),
    );

    expect(res.status).toBe(404);
    expect(mockBuildAutopsyFromDetail).not.toHaveBeenCalled();
  });
});
