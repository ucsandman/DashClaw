import { describe, expect, it } from 'vitest';
import { createSqlMock } from '../helpers.js';
import {
  deleteCodeSession,
  deleteCodeProject,
  clearAllCodeSessions,
} from '../../app/lib/repositories/code-sessions.repository.js';

describe('deleteCodeSession — org scoping', () => {
  it('deletes only within the caller org and reports success', async () => {
    const sql = createSqlMock({ taggedResponses: [[{ id: 'cs_1' }]] });
    const ok = await deleteCodeSession(sql, 'org_a', 'cs_1');
    expect(ok).toBe(true);

    const call = sql.taggedCalls[0];
    expect(call.text).toMatch(/DELETE FROM code_sessions/);
    expect(call.text).toMatch(/WHERE org_id = \? AND id = \?/);
    expect(call.values).toEqual(['org_a', 'cs_1']);
  });

  it('returns false when the row belongs to another org (no rows deleted)', async () => {
    const sql = createSqlMock({ taggedResponses: [[]] });
    const ok = await deleteCodeSession(sql, 'org_b', 'cs_1');
    expect(ok).toBe(false);
  });
});

describe('deleteCodeProject — sessions-first ordering (project_id has no cascade)', () => {
  it('deletes the project sessions before the project row, both org-scoped', async () => {
    const sql = createSqlMock({ taggedResponses: [
      [],               // DELETE sessions
      [{ id: 'cp_1' }], // DELETE project RETURNING
    ] });

    const ok = await deleteCodeProject(sql, 'org_a', 'cp_1');
    expect(ok).toBe(true);

    // Order is load-bearing: deleting the project first raises FK 23503.
    const [first, second] = sql.taggedCalls;
    expect(first.text).toMatch(/DELETE FROM code_sessions/);
    expect(first.text).toMatch(/project_id = \?/);
    expect(first.values).toEqual(['org_a', 'cp_1']);
    expect(second.text).toMatch(/DELETE FROM code_projects/);
    expect(second.values).toEqual(['org_a', 'cp_1']);
  });

  it('returns false for a foreign-org project (sessions delete also org-scoped)', async () => {
    const sql = createSqlMock({ taggedResponses: [[], []] });
    const ok = await deleteCodeProject(sql, 'org_b', 'cp_other');
    expect(ok).toBe(false);
    // Even the sessions sweep carried the caller org.
    expect(sql.taggedCalls[0].values).toEqual(['org_b', 'cp_other']);
  });
});

describe('clearAllCodeSessions — org-wide clear', () => {
  it('deletes all sessions first, then all projects, scoped to one org', async () => {
    const sql = createSqlMock({ taggedResponses: [
      [{ id: 'cs_1' }, { id: 'cs_2' }, { id: 'cs_3' }],
      [{ id: 'cp_1' }],
    ] });

    const result = await clearAllCodeSessions(sql, 'org_a');
    expect(result).toEqual({ sessions_deleted: 3, projects_deleted: 1 });

    const [first, second] = sql.taggedCalls;
    expect(first.text).toMatch(/DELETE FROM code_sessions/);
    expect(first.text).not.toMatch(/project_id/); // unattached sessions go too
    expect(first.values).toEqual(['org_a']);
    expect(second.text).toMatch(/DELETE FROM code_projects/);
    expect(second.values).toEqual(['org_a']);
  });
});
