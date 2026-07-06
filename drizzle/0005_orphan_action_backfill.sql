-- One-shot backfill: mark orphan `running` action_records as lost_confirmation.
--
-- Context: prior to the outcome-sweep cron being scheduled (see
-- .github/workflows/outcome-sweep.yml), action_records started by an agent
-- that then crashed or never reported a terminal status accumulated forever
-- in `status='running'` / `outcome_status='pending'`. Mission Control's
-- operations feed surfaced these as "Stalled decision (691h)" entries that
-- never aged out. This statement closes them so they stop appearing.
--
-- Idempotent: the WHERE clause excludes already-swept rows, so re-running is
-- a no-op.

UPDATE action_records
SET outcome_status  = 'lost_confirmation',
    outcome_at      = NOW(),
    outcome_summary = COALESCE(outcome_summary, 'Backfilled - orphan past 24h retention window'),
    updated_at      = CURRENT_TIMESTAMP
WHERE outcome_status = 'pending'
  AND status = 'running'
  AND timestamp_start::timestamptz < NOW() - INTERVAL '24 hours';
