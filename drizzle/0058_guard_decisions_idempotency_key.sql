-- Hot-path latency (perf pass 2026-07-06): the idempotent-replay lookup on
-- POST /api/guard matched context::jsonb->>'idempotency_key' with a per-row
-- jsonb cast over the whole 10-minute window — an unindexed seq scan that
-- runs on EVERY hook call and grows linearly with fleet decision volume
-- (~3ms CPU per 1k window rows, measured). Persist the key in its own
-- column and serve the lookup from a partial index instead.
--
-- Transition: rows written by pre-0058 code carry NULL here, so for one
-- replay window (10 min) after deploy a retry of a pre-deploy call misses
-- the replay and re-evaluates — the lookup's documented fail-open behavior,
-- identical to its error path. No decision is lost; one duplicate
-- evaluation is possible during that window.
ALTER TABLE "guard_decisions" ADD COLUMN IF NOT EXISTS "idempotency_key" text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_guard_decisions_org_idem" ON "guard_decisions" ("org_id", "idempotency_key") WHERE "idempotency_key" IS NOT NULL;
