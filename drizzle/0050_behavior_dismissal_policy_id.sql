-- v4.4 one judgment spine (docs/superpowers/specs/2026-07-04-one-judgment-spine.md).
-- One nullable column on behavior_dismissals, fresh-install-safe and idempotent:
--
-- policy_id (verdict 2b) — set only on status='adopted' rows; points at the
-- guard_policies draft the adoption created (behaviorRuleToGuardPolicy →
-- insertPolicy). Lets undo echo policy_kept and KEEP the draft (tightening's
-- policy_kept precedent — the policy is a first-class row managed at /policies).
-- NULL on dismissed / accepted_advisory rows and everything pre-v4.4; no backfill.
ALTER TABLE "behavior_dismissals" ADD COLUMN IF NOT EXISTS "policy_id" TEXT;
