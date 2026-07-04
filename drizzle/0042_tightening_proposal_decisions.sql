-- v3.2 findings become proposals (tightening direction): the human's
-- ratify/dismiss judgment on a posture-derived tightening proposal.
-- Proposals are computed on read from guard_decisions (app/lib/posture/
-- tightening.ts); only the decision persists, keyed by the engine's
-- content-stable tp_ id so a dismissed pattern stops re-proposing when the
-- same shape recurs in a later window. policy_id records the guard policy a
-- ratify created (ratify closes its own loop — no forge step in this family).
CREATE TABLE IF NOT EXISTS "tightening_proposal_decisions" (
  "id" serial PRIMARY KEY,
  "org_id" text NOT NULL,
  "proposal_id" text NOT NULL,
  "rule" text NOT NULL,
  "decision" text NOT NULL,
  "action_type" text,
  "risk_level" text,
  "finding_key" text,
  "snapshot" jsonb,
  "policy_id" text,
  "reason" text,
  "decided_by" text,
  "decided_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "tightening_proposal_decisions_org_proposal_unique" UNIQUE ("org_id", "proposal_id")
);

CREATE INDEX IF NOT EXISTS "idx_tightening_decisions_org_decision"
  ON "tightening_proposal_decisions" ("org_id", "decision");
