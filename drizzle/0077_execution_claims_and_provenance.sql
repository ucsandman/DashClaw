-- An action record can authorize at most one new execution attempt.
-- Missing response after a claim is uncertainty, not permission to retry.
ALTER TABLE action_records ADD COLUMN IF NOT EXISTS execution_claimed_at timestamptz;
-- Never upgrade historical rows into fresh execution authority.
ALTER TABLE action_records ADD COLUMN IF NOT EXISTS execution_protocol integer;
ALTER TABLE action_records ADD COLUMN IF NOT EXISTS execution_guard_decision_id text;
ALTER TABLE action_records ADD COLUMN IF NOT EXISTS execution_attempt_id text;
ALTER TABLE action_records ADD COLUMN IF NOT EXISTS identity_verified boolean;
ALTER TABLE action_records ADD COLUMN IF NOT EXISTS payload_signature_status text;
