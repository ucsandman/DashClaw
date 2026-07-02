-- Approvals lifecycle hygiene (owner roadmap v2.3): a pending approval whose
-- requesting client has provably stopped waiting must expire instead of
-- sitting approvable forever. Clients declare their wait window at request
-- time (approval_wait_seconds); the server stamps
-- approval_expires_at = now + window + retry grace (the grace mirrors the
-- operator-approval grant window in guard.ts, keeping "approve after the hook
-- timed out, agent retries" alive). NULL = legacy row (pre-0039); the lazy
-- sweep treats those as expired 24h after creation.
ALTER TABLE "action_records" ADD COLUMN IF NOT EXISTS "approval_expires_at" timestamptz;

-- Partial index backing the lazy expiry sweep — only pending rows are
-- candidates, so the sweep never scans the terminal majority of the table.
CREATE INDEX IF NOT EXISTS "idx_action_records_pending_expiry"
  ON "action_records" ("org_id", "approval_expires_at")
  WHERE "status" = 'pending_approval';
