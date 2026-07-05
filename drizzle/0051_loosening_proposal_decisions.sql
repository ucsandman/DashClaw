-- v4.5 loosening direction: the human's ratify/dismiss judgment on a
-- ledger-derived proposal to RELAX an over-interrupting policy (the v3.2
-- tightening mirror). Proposals are computed on read from guard_decisions ×
-- action_records approval outcomes (app/lib/posture/loosening.ts); only the
-- decision persists, keyed by the engine's content-stable lp_ id so a
-- dismissed pattern stops re-proposing. policy_id records the guard policy a
-- ratify relaxed — undo keeps the change (change_kept, the policy_kept
-- precedent); action_type is set on scope carve-outs, null on deactivations.
CREATE TABLE IF NOT EXISTS "loosening_proposal_decisions" (
  "id" serial PRIMARY KEY,
  "org_id" text NOT NULL,
  "proposal_id" text NOT NULL,
  "rule" text NOT NULL,
  "decision" text NOT NULL,
  "action_type" text,
  "policy_id" text,
  "snapshot" jsonb,
  "reason" text,
  "decided_by" text,
  "decided_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "loosening_proposal_decisions_org_proposal_unique" UNIQUE ("org_id", "proposal_id")
);

CREATE INDEX IF NOT EXISTS "idx_loosening_decisions_org_decision"
  ON "loosening_proposal_decisions" ("org_id", "decision");
