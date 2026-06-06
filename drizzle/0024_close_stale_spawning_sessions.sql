-- Agent sessions stuck at 'spawning': the lifecycle never advanced them (only
-- session_end writes a terminal status), so a session that was started and never
-- explicitly ended sat at 'spawning' forever — which is why the Agent Sessions
-- page showed rows perpetually "spawning". createSession() now inserts 'running'
-- directly; this is a one-time sweep for the pre-existing rows.
-- Idempotent: only touches rows still at 'spawning' and older than 1h (genuinely
-- abandoned — no agent is going to send a late session_end for those).
UPDATE "agent_sessions"
  SET "status" = 'closed', "updated_at" = NOW()
  WHERE "status" = 'spawning'
    AND "created_at" < NOW() - INTERVAL '1 hour';
--> statement-breakpoint
-- Align the column default with what the application actually inserts so no
-- Drizzle/codegen path can re-introduce the stuck 'spawning' default.
ALTER TABLE "agent_sessions" ALTER COLUMN "status" SET DEFAULT 'running';
