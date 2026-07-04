-- 0045_approval_grant_single_use
--
-- ADR Phase 2 (docs/architecture/trust-and-failure-model.md):
--
-- 1. approval_grant_used_at — an operator approval becomes a single-use
--    grant. The guard's operator-approval post-pass consumes it with an
--    atomic UPDATE ... WHERE approval_grant_used_at IS NULL, so one approval
--    downgrades exactly one retried evaluation (previously any number of
--    identical-goal calls inside the 15-minute window inherited it).
--
-- 2. idx_guard_decisions_org_agent_created — the rate_limit runaway valve
--    now counts guard_decisions (every evaluation) instead of action_records
--    (only recorded ones); this index keeps that count off a seq scan.
--    Ordered after 0043, so created_at is timestamp-typed on every install
--    by the time it applies.
ALTER TABLE "action_records" ADD COLUMN IF NOT EXISTS "approval_grant_used_at" timestamp;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_guard_decisions_org_agent_created" ON "guard_decisions" ("org_id", "agent_id", "created_at");
