-- v5.3 activation instrument sharpened (roadmap v5.3, spec
-- docs/superpowers/specs/2026-07-05-activation-instrument-sharpened-design.md).
--
-- Trial visit stamps: org-grain first/last seen, written fire-and-forget by
-- middleware on trial-session resolution — lets the funnel distinguish
-- "never returned" from "returned, never connected". A timestamp, not
-- page-view analytics.
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "trial_first_seen_at" timestamptz;
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "trial_last_seen_at" timestamptz;

-- First key use: last_used_at is a last-stamp; first_used_at makes
-- time-from-mint-to-first-key-use measurable. Deliberately NOT backfilled —
-- the true first use of already-used keys is unknowable; NULL is honest.
-- Bare timestamp to match its sibling last_used_at.
ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "first_used_at" timestamp;

-- Snapshot the new facts at deletion time (same fail-closed freeze as 0052;
-- pre-v5.3 archived rows keep NULLs = unknown, never guessed).
-- first_action_via: 'browser' | 'agent' — which door the first governed
-- action came through (v5.2 made browser activation reachable).
ALTER TABLE "hosted_trial_snapshots" ADD COLUMN IF NOT EXISTS "first_key_used_at" timestamptz;
ALTER TABLE "hosted_trial_snapshots" ADD COLUMN IF NOT EXISTS "first_seen_at" timestamptz;
ALTER TABLE "hosted_trial_snapshots" ADD COLUMN IF NOT EXISTS "last_seen_at" timestamptz;
ALTER TABLE "hosted_trial_snapshots" ADD COLUMN IF NOT EXISTS "first_action_via" text;
