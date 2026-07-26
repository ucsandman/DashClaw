-- Separation of duties on plan review (security remediation wave, mirrors
-- drizzle/0055_approval_separation_of_duties.sql for action_records): record
-- the middleware-attributed principal that SUBMITTED each plan so the plan
-- review route can reject reviewer === created_by. The credential that
-- submitted a plan may not approve it — same posture as the approvals gate.
-- NULL on legacy/system-created rows = separation not enforceable there.
ALTER TABLE "plan_authorizations" ADD COLUMN IF NOT EXISTS "created_by" text;
