-- v4.3 fleet attribution (docs/superpowers/specs/2026-07-04-fleet-attribution.md).
-- Two nullable columns on action_records, both fresh-install-safe and idempotent:
--
-- 1. harness_session_id (verdict 1) — the harness session uuid the pretool hook
--    stamps on EVERY record (guard ?record=true payload + POST /api/actions
--    fallback). This is the new fan-out grouping key; it is deliberately NOT
--    action_records.session_id (which belongs to the sess_* DashClaw-session
--    namespace and would double-count into overlapping sess_* aggregates).
--
-- 2. subagent_uuid (verdict 2a) — the subagent instance uuid the pretool hook
--    receives on stdin for a leaf call. Persisted evidence for the read-time
--    lineage join; NULL on non-subagent rows. NULL means pre-v4.3; no backfill.
--
-- The (org_id, harness_session_id) index backs the fan-out read
-- (getRecentFanouts / GET /api/agents/fanouts).
ALTER TABLE "action_records" ADD COLUMN IF NOT EXISTS "harness_session_id" TEXT;

--> statement-breakpoint

ALTER TABLE "action_records" ADD COLUMN IF NOT EXISTS "subagent_uuid" TEXT;

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_action_records_org_harness_session"
  ON "action_records" ("org_id", "harness_session_id");
