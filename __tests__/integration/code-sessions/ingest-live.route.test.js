import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRequest } from '../../helpers.js';

const {
  mockSql,
  mockUpsertProject,
  mockAppendLiveTurn,
  mockGetSessionFreshness,
  mockGetSessionDetail,
  mockGetProjectSessionsChronological,
  mockReplaceSignalsForSession,
  mockInsertAlerts,
  mockListProjects,
  mockDetectRepeatedRuns,
  mockRunOptimizer,
  mockDetectForSession,
} = vi.hoisted(() => ({
  mockSql: Object.assign(vi.fn(async () => []), { query: vi.fn(async () => []) }),
  mockUpsertProject: vi.fn(),
  mockAppendLiveTurn: vi.fn(),
  mockGetSessionFreshness: vi.fn(),
  mockGetSessionDetail: vi.fn(),
  mockGetProjectSessionsChronological: vi.fn(),
  mockReplaceSignalsForSession: vi.fn(),
  mockInsertAlerts: vi.fn(),
  mockListProjects: vi.fn(),
  mockDetectRepeatedRuns: vi.fn(),
  mockRunOptimizer: vi.fn(),
  mockDetectForSession: vi.fn(),
}));

vi.mock('@/lib/db.js', () => ({ getSql: () => mockSql }));
vi.mock('@/lib/repositories/code-sessions.repository.js', () => ({
  upsertProject: mockUpsertProject,
  appendLiveTurn: mockAppendLiveTurn,
  getSessionFreshness: mockGetSessionFreshness,
  getSessionDetail: mockGetSessionDetail,
  getProjectSessionsChronological: mockGetProjectSessionsChronological,
  replaceSignalsForSession: mockReplaceSignalsForSession,
  insertAlerts: mockInsertAlerts,
  listProjects: mockListProjects,
}));
vi.mock('@/lib/claude-code/repeated-runs.js', () => ({ detectRepeatedRuns: mockDetectRepeatedRuns }));
vi.mock('@/lib/claude-code/optimizer.js', () => ({ runOptimizer: mockRunOptimizer }));
vi.mock('@/lib/claude-code/alerts.js', () => ({ detectForSession: mockDetectForSession }));

const { POST } = await import('@/api/code-sessions/ingest-live/route.js');

function fixtureRequest(body) {
  return makeRequest('http://test/api/code-sessions/ingest-live', {
    headers: { 'x-org-id': 'org_unit_test' },
    body,
  });
}

beforeEach(() => {
  mockSql.mockClear();
  mockUpsertProject.mockReset();
  mockAppendLiveTurn.mockReset();
  mockGetSessionFreshness.mockReset();
  mockGetSessionDetail.mockReset();
  mockGetProjectSessionsChronological.mockReset();
  mockReplaceSignalsForSession.mockReset();
  mockInsertAlerts.mockReset();
  mockListProjects.mockReset();
  mockDetectRepeatedRuns.mockReset();
  mockRunOptimizer.mockReset();
  mockDetectForSession.mockReset();

  mockUpsertProject.mockResolvedValue({ id: 'cp_unit', slug: 'demo' });
  mockAppendLiveTurn.mockResolvedValue({
    sessionId: 'cs_live_unit',
    turnIndex: 1,
    insertedToolUses: 2,
  });
});

describe('POST /api/code-sessions/ingest-live — append path', () => {
  it('rejects body without session_uuid', async () => {
    const res = await POST(fixtureRequest({
      project: { slug: 'demo' },
      model: 'claude-sonnet-4-6',
    }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('missing_session_uuid');
  });

  it('rejects invalid JSON body', async () => {
    const req = {
      url: 'http://test/api/code-sessions/ingest-live',
      headers: new Headers({ 'x-org-id': 'org_unit_test' }),
      json: async () => { throw new Error('bad json'); },
      nextUrl: new URL('http://test/api/code-sessions/ingest-live'),
    };
    const res = await POST(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('invalid_json');
  });

  it('rejects invalid source_host', async () => {
    const res = await POST(fixtureRequest({
      session_uuid: 'sess-abc',
      project: { slug: 'demo', source_host: 'invented' },
    }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('invalid_source_host');
  });

  it('rejects too many tool_calls', async () => {
    const tooMany = Array.from({ length: 65 }, (_, i) => ({ name: `Tool${i}` }));
    const res = await POST(fixtureRequest({
      session_uuid: 'sess-abc',
      project: { slug: 'demo' },
      tool_calls: tooMany,
    }));
    expect(res.status).toBe(413);
    const json = await res.json();
    expect(json.error).toBe('too_many_tool_calls');
  });

  it('happy path — upserts project and appends turn', async () => {
    const res = await POST(fixtureRequest({
      session_uuid: 'sess-abc',
      agent_id: 'hermes',
      project: { slug: 'demo', cwd: 'C:/Projects/Demo' },
      model: 'claude-sonnet-4-6',
      usage: {
        input_tokens: 1000,
        output_tokens: 200,
        cache_read_input_tokens: 5000,
        cache_creation_input_tokens: 100,
      },
      tool_calls: [
        { name: 'Read', tool_use_id: 'tu_1', target: { file_path: 'a.js' } },
        { name: 'Bash', tool_use_id: 'tu_2', target: 'ls -la' },
      ],
      assistant_text_preview: 'Reading file a.js and listing directory.',
      turn_timestamp: '2026-05-13T12:00:00Z',
    }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.project.id).toBe('cp_unit');
    expect(json.session.id).toBe('cs_live_unit');
    expect(json.session.session_uuid).toBe('sess-abc');
    expect(json.session.turn_index).toBe(1);
    expect(json.session.inserted_tool_uses).toBe(2);
    expect(json.agent_id).toBe('hermes');

    expect(mockUpsertProject).toHaveBeenCalledTimes(1);
    const upsertArg = mockUpsertProject.mock.calls[0][2];
    expect(upsertArg.slug).toBe('demo');
    expect(upsertArg.source_host).toBe('hook');

    expect(mockAppendLiveTurn).toHaveBeenCalledTimes(1);
    const turnArg = mockAppendLiveTurn.mock.calls[0][2];
    expect(turnArg.sessionUuid).toBe('sess-abc');
    expect(turnArg.projectId).toBe('cp_unit');
    expect(turnArg.model).toBe('claude-sonnet-4-6');
    expect(turnArg.usage.input_tokens).toBe(1000);
    expect(turnArg.toolCalls).toHaveLength(2);
    expect(turnArg.assistantPreview).toBe('Reading file a.js and listing directory.');
  });

  it('derives slug from cwd when slug missing', async () => {
    await POST(fixtureRequest({
      session_uuid: 'sess-xyz',
      project: { cwd: 'C:/Projects/HermesPlayground' },
    }));
    const upsertArg = mockUpsertProject.mock.calls[0][2];
    expect(upsertArg.slug).toBe('HermesPlayground');
  });

  it('tolerates missing usage field (Hermes does not expose tokens)', async () => {
    const res = await POST(fixtureRequest({
      session_uuid: 'sess-no-usage',
      project: { slug: 'demo' },
      model: 'claude-opus-4-7',
      tool_calls: [],
    }));
    expect(res.status).toBe(200);
    const turnArg = mockAppendLiveTurn.mock.calls[0][2];
    expect(turnArg.usage).toBeNull();
  });
});

describe('POST /api/code-sessions/ingest-live — finalize path', () => {
  beforeEach(() => {
    mockGetSessionFreshness.mockResolvedValue({ id: 'cs_live_unit', source_mtime: null, parser_version: 2 });
    mockGetSessionDetail.mockResolvedValue({
      id: 'cs_live_unit',
      session_uuid: 'sess-end',
      model_primary: 'claude-sonnet-4-6',
      cost_usd: 0.42,
      input_tokens: 12000,
      output_tokens: 2200,
      cache_read_tokens: 50000,
      cache_creation_tokens: 800,
      message_count: 6,
      tool_uses: [
        { name: 'Bash', request_id: 'R1', target: 'ls' },
        { name: 'Bash', request_id: 'R1', target: 'ls' },
        { name: 'Bash', request_id: 'R1', target: 'ls' },
        { name: 'Read', request_id: 'R2', target: 'a.js' },
      ],
    });
    mockGetProjectSessionsChronological.mockResolvedValue([{ id: 'cs_live_unit' }]);
    mockListProjects.mockResolvedValue([{ session_count: 3 }, { session_count: 0 }]);
    mockDetectRepeatedRuns.mockReturnValue([
      { name: 'Bash', count: 3, confidence: 'high', evidence: ['ls'], targets: ['ls'] },
    ]);
    mockRunOptimizer.mockReturnValue([
      { kind: 'stuck_loop', confidence: 'high', savingsUsd: 0.05, payload: { name: 'Bash' } },
    ]);
    mockDetectForSession.mockReturnValue([
      { kind: 'cost_spike', severity: 'warning', scope: 'session', title: 'Cost spike', body: 'detail' },
    ]);
    mockReplaceSignalsForSession.mockResolvedValue(2);
    mockInsertAlerts.mockResolvedValue(1);
  });

  it('runs optimizer + alerts pass when finalize:true', async () => {
    const res = await POST(fixtureRequest({
      session_uuid: 'sess-end',
      agent_id: 'hermes',
      finalize: true,
      project: { slug: 'demo' },
      ended_at: '2026-05-13T12:30:00Z',
      completed: true,
    }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.session.finalized).toBe(true);
    expect(json.session.found).toBe(true);
    expect(json.session.signals_inserted).toBe(2); // 1 optimizer finding + 1 repeated_run
    expect(json.session.alerts_inserted).toBe(1);
    expect(json.session.stuck_loops).toBe(1);

    expect(mockAppendLiveTurn).not.toHaveBeenCalled();   // finalize must not append
    expect(mockGetSessionFreshness).toHaveBeenCalledTimes(1);
    expect(mockGetSessionDetail).toHaveBeenCalledTimes(1);
    expect(mockRunOptimizer).toHaveBeenCalledTimes(1);
    expect(mockReplaceSignalsForSession).toHaveBeenCalledTimes(1);

    const signalsCall = mockReplaceSignalsForSession.mock.calls[0];
    expect(signalsCall[1]).toBe('cs_live_unit');
    expect(signalsCall[2]).toHaveLength(2);

    const alertsCall = mockInsertAlerts.mock.calls[0];
    expect(alertsCall[3]).toEqual({ project_id: 'cp_unit', session_id: 'cs_live_unit' });
  });

  it('returns found:false when finalize hits an unknown session_uuid', async () => {
    mockGetSessionFreshness.mockResolvedValue(null);
    const res = await POST(fixtureRequest({
      session_uuid: 'sess-ghost',
      finalize: true,
      project: { slug: 'demo' },
    }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.session.finalized).toBe(true);
    expect(json.session.found).toBe(false);
    expect(json.session.signals_inserted).toBe(0);
    expect(json.session.alerts_inserted).toBe(0);
    expect(mockRunOptimizer).not.toHaveBeenCalled();
  });

  it('swallows optimizer errors and still returns ok', async () => {
    mockGetSessionDetail.mockRejectedValue(new Error('db went away'));
    const res = await POST(fixtureRequest({
      session_uuid: 'sess-end',
      finalize: true,
      project: { slug: 'demo' },
    }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.session.finalized).toBe(true);
    expect(json.session.found).toBe(false);
  });
});
