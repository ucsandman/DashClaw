-- Reputation provenance: persist the reliability-blend breakdown beside the
-- vector columns. The breakdown is a SIBLING of the vector — it is never part
-- of vector_hash or the signed receipts, so existing receipts keep verifying.
ALTER TABLE "agent_reputation_snapshots" ADD COLUMN IF NOT EXISTS "breakdown" JSONB;
