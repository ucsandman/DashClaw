import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRequest } from '../helpers.js';

const {
  mockSql, mockCreateTeamTask, mockListTeamTasks, mockGetTeamTask,
  mockUpdateTeamTask, mockAppendTeamTaskEvent, mockListTeamTaskEvents,
  mockPublishOrgEvent,
} = vi.hoisted(() => ({
  mockSql: Object.assign(vi.fn(async () => []), { query: vi.fn(async () => []) }),
  mockCreateTeamTask: vi.fn(),
  mockListTeamTasks: vi.fn(async () => []),
  mockGetTeamTask: vi.fn(),
  mockUpdateTeamTask: vi.fn(),
  mockAppendTeamTaskEvent: vi.fn(),
  mockListTeamTaskEvents: vi.fn(async () => []),
  mockPublishOrgEvent: vi.fn(async () => {}),
}));

vi.mock('@/lib/db.js', () => ({ getSql: () => mockSql }));
vi.mock('@/lib/events.js', async () => {
  const actual = await vi.importActual('@/lib/events.js');
  return { ...actual, publishOrgEvent: mockPublishOrgEvent };
});
vi.mock('@/lib/repositories/teamTasks.repository.js', async () => {
  const actual = await vi.importActual('@/lib/repositories/teamTasks.repository.js');
  return {
    ...actual,
    createTeamTask: mockCreateTeamTask,
    listTeamTasks: mockListTeamTasks,
    getTeamTask: mockGetTeamTask,
    updateTeamTask: mockUpdateTeamTask,
    appendTeamTaskEvent: mockAppendTeamTaskEvent,
    listTeamTaskEvents: mockListTeamTaskEvents,
  };
});

const { POST: createRoute, GET: listRoute } = await import('../../app/api/team-tasks/route.ts');
const { GET: getRoute, PATCH: patchRoute } = await import('../../app/api/team-tasks/[taskId]/route.ts');
const { POST: appendRoute, GET: eventsRoute } = await import('../../app/api/team-tasks/[taskId]/events/route.ts');

const ORG = { headers: { 'x-org-id': 'org_1' } };
const params = (taskId) => ({ params: Promise.resolve({ taskId }) });

beforeEach(() => { vi.clearAllMocks(); });

describe('POST /api/team-tasks', () => {
  it('creates a task and publishes team_task.created', async () => {
    const task = { id: 'team-20260710-0900-x', status: 'open' };
    mockCreateTeamTask.mockResolvedValueOnce(task);
    const res = await createRoute(makeRequest('http://x/api/team-tasks', { ...ORG, body: {
      id: 'team-20260710-0900-x', instruction: 'i', origin: 'telegram', lead_agent: 'openclaw',
    } }));
    expect(res.status).toBe(201);
    expect((await res.json()).task).toEqual(task);
    expect(mockPublishOrgEvent).toHaveBeenCalledWith('team_task.created', expect.objectContaining({ orgId: 'org_1', task }));
  });

  it('accepts a company-loop task led by a named PS agent (moltfire), rejects a malformed lead id', async () => {
    const task = { id: 'team-20260819-376139cf-cycle', status: 'in_progress' };
    mockCreateTeamTask.mockResolvedValueOnce(task);
    const ok = await createRoute(makeRequest('http://x/api/team-tasks', { ...ORG, body: {
      id: 'team-20260819-376139cf-cycle', instruction: 'Company cycle', origin: 'company-loop', lead_agent: 'moltfire',
    } }));
    expect(ok.status).toBe(201);
    expect(mockCreateTeamTask).toHaveBeenCalledWith(expect.anything(), 'org_1', expect.objectContaining({ origin: 'company-loop', lead_agent: 'moltfire' }));

    const bad = await createRoute(makeRequest('http://x/api/team-tasks', { ...ORG, body: {
      id: 'team-20260819-376139cf-cycle', instruction: 'Company cycle', origin: 'company-loop', lead_agent: 'Molt Fire',
    } }));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toMatch(/lead_agent/);
  });

  it('rejects an invalid origin with 400 naming the field', async () => {
    const res = await createRoute(makeRequest('http://x/api/team-tasks', { ...ORG, body: {
      id: 'team-20260710-0900-x', instruction: 'i', origin: 'sms', lead_agent: 'openclaw',
    } }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/origin/);
    expect(mockCreateTeamTask).not.toHaveBeenCalled();
  });

  it('maps duplicate id (PG 23505) to 409', async () => {
    mockCreateTeamTask.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: '23505' }));
    const res = await createRoute(makeRequest('http://x/api/team-tasks', { ...ORG, body: {
      id: 'team-20260710-0900-x', instruction: 'i', origin: 'telegram', lead_agent: 'openclaw',
    } }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe('task already exists');
  });
});

describe('GET/PATCH /api/team-tasks/[taskId]', () => {
  it('GET returns task + events, 404 when missing', async () => {
    mockGetTeamTask.mockResolvedValueOnce({ id: 't1' });
    mockListTeamTaskEvents.mockResolvedValueOnce([{ id: 1 }]);
    const ok = await getRoute(makeRequest('http://x/api/team-tasks/t1', ORG), params('t1'));
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.task.id).toBe('t1');
    expect(body.events).toHaveLength(1);

    mockGetTeamTask.mockResolvedValueOnce(null);
    const missing = await getRoute(makeRequest('http://x/api/team-tasks/nope', ORG), params('nope'));
    expect(missing.status).toBe(404);
  });

  it('PATCH validates status enum and 404s on no match', async () => {
    const bad = await patchRoute(makeRequest('http://x/api/team-tasks/t1', { ...ORG, body: { status: 'paused' } }), params('t1'));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toMatch(/status/);

    mockUpdateTeamTask.mockResolvedValueOnce(null);
    const missing = await patchRoute(makeRequest('http://x/api/team-tasks/nope', { ...ORG, body: { status: 'done' } }), params('nope'));
    expect(missing.status).toBe(404);
  });
});

describe('POST /api/team-tasks/[taskId]/events', () => {
  it('appends an event and publishes team_task.event', async () => {
    const ev = { id: 9, task_id: 't1', type: 'reply' };
    mockAppendTeamTaskEvent.mockResolvedValueOnce(ev);
    const res = await appendRoute(makeRequest('http://x/api/team-tasks/t1/events', { ...ORG, body: {
      from_agent: 'claude', to_agent: 'openclaw', type: 'reply', summary: 's',
    } }), params('t1'));
    expect(res.status).toBe(201);
    expect(mockPublishOrgEvent).toHaveBeenCalledWith('team_task.event', expect.objectContaining({ orgId: 'org_1', event: ev, task_id: 't1' }));
  });

  it('accepts PS company-loop participants by name and rejects a malformed agent id', async () => {
    const ev = { id: 10, task_id: 't1', type: 'delegation' };
    mockAppendTeamTaskEvent.mockResolvedValueOnce(ev);
    const ok = await appendRoute(makeRequest('http://x/api/team-tasks/t1/events', { ...ORG, body: {
      from_agent: 'mission-control', to_agent: 'forge', type: 'delegation', summary: 'step_06_build_wait: review the build',
    } }), params('t1'));
    expect(ok.status).toBe(201);
    expect(mockAppendTeamTaskEvent).toHaveBeenCalledWith(expect.anything(), 'org_1', 't1', expect.objectContaining({ from_agent: 'mission-control', to_agent: 'forge' }));

    const bad = await appendRoute(makeRequest('http://x/api/team-tasks/t1/events', { ...ORG, body: {
      from_agent: 'Forge', to_agent: 'wes', type: 'reply', summary: 's',
    } }), params('t1'));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toMatch(/from_agent/);
    expect(mockAppendTeamTaskEvent).toHaveBeenCalledTimes(1);
  });

  it('rejects an unknown event type with 400 and 404s a missing task', async () => {
    const bad = await appendRoute(makeRequest('http://x/api/team-tasks/t1/events', { ...ORG, body: {
      from_agent: 'claude', to_agent: 'wes', type: 'gossip', summary: 's',
    } }), params('t1'));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toMatch(/type/);

    mockAppendTeamTaskEvent.mockResolvedValueOnce(null);
    const missing = await appendRoute(makeRequest('http://x/api/team-tasks/nope/events', { ...ORG, body: {
      from_agent: 'claude', to_agent: 'wes', type: 'done', summary: 's',
    } }), params('nope'));
    expect(missing.status).toBe(404);
  });

  it('GET lists events', async () => {
    mockListTeamTaskEvents.mockResolvedValueOnce([{ id: 1 }, { id: 2 }]);
    const res = await eventsRoute(makeRequest('http://x/api/team-tasks/t1/events', ORG), params('t1'));
    expect(res.status).toBe(200);
    expect((await res.json()).events).toHaveLength(2);
  });
});
