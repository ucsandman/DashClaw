-- Separation of duties on the approval gate (security review 2026-07-05,
-- follow-up to v4.61.1 attribution): record the middleware-attributed
-- principal that created each action so the approve routes can reject
-- approver === creator (the 'operator' root principal is exempt — in
-- single-admin self-host the same key legitimately does both).
-- NULL on legacy and system-created rows = separation not enforceable there.
ALTER TABLE "action_records" ADD COLUMN IF NOT EXISTS "created_by" text;
