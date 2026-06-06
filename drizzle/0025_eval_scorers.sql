-- eval_scorers (reusable scorer definitions) was only ever created by the
-- standalone scripts/migrate-evaluations.mjs, never added to the drizzle chain.
-- A fresh deploy that runs `npm run db:migrate` therefore had eval_runs and
-- eval_scores but NO eval_scorers, so Evaluations > Scorers 500'd on every read
-- and write. Additive + idempotent: columns/types match the script verbatim, so
-- IF NOT EXISTS is a no-op on instances that already ran it.
CREATE TABLE IF NOT EXISTS "eval_scorers" (
  "id" TEXT PRIMARY KEY,
  "org_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "scorer_type" TEXT NOT NULL,
  "config" TEXT,
  "description" TEXT,
  "created_by" TEXT,
  "created_at" TEXT,
  "updated_at" TEXT
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "idx_eval_scorers_org_name" ON "eval_scorers" ("org_id", "name");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_eval_scorers_org" ON "eval_scorers" ("org_id");
