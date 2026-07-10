import { describe, expect, it } from 'vitest';
import { createSqlMock } from '../helpers.js';
import {
  TEAM_TASK_STATUSES, TEAM_EVENT_TYPES,
  createTeamTask, listTeamTasks, getTeamTask, updateTeamTask,
  appendTeamTaskEvent, listTeamTaskEvents,
} from '../../app/lib/repositories/teamTasks.repository.js';

describe('teamTasks repository', () => {
  it('createTeamTask inserts with org scoping and returns the row', async () => {
    const row = { id: 'team-20260710-0900-x', org_id: 'org_1', status: 'open' };
    const sql = createSqlMock({ taggedResponses: [[row]] });
    const created = await createTeamTask(sql, 'org_1', {
      id: 'team-20260710-0900-x', instruction: 'do it',
      origin: 'telegram', lead_agent: 'openclaw',
    });
    expect(created).toEqual(row);
    const call = sql.taggedCalls[0];
    expect(call.text).toMatch(/INSERT INTO team_tasks/);
    expect(call.values).toContain('org_1');
    expect(call.values).toContain('telegram');
  });

  it('listTeamTasks filters by status with parameterized query', async () => {
    const sql = createSqlMock({ queryResponses: [[{ id: 't1' }]] });
    const rows = await listTeamTasks(sql, 'org_1', { status: 'open', limit: 10 });
    expect(rows).toEqual([{ id: 't1' }]);
    const call = sql.queryCalls[0];
    expect(call.text).toMatch(/FROM team_tasks WHERE org_id = \$1 AND status = \$2/);
    expect(call.params).toEqual(['org_1', 'open', 10, 0]);
  });

  it('updateTeamTask patches status and bumps updated_at', async () => {
    const sql = createSqlMock({ queryResponses: [[{ id: 't1', status: 'done' }]] });
    const row = await updateTeamTask(sql, 'org_1', 't1', { status: 'done' });
    expect(row.status).toBe('done');
    const call = sql.queryCalls[0];
    expect(call.text).toMatch(/UPDATE team_tasks SET/);
    expect(call.text).toMatch(/updated_at = now\(\)/);
    expect(call.params).toContain('done');
  });

  it('updateTeamTask returns null when nothing matched', async () => {
    const sql = createSqlMock({ queryResponses: [[]] });
    const row = await updateTeamTask(sql, 'org_1', 'missing', { status: 'done' });
    expect(row).toBeNull();
  });

  it('appendTeamTaskEvent inserts guarded by task existence', async () => {
    const ev = { id: 1, task_id: 't1', type: 'reply' };
    const sql = createSqlMock({ taggedResponses: [[ev]] });
    const created = await appendTeamTaskEvent(sql, 'org_1', 't1', {
      from_agent: 'claude', to_agent: 'openclaw', type: 'reply', summary: 's',
    });
    expect(created).toEqual(ev);
    const call = sql.taggedCalls[0];
    expect(call.text).toMatch(/INSERT INTO team_task_events/);
    expect(call.text).toMatch(/WHERE EXISTS/);
  });

  it('appendTeamTaskEvent returns null when the task does not exist', async () => {
    const sql = createSqlMock({ taggedResponses: [[]] });
    const created = await appendTeamTaskEvent(sql, 'org_1', 'missing', {
      from_agent: 'claude', to_agent: 'wes', type: 'done', summary: 's',
    });
    expect(created).toBeNull();
  });

  it('listTeamTaskEvents orders ascending by ts', async () => {
    const sql = createSqlMock({ queryResponses: [[{ id: 1 }, { id: 2 }]] });
    await listTeamTaskEvents(sql, 'org_1', 't1', {});
    expect(sql.queryCalls[0].text).toMatch(/ORDER BY ts ASC/);
  });

  it('exports the enums the routes validate against', () => {
    expect(TEAM_TASK_STATUSES).toEqual(['open', 'in_progress', 'awaiting_approval', 'done', 'failed', 'abandoned']);
    expect(TEAM_EVENT_TYPES).toEqual(['task_created', 'lead_assigned', 'delegation', 'reply', 'status', 'approval_needed', 'result', 'error', 'done']);
  });
});
