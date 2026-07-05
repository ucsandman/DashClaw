-- v6.4 reach attribution (roadmap v6.4, spec
-- docs/superpowers/specs/2026-07-05-reach-attribution-v64.md).
--
-- Mint-time source capture at org grain: one write at mint, never updated.
-- trial_mint_source is the resolved channel label (utm_source > referrer
-- host > 'direct'); trial_mint_source_raw keeps the sanitized referrer/UTM
-- strings it was derived from — nothing beyond those strings is captured.
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "trial_mint_source" text;
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "trial_mint_source_raw" jsonb;

-- Snapshot the source at deletion time (same fail-closed freeze as 0052;
-- pre-v6.4 archived rows keep NULLs = unknown, never guessed — rendered as
-- an explicit 'unknown' bucket, distinct from 'direct').
ALTER TABLE "hosted_trial_snapshots" ADD COLUMN IF NOT EXISTS "mint_source" text;
ALTER TABLE "hosted_trial_snapshots" ADD COLUMN IF NOT EXISTS "mint_source_raw" jsonb;
