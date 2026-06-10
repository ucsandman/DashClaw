-- Codify the live action_records indexes into the schema lineage.
-- These indexes have existed on migrated live DBs since
-- scripts/migrate-multi-tenant.mjs introduced them, but were never part of
-- schema/schema.js or the drizzle migrations — so a FRESH install never got
-- them and seq-scanned the hottest table. IF NOT EXISTS makes this a no-op
-- on already-indexed databases. No data changes.
CREATE INDEX IF NOT EXISTS "idx_action_records_org_id" ON "action_records" ("org_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_action_records_org_action_id" ON "action_records" ("org_id", "action_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_action_records_org_agent_id" ON "action_records" ("org_id", "agent_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_action_records_org_ts" ON "action_records" ("org_id", "timestamp_start");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_action_records_recommendation_id" ON "action_records" ("org_id", "recommendation_id");
