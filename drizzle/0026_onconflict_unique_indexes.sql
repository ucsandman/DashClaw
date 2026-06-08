-- Fresh-install fix: these three UNIQUE indexes back ON CONFLICT upserts that
-- already run in production (settings.repository, learningLoop.repository,
-- tokens.repository), but they were only ever created by the standalone
-- scripts/migrate-multi-tenant.mjs and scripts/migrate-learning-loop-mvp.mjs —
-- NOT by the drizzle/*.sql set that scripts/auto-migrate.mjs runs on every
-- Vercel deploy. A fresh deploy therefore got the tables (drizzle/0000) but not
-- these indexes, so settings / learning_episodes / daily_totals upserts threw
-- "no unique or exclusion constraint matching the ON CONFLICT specification".
--
-- DDL copied verbatim from migrate-multi-tenant.mjs (proven syntax — COALESCE as
-- an index column matches the code's ON CONFLICT expression exactly). Idempotent
-- (IF NOT EXISTS); a no-op on any instance that already has them.
CREATE UNIQUE INDEX IF NOT EXISTS settings_org_agent_key_unique
  ON settings (org_id, COALESCE(agent_id, ''), key);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS learning_episodes_org_action_unique
  ON learning_episodes (org_id, action_id);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS daily_totals_org_agent_date_unique
  ON daily_totals (org_id, COALESCE(agent_id, ''), date);
