-- Team Tasks (THESIS.md "Owner amendment — 2026-07-09: fleets and teams",
-- docs/decisions/2026-07-09-fleets-and-teams.md): the multi-agent task
-- timeline — one row per /team task run by the Claude Code + OpenClaw team,
-- events appended by both agents. Approval context and audit, NOT a
-- task-execution engine: deliberately fresh tables, not a revival of the
-- culled work_orders/routing_tasks/message_threads.
-- Idempotent and fresh-install-safe: plain timestamptz columns.
CREATE TABLE IF NOT EXISTS team_tasks (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  instruction TEXT NOT NULL,
  origin TEXT NOT NULL,
  lead_agent TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  stop_condition TEXT,
  max_exchanges INTEGER NOT NULL DEFAULT 10,
  claude_session_id TEXT,
  openclaw_session_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_team_tasks_org_created
  ON team_tasks (org_id, created_at);

CREATE TABLE IF NOT EXISTS team_task_events (
  id SERIAL PRIMARY KEY,
  org_id TEXT NOT NULL,
  task_id TEXT NOT NULL REFERENCES team_tasks(id) ON DELETE CASCADE,
  ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  from_agent TEXT NOT NULL,
  to_agent TEXT NOT NULL,
  type TEXT NOT NULL,
  summary TEXT NOT NULL,
  body TEXT,
  action_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_team_task_events_task
  ON team_task_events (task_id, ts);
