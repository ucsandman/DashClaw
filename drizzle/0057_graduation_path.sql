-- v7.2 graduation path (roadmap v7.2, spec
-- docs/superpowers/specs/2026-07-05-graduation-path-v72.md).
--
-- Graduation = the org took its governance record out. Stamped on the
-- first successful workspace export (hosted trials only; earliest stamp
-- wins, idempotent). NULL = never exported.
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "trial_exported_at" timestamptz;

-- Frozen at deletion time (same fail-closed freeze as 0052); pre-v7.2
-- archived rows keep NULL = unknown, never guessed.
ALTER TABLE "hosted_trial_snapshots" ADD COLUMN IF NOT EXISTS "exported_at" timestamptz;
