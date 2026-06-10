-- 0031: Behavior Learning opt-in anonymized sample upload.
--
-- behavior_samples holds ANONYMIZED samples the local recorder uploads when an
-- org explicitly opts in (BEHAVIOR_UPLOAD_ENABLED, default off). Paths arrive
-- as salted hashes (read_path_hashes / write_path_hashes — never raw paths);
-- protected-path classification arrives pre-computed in write_path_groups.
-- UNIQUE (org_id, event_id) backs the idempotent ingest upsert where a
-- finalized record supersedes a "running" one (mirrors pickFinalSample).
-- Retention is pruned opportunistically on ingest (60 days / newest 20000 per
-- org) — the free tier has no cron.
CREATE TABLE IF NOT EXISTS "behavior_samples" (
  "id" serial PRIMARY KEY,
  "org_id" text NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "event_id" text NOT NULL,
  "ts" timestamptz NOT NULL,
  "agent_id" text NOT NULL,
  "session_hash" text,
  "source" text,
  "tool" text,
  "tool_category" text,
  "action_type" text,
  "command_shape" text,
  "bash_intent" text,
  "risk_score" integer,
  "guard_decision" text,
  "reversible" integer,
  "model" text,
  "read_path_hashes" jsonb,
  "write_path_hashes" jsonb,
  "write_path_groups" jsonb,
  "sensitive_path" integer,
  "outcome_status" text,
  "error_type" text,
  "duration_ms" integer,
  "matched_policy_count" integer,
  "finalized" integer DEFAULT 0,
  "created_at" timestamptz DEFAULT now(),
  CONSTRAINT "behavior_samples_org_event_unique" UNIQUE ("org_id", "event_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_behavior_samples_org_agent_ts"
  ON "behavior_samples" ("org_id", "agent_id", "ts" DESC);
--> statement-breakpoint
-- Server-side twin of the local .dismissals.json so dismiss/adopt suppression
-- works for uploaded samples on hosted instances.
CREATE TABLE IF NOT EXISTS "behavior_dismissals" (
  "id" serial PRIMARY KEY,
  "org_id" text NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "signature" text NOT NULL,
  "agent_id" text,
  "type" text,
  "target" text,
  "reason" text,
  "status" text,
  "suppress_similar" integer DEFAULT 0,
  "ts" timestamptz DEFAULT now(),
  CONSTRAINT "behavior_dismissals_org_signature_unique" UNIQUE ("org_id", "signature")
);
