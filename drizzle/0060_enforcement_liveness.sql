-- v8.2 enforcement liveness (docs/plans/owner-roadmap.md §v8.2): probe
-- verdicts filed by hooks/enforcement_liveness_probe.py, which drives a
-- synthetic action through the DashClaw pretool hook seam. Its own table —
-- never action_records/guard_decisions — so synthetic probe traffic is
-- structurally excluded from posture/calibration/funnel mining (live-canary
-- precedent, drizzle/0046_live_canary_runs.sql).
-- Idempotent and fresh-install-safe: plain timestamptz columns (no TEXT drift).
CREATE TABLE IF NOT EXISTS enforcement_liveness_runs (
  id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'manual',
  verdict TEXT NOT NULL,
  detail TEXT NOT NULL,
  hook JSONB NOT NULL,
  witness JSONB NOT NULL,
  decision TEXT,
  checks JSONB NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_enforcement_liveness_runs_org_created
  ON enforcement_liveness_runs (org_id, created_at);
