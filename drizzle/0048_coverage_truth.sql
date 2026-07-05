-- v4.2 coverage truth (docs/superpowers/specs/2026-07-04-coverage-truth.md).
-- Two additions, both fresh-install-safe and idempotent:
--
-- 1. action_records.close_source — durable closure provenance (verdict 1).
--    Stamped server-side only: 'outcome' (a normal PATCH/outcome write closed
--    the row), 'stop_autoclose' (a close_if_running PATCH won the close), or
--    'direct' (the row was created already terminal — MCP dashclaw_record /
--    POST with a terminal status). NULL means pre-v4.2; no backfill. Lets the
--    server compute outcome coverage from durable data instead of string-
--    matching output_summary = 'Auto-closed by Stop hook'.
--
-- 2. coverage_reports — the Stop hook's per-turn expected-vs-recorded evidence
--    (verdict 2). Append-only, org-scoped. Transcript ground truth is
--    independent of whether Pre/PostToolUse fired, so a PreToolUse outage now
--    lowers a number the server can see instead of thinning the ledger
--    silently.
ALTER TABLE "action_records" ADD COLUMN IF NOT EXISTS "close_source" TEXT;

--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "coverage_reports" (
  "id" TEXT PRIMARY KEY,
  "org_id" TEXT NOT NULL,
  "agent_id" TEXT NOT NULL,
  "harness" TEXT,
  "harness_session_id" TEXT,
  "expected" INTEGER NOT NULL,
  "recorded" INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_coverage_reports_org_created"
  ON "coverage_reports" ("org_id", "created_at" DESC);

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_coverage_reports_org_agent"
  ON "coverage_reports" ("org_id", "agent_id");
