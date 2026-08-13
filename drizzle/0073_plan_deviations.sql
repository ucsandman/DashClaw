-- Plan deviation events (RFC docs/rfcs/2026-08-11-plan-deviation-events.md).
-- The durable else-branch of consumePlanStepGrant: what the agent did vs what
-- the approved plan said it would do. Recording is unconditional (D1); the
-- shipped default consequence is nothing (D2); the detector fails soft (D3).
CREATE TABLE IF NOT EXISTS plan_deviations (
  deviation_id text PRIMARY KEY,
  org_id text NOT NULL,
  agent_id text NOT NULL,
  session_id text,
  action_id text,
  guard_decision_id text,
  plan_id text NOT NULL,
  step_id text,
  kind text NOT NULL,
  dimension text NOT NULL,
  severity text NOT NULL,
  declared jsonb,
  observed jsonb,
  detector text NOT NULL DEFAULT 'server_derived',
  match_confidence integer,
  agent_note text,
  policy_outcome text NOT NULL DEFAULT 'none',
  status text NOT NULL DEFAULT 'open',
  resolved_by text,
  resolved_at timestamptz,
  created_at timestamptz DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_plan_deviations_org_plan
  ON plan_deviations (org_id, plan_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_plan_deviations_org_action
  ON plan_deviations (org_id, action_id) WHERE action_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_plan_deviations_org_status
  ON plan_deviations (org_id, status, created_at DESC);
--> statement-breakpoint
-- step_abandoned sweep idempotency: one abandonment row per step, ever.
CREATE UNIQUE INDEX IF NOT EXISTS uq_plan_deviations_step_abandoned
  ON plan_deviations (step_id) WHERE kind = 'step_abandoned';
--> statement-breakpoint
-- Optional widened declared scope on plan steps (RFC section 7) — additive,
-- both optional, so every existing plan submission stays valid.
ALTER TABLE plan_authorization_steps ADD COLUMN IF NOT EXISTS declared_paths jsonb;
--> statement-breakpoint
ALTER TABLE plan_authorization_steps ADD COLUMN IF NOT EXISTS declared_systems jsonb;
