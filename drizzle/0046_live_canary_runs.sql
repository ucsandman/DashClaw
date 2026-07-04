-- v3.4 live-host canary (docs/superpowers/plans/2026-07-04-live-host-canary.md):
-- verdicts reported by scripts/live-canary.mjs from the hourly GitHub Actions
-- cron. Its own table — never action_records/guard_decisions — so the canary's
-- synthetic traffic is structurally excluded from posture and mining (v3.1 bar).
-- Idempotent and fresh-install-safe: plain timestamptz columns (no TEXT drift).
CREATE TABLE IF NOT EXISTS live_canary_runs (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'github-actions',
  status TEXT NOT NULL,
  checks JSONB NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_live_canary_runs_org_created
  ON live_canary_runs (org_id, created_at);
