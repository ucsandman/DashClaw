-- Agent identity & attribution v2 (owner roadmap v2.2): agent-scoped x402
-- budgets are now real (per-agent budget queries + the /spend/x402 agent
-- filter), so follow through on 0036's deferred "[+ optional agent_id]" —
-- give the exact-identity arm of the family match its own index. The
-- `agent_id LIKE '<base>:%'` sub-agent arm still resolves via the
-- (org_id, created_at) bounds of 0036 (x402 volume is low; the LIKE arm is
-- a filter, not a scan driver).
CREATE INDEX IF NOT EXISTS "idx_x402_purchases_org_agent_created" ON "x402_purchases" ("org_id", "agent_id", "created_at");
