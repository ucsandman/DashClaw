-- Calibration proposals human surface (owner roadmap v2.6b): the human's
-- ratify/dismiss judgment on a mined calibration proposal, recorded as an
-- auditable row. Proposals themselves are computed on read (same pure
-- pipeline as the weekly miner); only decisions persist. proposal_id is the
-- miner's content-derived cv_<sha256:16> — stable across recomputations, so
-- a decision recorded this week still binds when the shape recurs next week.
-- forged_at/vector_name are stamped by the maintainer session after it turns
-- a ratified proposal into a committed fixture vector (mark_forged).
CREATE TABLE IF NOT EXISTS "calibration_proposal_decisions" (
  "id" serial PRIMARY KEY,
  "org_id" text NOT NULL,
  "proposal_id" text NOT NULL,
  "rule" text NOT NULL,
  "decision" text NOT NULL,
  "suggested_label" text,
  "suggested_name" text,
  "provenance" text,
  "ratify_command" text,
  "representative" jsonb,
  "reason" text,
  "decided_by" text,
  "decided_at" timestamptz NOT NULL DEFAULT now(),
  "forged_at" timestamptz,
  "vector_name" text,
  CONSTRAINT "calibration_proposal_decisions_org_proposal_unique" UNIQUE ("org_id", "proposal_id")
);
--> statement-breakpoint
-- Backs the /policies section's decision join and the maintainer's
-- ?status=ratified queue scan.
CREATE INDEX IF NOT EXISTS "idx_calibration_decisions_org_decision"
  ON "calibration_proposal_decisions" ("org_id", "decision");
