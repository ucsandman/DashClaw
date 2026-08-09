-- Per-org monthly metering rollup (hosted paid tier, G4).
-- docs/decisions/2026-08-09-hosted-paid-tier.md: ceilings and prices are set
-- only after a per-org metering rollup exists and has been run against real
-- hosted usage. This table is that rollup: read-only measurement, no
-- entitlement enforcement reads it.
-- Counters are maintained by createActionRecord (the single funnel shared by
-- POST /api/actions and POST /api/guard?record=true) and are exactly
-- rebuildable from action_records (scripts/backfill-usage-rollups.mjs).
-- Period-keyed ('YYYY-MM' UTC), so rows roll over naturally at month
-- boundaries and never need a reset cron — the design flaw that forced the
-- retired usage_meters table to carry reset-meters.yml.
CREATE TABLE IF NOT EXISTS usage_rollups (
  org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  period TEXT NOT NULL,
  governed_actions INTEGER NOT NULL DEFAULT 0,
  blocked_actions INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, period)
);
