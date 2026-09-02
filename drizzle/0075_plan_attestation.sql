-- Plan attestation (docs/rfcs/2026-07-06-preflight-plan-authorization.md,
-- "Attest before you act"). Steps already carry act_content_hash, but nothing
-- pinned the plan AS A WHOLE, so an unattended runner had no way to prove at
-- wake time that the authority it is about to spend is still the one the
-- operator approved. plan_hash is that pin; the attest_* columns journal every
-- call to POST /api/plans/:planId/attest so a fail-closed wake is auditable.
-- Additive and idempotent: plan_hash is NULL on rows written before this
-- migration, and attestPlan treats a NULL stored hash as a mismatch (a plan
-- that cannot prove its content fails closed).
ALTER TABLE plan_authorizations ADD COLUMN IF NOT EXISTS plan_hash TEXT;
--> statement-breakpoint
ALTER TABLE plan_authorizations ADD COLUMN IF NOT EXISTS attested_at TIMESTAMPTZ;
--> statement-breakpoint
ALTER TABLE plan_authorizations ADD COLUMN IF NOT EXISTS attest_count INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE plan_authorizations ADD COLUMN IF NOT EXISTS last_attest_result TEXT;
