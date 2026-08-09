-- Stripe webhook idempotency ledger (hosted paid tier, checkout).
-- docs/decisions/2026-08-09-hosted-paid-tier.md: checkout comes last, after
-- accounts (0069) and metering (0068) are true. The culled 2026 billing
-- webhook had no replay protection; this ledger is the fix. Each Stripe
-- event id is claimed exactly once (INSERT ... ON CONFLICT DO NOTHING with
-- the row count deciding whether the handler runs), so Stripe retries and
-- operator replays are no-ops instead of double-applied writes.
-- org_id is nullable and NOT an FK: events can arrive for customers whose
-- org was deleted, and the ledger must still record the claim.
CREATE TABLE IF NOT EXISTS stripe_webhook_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  org_id TEXT,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS stripe_webhook_events_processed_idx ON stripe_webhook_events (processed_at);
