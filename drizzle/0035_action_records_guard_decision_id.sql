-- Link action_records back to the guard_decisions row that produced them.
--
-- There is no join today between a guard decision (act_gd_*) and the approval
-- that resolved it: approvals are status transitions on action_records, and
-- which policy required the approval lives only in
-- guard_decisions.matched_policies. The policy-tuning proposal loop (owner
-- roadmap item 1, spec docs/superpowers/specs/2026-07-01-policy-tuning-
-- proposal-loop.md) needs per-policy approval outcomes, so writers that know
-- the decision id stamp it here: recordRunningAction (?record=true in
-- POST /api/guard) always does; POST /api/actions accepts it optionally.
-- Evidence accrues going forward — no backfill, no heuristic correlation.
--
-- Additive + idempotent: ADD COLUMN IF NOT EXISTS is a no-op on databases
-- that already have the column, and the auto-migrator's SAFE_CODES covers
-- the rest.
ALTER TABLE action_records ADD COLUMN IF NOT EXISTS guard_decision_id TEXT;

--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_action_records_org_guard_decision
  ON action_records (org_id, guard_decision_id)
  WHERE guard_decision_id IS NOT NULL;
