-- Calibrated interruption controller (governance-core-theory §1).
-- guard_calibration_state: one row per org — the adaptive-conformal threshold
-- θ + per-agent e-process map as a jsonb blob (coerceCalibrationState
-- rehydrates defensively, so the blob shape can evolve without migrations).
-- guard_calibration_events: the labeled feedback stream (one row per human
-- adjudication consumed), the audit trail the state can be rebuilt from.
-- Writers also run the repository's ensureCalibrationTables (settings-table
-- pattern), so pre-0059 self-hosts work the moment they upgrade the code.
CREATE TABLE IF NOT EXISTS "guard_calibration_state" (
  "org_id" text PRIMARY KEY,
  "state" jsonb NOT NULL,
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "guard_calibration_events" (
  "id" serial PRIMARY KEY,
  "org_id" text NOT NULL,
  "action_id" text,
  "agent_id" text,
  "risk_score" real,
  "theta_before" real,
  "theta_after" real,
  "label" text NOT NULL,
  "loss" integer NOT NULL,
  "source" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_gcal_events_org_created"
  ON "guard_calibration_events" ("org_id", "created_at");
