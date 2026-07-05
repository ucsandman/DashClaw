-- Act-content grant binding (security review 2026-07-05, the remaining
-- follow-up to v4.62.0): persist a server-computed hash of the actual act
-- payload (evidence-first guard, v4.63.0) on the action row, so the
-- operator-approval grant can bind a retry to the exact act that was
-- approved — approving act X no longer authorizes a different act Y that
-- shares the same agent + declared_goal + action_type. NULL on rows created
-- without an act (legacy SDKs, non-act creators) = binding not enforceable
-- there; the grant then keeps the v4.62.0 tuple match.
ALTER TABLE "action_records" ADD COLUMN IF NOT EXISTS "act_content_hash" text;
