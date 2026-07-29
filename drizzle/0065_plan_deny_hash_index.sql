-- v5.4.0 follow-up: findDeniedStepMatch's hash branch matches
-- act_content_hash = $X for the whole org REGARDLESS of action_type (an
-- attacker must not evade a denial by relabeling the same act), so the
-- consume index (org_id, action_type, grant_status) cannot serve it — a
-- hash-only probe degraded to filtering every unconsumed step in the org.
-- This partial index makes the per-guard-call denial probe an indexed
-- lookup on both branches (Postgres BitmapOrs it with the consume index
-- for the action_type+goal branch).
CREATE INDEX IF NOT EXISTS idx_plan_authorization_steps_deny_hash
  ON plan_authorization_steps (org_id, act_content_hash)
  WHERE grant_status = 'denied' AND grant_used_at IS NULL;
