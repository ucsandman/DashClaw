-- signal_snapshots (signals-cron dedup fingerprints) was only ever created by
-- the legacy scripts/migrate-multi-tenant.mjs (step 23) and never made it into
-- the canonical schema/drizzle chain — so a FRESH deploy (npm run db:migrate)
-- had no table, getExistingSignalHashes/upsertSignalSnapshots threw, and the
-- signals cron's per-org catch swallowed it: signals.detected webhooks and
-- email alerts silently never fired on fresh instances (found 2026-08-08).
-- DDL mirrors the legacy script byte-for-byte (SERIAL id, TEXT timestamps) so
-- old and new deploys agree; IF NOT EXISTS makes it a no-op where the legacy
-- script already ran.
CREATE TABLE IF NOT EXISTS signal_snapshots (
  id SERIAL PRIMARY KEY,
  org_id TEXT NOT NULL DEFAULT 'org_default',
  signal_hash TEXT NOT NULL,
  signal_type TEXT NOT NULL,
  severity TEXT NOT NULL,
  agent_id TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS signal_snapshots_org_hash_unique
ON signal_snapshots (org_id, signal_hash);
