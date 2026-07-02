-- Guard-deadline noise (owner roadmap v2.1): first-class degradation marker.
-- Degraded decisions were only detectable via reason ILIKE '%exceeded
-- deadline%', and the fail-open (allow) path left no persisted trace at all.
-- The column makes exclusion/aggregation cheap on the TEXT context table;
-- structured detail rides in context._degraded, timings in context._timings.
ALTER TABLE "guard_decisions" ADD COLUMN IF NOT EXISTS "degraded" boolean NOT NULL DEFAULT false;
