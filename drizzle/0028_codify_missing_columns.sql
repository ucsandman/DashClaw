-- Codify two columns that exist in schema/schema.js but never got a
-- migration, so fresh installs (built solely from drizzle/*.sql, e.g. the
-- hosted instance) are missing them and any route selecting them 500s with
-- 42703 ("column does not exist") — first hit in production by the
-- `dashclaw install claude --trial` preflight calling GET /api/actions.
-- Live DBs that received the columns via drizzle-kit push are unaffected
-- (IF NOT EXISTS). No data changes.
ALTER TABLE "action_records" ADD COLUMN IF NOT EXISTS "model" text;
--> statement-breakpoint
ALTER TABLE "webhooks" ADD COLUMN IF NOT EXISTS "last_trigger_at" timestamp;
