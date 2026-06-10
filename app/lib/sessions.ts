import { randomUUID } from 'node:crypto';

type SqlClient = {
  (s: TemplateStringsArray, ...v: unknown[]): Promise<Record<string, unknown>[]>;
  query: (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
};

// A session/aggregate row is a DB read — fields are dynamic and read by name.
type SessionRow = Record<string, any>;

declare global {
  // eslint-disable-next-line no-var
  var __dashclaw_sessions_table_checked: boolean | undefined;
}

// Statuses that mean a session has ended. Used both to compute a session's
// effective end time (for the action-window fallback) and shared with the
// frontend duration logic. A session in any of these is "done"; everything
// else is treated as live.
export const TERMINAL_STATUSES = ['finished', 'failed', 'closed', 'completed', 'cancelled'];

// The session↔action match predicate, shared by the aggregate counts and
// getSessionActions so the "# Actions" card and the actions list can never
// disagree. Expects `s` (agent_sessions) and `ar` (action_records) aliases in
// scope. Two join paths are unioned:
//   1. Direct: action_records.session_id = the session id (stamped by writers
//      that know it — the MCP server auto-stamps it on dashclaw_record after
//      dashclaw_session_start; see mcp-server/lib/tools.js).
//   2. Fallback: same agent_id whose action_records.created_at falls inside the
//      session's lifetime window [created_at, COALESCE(terminal updated_at, now())].
//      This is what makes existing un-stamped sessions useful today. Known
//      behavior: an unstamped action is attributed to EVERY overlapping session
//      of that agent (documented overcount; list intentionally matches count).
function sessionActionMatchSql(sql: SqlClient) {
  return sql`(
    ar.session_id = s.id
    OR (
      ar.session_id IS NULL
      AND ar.agent_id = s.agent_id
      AND ar.created_at::timestamptz >= s.created_at
      AND ar.created_at::timestamptz <= CASE
        WHEN s.status = ANY(${TERMINAL_STATUSES}) THEN s.updated_at
        ELSE NOW()
      END
    )
  )`;
}

// Per-session aggregation over action_records via the shared match predicate.
// cost_estimate is summed with COALESCE; the caller coerces the numeric result
// with Number() (Neon returns numeric/real as strings).
function sessionAggregateSql(sql: SqlClient) {
  return sql`
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*)::int                         AS action_count,
        MAX(ar.created_at)                    AS last_action_at,
        COALESCE(SUM(ar.cost_estimate), 0)    AS total_cost,
        COALESCE(MAX(ar.risk_score), 0)::int  AS max_risk
      FROM action_records ar
      WHERE ar.org_id = s.org_id
        AND ${sessionActionMatchSql(sql)}
    ) agg ON TRUE
    LEFT JOIN LATERAL (
      SELECT
        ar.outcome_status AS last_outcome_status,
        ar.status         AS last_status,
        ar.declared_goal  AS last_declared_goal
      FROM action_records ar
      WHERE ar.org_id = s.org_id
        AND ${sessionActionMatchSql(sql)}
      ORDER BY ar.created_at DESC
      LIMIT 1
    ) last_action ON TRUE
    LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS event_count
      FROM session_events se
      WHERE se.session_id = s.id AND se.org_id = s.org_id
    ) ev ON TRUE
  `;
}

// Coerce the aggregate columns into JS numbers (Neon returns numeric/real and
// COUNT/SUM results as strings) and shape last_action_at into last_activity.
// Mutates and returns the row for terseness.
function shapeAggregatedSession(row: SessionRow | null | undefined): SessionRow | null | undefined {
  if (!row) return row;
  row.action_count = Number(row.action_count) || 0;
  row.total_cost = Number(row.total_cost) || 0;
  row.max_risk = Number(row.max_risk) || 0;
  row.event_count = Number(row.event_count) || 0;
  // Prefer the real last action timestamp; fall back to the stored last_activity.
  row.last_activity = row.last_action_at || row.last_activity || null;
  return row;
}

// Pin the table-check flag on globalThis so HMR / serverless cold-starts
// don't re-fire the four CREATE TABLE / CREATE INDEX round-trips every
// invocation. Mirrors the pattern in app/lib/db.js for the SQL handle.
if (!globalThis.__dashclaw_sessions_table_checked) {
  globalThis.__dashclaw_sessions_table_checked = false;
}

async function ensureTables(sql: SqlClient): Promise<void> {
  if (globalThis.__dashclaw_sessions_table_checked) return;
  await sql`
    CREATE TABLE IF NOT EXISTS agent_sessions (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      workspace TEXT,
      branch TEXT,
      status TEXT NOT NULL DEFAULT 'spawning',
      status_since TIMESTAMPTZ DEFAULT NOW(),
      blocked_reason TEXT,
      green_level TEXT,
      branch_freshness TEXT,
      commits_behind INTEGER,
      last_activity TIMESTAMPTZ DEFAULT NOW(),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_agent_sessions_org ON agent_sessions (org_id, updated_at DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_agent_sessions_org_agent ON agent_sessions (org_id, agent_id)`;

  await sql`
    CREATE TABLE IF NOT EXISTS session_events (
      id SERIAL PRIMARY KEY,
      session_id TEXT NOT NULL,
      org_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      kind TEXT NOT NULL,
      detail TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_session_events_session ON session_events (session_id, seq)`;
  // UNIQUE on (session_id, seq) turns the MAX(seq)+1 race into a hard fail
  // instead of silent duplicate seq numbers. If concurrent status updates for
  // the same session collide, one insert raises a constraint violation and the
  // caller can retry — far better than two events sharing seq=N.
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS uq_session_events_session_seq ON session_events (session_id, seq)`;
  globalThis.__dashclaw_sessions_table_checked = true;
}

/**
 * Create a new agent session in the 'running' state with an initial event.
 *
 * Sessions used to start at 'spawning', but nothing in the normal lifecycle
 * ever advanced them (only session_end writes a terminal status, and it skips
 * 'running'). A session that was started and never explicitly ended therefore
 * sat at 'spawning' forever — the "stuck spawning" symptom. Starting at
 * 'running' reflects reality: once session_start succeeds the agent is live.
 */
export async function createSession(
  sql: SqlClient,
  orgId: string,
  agentId: string,
  workspace: string | null | undefined,
  branch: string | null = null,
): Promise<SessionRow | undefined> {
  await ensureTables(sql);

  const hex = randomUUID().replace(/-/g, '').slice(0, 12);
  const id = `sess_${hex}`;

  const rows = await sql`
    INSERT INTO agent_sessions (id, org_id, agent_id, workspace, branch, status)
    VALUES (${id}, ${orgId}, ${agentId}, ${workspace}, ${branch}, 'running')
    RETURNING *
  `;

  await sql`
    INSERT INTO session_events (session_id, org_id, seq, kind)
    VALUES (${id}, ${orgId}, 1, 'running')
  `;

  return rows[0];
}

/**
 * Get a single session by id, scoped to org.
 */
export async function getSession(
  sql: SqlClient,
  sessionId: string,
  orgId: string,
): Promise<SessionRow | null | undefined> {
  await ensureTables(sql);

  const rows = await sql`
    SELECT
      s.*,
      agg.action_count,
      agg.last_action_at,
      agg.total_cost,
      agg.max_risk,
      last_action.last_outcome_status,
      last_action.last_status,
      last_action.last_declared_goal,
      ev.event_count
    FROM agent_sessions s
    ${sessionAggregateSql(sql)}
    WHERE s.id = ${sessionId} AND s.org_id = ${orgId}
    LIMIT 1
  `;

  return shapeAggregatedSession(rows[0]) || null;
}

interface SessionUpdates {
  status?: string | null;
  green_level?: string | null;
  branch_freshness?: string | null;
  commits_behind?: number | null;
  blocked_reason?: string | null;
  summary?: string | null;
}

/**
 * Update a session's mutable fields.
 * If status changes, inserts a new session_event with the next sequence number.
 */
export async function updateSession(
  sql: SqlClient,
  sessionId: string,
  orgId: string,
  updates: SessionUpdates,
): Promise<SessionRow | null> {
  await ensureTables(sql);

  const {
    status = null,
    green_level = null,
    branch_freshness = null,
    commits_behind = null,
    blocked_reason = null,
    summary = null,
  } = updates;

  // blocked_reason only applies when status is 'blocked'
  const effectiveBlockedReason = status === 'blocked' ? blocked_reason : null;

  // Event detail salvage: session_end sends a 'summary' that the PATCH route
  // used to silently drop. Store it as the terminal session_event's detail so
  // it survives and surfaces on the detail page. blocked_reason still wins for
  // the 'blocked' transition; otherwise a terminal-status summary is recorded.
  const isTerminal = status != null && TERMINAL_STATUSES.includes(status);
  const eventDetail = status === 'blocked'
    ? effectiveBlockedReason
    : (isTerminal ? summary : null);

  // Terminal-state guard: once a session is closed, reject further updates
  // (no reviving via PATCH { status: 'active' }, no late mutations of
  // green_level/branch_freshness/etc.). The UPDATE matches zero rows, returns
  // null, and the event-insert below is skipped.
  //
  // Every parameter is explicitly cast. neon-serverless sends NULL parameters as
  // untyped, and Postgres cannot infer the type from contexts like `IS NOT NULL`
  // — without these casts, a PATCH that omits optional fields (e.g. session_end
  // sending only { status }) fails with 42P18 "could not determine data type of
  // parameter $N". The casts are no-ops for non-null values.
  const rows = await sql`
    UPDATE agent_sessions SET
      status           = COALESCE(${status}::text, status),
      status_since     = CASE WHEN ${status}::text IS NOT NULL AND ${status}::text != status THEN NOW() ELSE status_since END,
      green_level      = COALESCE(${green_level}::text, green_level),
      branch_freshness = COALESCE(${branch_freshness}::text, branch_freshness),
      commits_behind   = COALESCE(${commits_behind}::integer, commits_behind),
      blocked_reason   = CASE WHEN ${status}::text = 'blocked' THEN ${effectiveBlockedReason}::text ELSE blocked_reason END,
      last_activity    = NOW(),
      updated_at       = NOW()
    WHERE id = ${sessionId} AND org_id = ${orgId} AND status != 'closed'
    RETURNING *
  `;

  const session = rows[0] || null;

  // Insert a session event if the status actually changed. Single-statement
  // insert (seq computed in the same query) narrows the TOCTOU window from
  // the prior SELECT-then-INSERT pattern; the uq_session_events_session_seq
  // unique index closes the rest by failing loud on any remaining collision.
  if (session && status) {
    await sql`
      INSERT INTO session_events (session_id, org_id, seq, kind, detail)
      SELECT ${sessionId}, ${orgId}, COALESCE(MAX(seq), 0) + 1, ${status}, ${eventDetail}
      FROM session_events
      WHERE session_id = ${sessionId}
    `;
  }

  return session;
}

interface ListSessionsFilters {
  agent_id?: string | null;
  status?: string | null;
  limit?: number | string | null;
}

/**
 * List sessions for an org with optional filters.
 */
export async function listSessions(
  sql: SqlClient,
  orgId: string,
  filters: ListSessionsFilters = {},
): Promise<SessionRow[]> {
  await ensureTables(sql);

  const agentId = filters.agent_id || null;
  const status = filters.status || null;
  const limit = Math.min(parseInt(filters.limit as string, 10) || 50, 200);

  const rows = await sql`
    SELECT
      s.*,
      agg.action_count,
      agg.last_action_at,
      agg.total_cost,
      agg.max_risk,
      last_action.last_outcome_status,
      last_action.last_status,
      last_action.last_declared_goal,
      ev.event_count
    FROM agent_sessions s
    ${sessionAggregateSql(sql)}
    WHERE s.org_id = ${orgId}
      AND (${agentId}::text IS NULL OR s.agent_id = ${agentId})
      AND (${status}::text IS NULL OR s.status = ${status})
    ORDER BY s.updated_at DESC
    LIMIT ${limit}
  `;

  return rows.map(shapeAggregatedSession) as SessionRow[];
}

/**
 * Get all events for a session, ordered by sequence.
 */
export async function getSessionEvents(
  sql: SqlClient,
  sessionId: string,
  orgId: string,
): Promise<SessionRow[]> {
  await ensureTables(sql);

  // Lifecycle events are few (one per status transition), but a PATCH loop
  // could grow the table — defensive bound so the route can't return unbounded
  // rows.
  const rows = await sql`
    SELECT * FROM session_events
    WHERE session_id = ${sessionId} AND org_id = ${orgId}
    ORDER BY seq ASC
    LIMIT 500
  `;

  return rows;
}

export interface SessionActionsPage {
  actions: SessionRow[];
  total: number;
}

/**
 * List the action_records attributed to a session, newest first, paginated.
 *
 * Uses sessionActionMatchSql — the exact predicate behind the "# Actions"
 * aggregate — so the list total always equals the card count by construction.
 */
export async function getSessionActions(
  sql: SqlClient,
  sessionId: string,
  orgId: string,
  { limit = 50, offset = 0 }: { limit?: number | string | null; offset?: number | string | null } = {},
): Promise<SessionActionsPage> {
  await ensureTables(sql);

  const safeLimit = Math.min(Math.max(parseInt(limit as string, 10) || 50, 1), 200);
  const safeOffset = Math.max(parseInt(offset as string, 10) || 0, 0);

  const countRows = await sql`
    SELECT COUNT(*)::int AS total
    FROM agent_sessions s
    JOIN action_records ar
      ON ar.org_id = s.org_id
     AND ${sessionActionMatchSql(sql)}
    WHERE s.id = ${sessionId} AND s.org_id = ${orgId}
  `;

  const rows = await sql`
    SELECT
      ar.action_id,
      ar.agent_id,
      ar.action_type,
      ar.declared_goal,
      ar.status,
      ar.outcome_status,
      ar.risk_score,
      ar.cost_estimate,
      ar.created_at
    FROM agent_sessions s
    JOIN action_records ar
      ON ar.org_id = s.org_id
     AND ${sessionActionMatchSql(sql)}
    WHERE s.id = ${sessionId} AND s.org_id = ${orgId}
    ORDER BY ar.created_at DESC
    LIMIT ${safeLimit} OFFSET ${safeOffset}
  `;

  return {
    actions: rows.map((r) => ({
      ...r,
      risk_score: r.risk_score == null ? null : Number(r.risk_score),
      cost_estimate: Number(r.cost_estimate) || 0,
    })),
    total: Number(countRows[0]?.total) || 0,
  };
}
