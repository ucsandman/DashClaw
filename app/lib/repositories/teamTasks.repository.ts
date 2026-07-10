type SqlClient = {
  (s: TemplateStringsArray, ...v: unknown[]): Promise<Record<string, unknown>[]>;
  query: (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
};

// Team Tasks (THESIS.md "Owner amendment — 2026-07-09: fleets and teams"):
// the multi-agent /team task timeline. All SQL for the feature lives here —
// routes must not embed SQL (route-sql:check). Enums mirror the clawd
// team-ledger.mjs client exactly; a mismatch would strand ledger syncs.

export const TEAM_TASK_STATUSES = ['open', 'in_progress', 'awaiting_approval', 'done', 'failed', 'abandoned'];
export const TEAM_EVENT_TYPES = ['task_created', 'lead_assigned', 'delegation', 'reply', 'status', 'approval_needed', 'result', 'error', 'done'];
export const TEAM_ORIGINS = ['telegram', 'claude-code'];
export const TEAM_AGENTS = ['claude', 'openclaw'];
export const TEAM_RECIPIENTS = ['claude', 'openclaw', 'wes'];

interface CreateTeamTaskPayload {
  id: string;
  instruction: string;
  origin: string;
  lead_agent: string;
  status?: string;
  stop_condition?: string | null;
  max_exchanges?: number;
}

export async function createTeamTask(sql: SqlClient, orgId: string, task: CreateTeamTaskPayload) {
  const rows = await sql`
    INSERT INTO team_tasks (id, org_id, instruction, origin, lead_agent, status, stop_condition, max_exchanges)
    VALUES (
      ${task.id}, ${orgId}, ${task.instruction}, ${task.origin}, ${task.lead_agent},
      ${task.status || 'open'}, ${task.stop_condition || null}, ${task.max_exchanges ?? 10}
    )
    RETURNING *
  `;
  return rows[0] || null;
}

export async function listTeamTasks(sql: SqlClient, orgId: string, filters: { status?: string; limit?: number | string; offset?: number | string } = {}) {
  const { status, limit = 50, offset = 0 } = filters;
  const conditions = ['org_id = $1'];
  const params: unknown[] = [orgId];
  let idx = 2;
  if (status) {
    conditions.push(`status = $${idx}`);
    params.push(status);
    idx++;
  }
  return sql.query(
    `SELECT * FROM team_tasks WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
    [...params, limit, offset]
  );
}

export async function getTeamTask(sql: SqlClient, orgId: string, taskId: string) {
  const rows = await sql`
    SELECT * FROM team_tasks WHERE org_id = ${orgId} AND id = ${taskId}
  `;
  return rows[0] || null;
}

export async function updateTeamTask(sql: SqlClient, orgId: string, taskId: string, patch: { status?: string; claude_session_id?: string; openclaw_session_key?: string }) {
  const sets: string[] = ['updated_at = now()'];
  const params: unknown[] = [orgId, taskId];
  let idx = 3;
  for (const key of ['status', 'claude_session_id', 'openclaw_session_key'] as const) {
    if (patch[key] !== undefined) {
      sets.push(`${key} = $${idx}`);
      params.push(patch[key]);
      idx++;
    }
  }
  const rows = await sql.query(
    `UPDATE team_tasks SET ${sets.join(', ')} WHERE org_id = $1 AND id = $2 RETURNING *`,
    params
  );
  return rows[0] || null;
}

interface AppendEventPayload {
  ts?: string;
  from_agent: string;
  to_agent: string;
  type: string;
  summary: string;
  body?: string | null;
  action_id?: string | null;
}

export async function appendTeamTaskEvent(sql: SqlClient, orgId: string, taskId: string, ev: AppendEventPayload) {
  // Guarded INSERT: only lands when the parent task exists in this org, so a
  // stray append can't create orphan events (FK would 500; this returns null → 404).
  const rows = await sql`
    INSERT INTO team_task_events (org_id, task_id, ts, from_agent, to_agent, type, summary, body, action_id)
    SELECT ${orgId}, ${taskId}, COALESCE(${ev.ts || null}, now()), ${ev.from_agent}, ${ev.to_agent}, ${ev.type}, ${ev.summary}, ${ev.body || null}, ${ev.action_id || null}
    WHERE EXISTS (SELECT 1 FROM team_tasks WHERE org_id = ${orgId} AND id = ${taskId})
    RETURNING *
  `;
  return rows[0] || null;
}

export async function listTeamTaskEvents(sql: SqlClient, orgId: string, taskId: string, filters: { limit?: number | string } = {}) {
  const { limit = 500 } = filters;
  return sql.query(
    `SELECT * FROM team_task_events WHERE org_id = $1 AND task_id = $2 ORDER BY ts ASC LIMIT $3`,
    [orgId, taskId, limit]
  );
}
