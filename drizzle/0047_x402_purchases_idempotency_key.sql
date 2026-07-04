-- v3.7 5d — x402 purchase idempotency key. /api/actions and /api/guard already
-- short-circuit duplicate (org_id, idempotency_key) submissions; x402
-- purchases — the money route — was the one sibling without it, so a client
-- retry minted two action ids and two purchase rows, both counted toward
-- spend. Mirrors drizzle/0004_action_outcome_finality.sql's
-- action_records_idempotency_idx pattern exactly: optional column, conditional
-- unique index that only enforces when a key is actually supplied, scoped per
-- org so two orgs can independently reuse the same key.
ALTER TABLE "x402_purchases" ADD COLUMN IF NOT EXISTS "idempotency_key" TEXT;

--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "x402_purchases_idempotency_idx"
  ON "x402_purchases" ("org_id", "idempotency_key")
  WHERE "idempotency_key" IS NOT NULL;
