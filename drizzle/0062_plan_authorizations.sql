-- Preflight Plan Authorization (docs/rfcs/2026-07-06-preflight-plan-authorization.md,
-- governed-autonomy program feature 1 of 3). An agent submits an ordered plan;
-- each step is dry-run through the guard pipeline at submission; the operator
-- reviews one card; approved steps become single-use act-scoped grants the
-- agent draws down. Generalizes the operator-approval grant (v4.64.0).
-- Idempotent and fresh-install-safe: plain TIMESTAMPTZ columns (never the
-- guard_decisions TEXT-created_at pattern).
CREATE TABLE IF NOT EXISTS plan_authorizations (
  plan_id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  declared_goal TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  ttl_minutes INTEGER NOT NULL DEFAULT 60,
  expires_at TIMESTAMPTZ,
  reviewed_by TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_plan_authorizations_org_status
  ON plan_authorizations (org_id, status, created_at);

CREATE TABLE IF NOT EXISTS plan_authorization_steps (
  step_id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  action_type TEXT NOT NULL,
  step_goal TEXT NOT NULL,
  act JSONB,
  act_content_hash TEXT,
  preview_decision TEXT,
  preview_risk_score INTEGER,
  preview_reasons JSONB,
  grant_status TEXT NOT NULL DEFAULT 'pending',
  grant_used_at TIMESTAMPTZ,
  matched_action_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_plan_authorization_steps_plan
  ON plan_authorization_steps (plan_id, seq);

-- The consumption query's hot filter: org + agent's approved unconsumed steps.
CREATE INDEX IF NOT EXISTS idx_plan_authorization_steps_consume
  ON plan_authorization_steps (org_id, action_type, grant_status)
  WHERE grant_used_at IS NULL;
