-- Cumulative x402 budget gate (owner roadmap item 2): the guard-time window
-- sum filters x402_purchases by (org_id, created_at) [+ optional agent_id] on
-- the guard hot path. The only existing index leads with provider_id after
-- org_id, so give the budget query its own narrow index.
CREATE INDEX IF NOT EXISTS "idx_x402_purchases_org_created" ON "x402_purchases" ("org_id", "created_at");
