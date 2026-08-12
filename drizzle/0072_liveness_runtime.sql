-- Per-seam enforcement liveness. enforcement_liveness_runs had no runtime
-- dimension, and the org verdict was a single `ORDER BY created_at DESC
-- LIMIT 1`. Both Claude Code and Codex install the probe and both reported
-- `source = 'session-start'` (source is the TRIGGER REASON — manual|
-- session-start|ci — never the runtime), so the two seams were
-- indistinguishable in the data and the newest row spoke for the whole fleet.
--
-- Net effect: a dead Codex seam rendered 'holding' as long as Claude Code had
-- probed in the last 24h. That is the exact failure the probe exists to catch
-- (enforcement renders green while not enforcing), reproduced one level up.
--
-- `runtime` defaults to 'unknown' rather than backfilling to 'claude-code':
-- existing rows genuinely do not record which seam produced them, and guessing
-- would manufacture the same false confidence this column removes.
ALTER TABLE enforcement_liveness_runs
  ADD COLUMN IF NOT EXISTS runtime TEXT NOT NULL DEFAULT 'unknown';

-- Serves the DISTINCT ON (runtime) latest-per-seam read.
CREATE INDEX IF NOT EXISTS idx_enforcement_liveness_runs_org_runtime_created
ON enforcement_liveness_runs (org_id, runtime, created_at DESC);
