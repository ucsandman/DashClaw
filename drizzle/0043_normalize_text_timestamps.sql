-- 0043_normalize_text_timestamps
--
-- Fresh-install truth: the 0000 baseline created 47 *_at columns as TEXT
-- while schema/schema.js and app/api/setup/migrate declare timestamp, so the
-- physical column type depended on which installer ran. Queries that forgot
-- a ::timestamptz cast failed ONLY on fresh drizzle-chain installs (42883)
-- and best-effort catches turned that into silently dead subsystems (the
-- guard idempotency replay lookup was one).
--
-- Converts each drifted column TEXT -> timestamp (matching schema.js and
-- setup/migrate exactly). Conditional on information_schema, so legacy
-- installs where the column is already timestamp are a no-op. Values cast
-- cleanly: app code always wrote ISO-8601 strings, and Postgres parses the
-- literal 'now()' (the broken text DEFAULT some columns carried) as a
-- timestamp input. Columns that are text in BOTH schema.js and the chain
-- (e.g. organizations.trial_ends_at) are intentionally NOT listed.
--
-- The third VALUES field marks columns schema.js gives .defaultNow(): their
-- old text DEFAULT 'now()' would freeze into a constant under ALTER TYPE, so
-- the default is dropped first and re-created as the function now().
--
-- Guarded by __tests__/unit/drizzle-timestamp-parity.test.js: any future
-- text *_at column that schema.js types as timestamp fails the suite until
-- a normalization entry covers it.
DO $$
DECLARE
  pair record;
BEGIN
  FOR pair IN
    SELECT v.table_name AS t, v.column_name AS col, v.default_now AS default_now
    FROM (VALUES
      ('activity_logs', 'created_at', true),
      ('agent_connections', 'updated_at', true),
      ('agent_messages', 'created_at', true),
      ('agent_messages', 'read_at', false),
      ('agent_messages', 'archived_at', false),
      ('compliance_snapshots', 'created_at', true),
      ('content', 'created_at', true),
      ('context_entries', 'created_at', true),
      ('context_points', 'created_at', true),
      ('eval_runs', 'started_at', false),
      ('eval_runs', 'completed_at', false),
      ('eval_runs', 'created_at', true),
      ('eval_scores', 'created_at', true),
      ('guard_decisions', 'created_at', true),
      ('guard_policies', 'created_at', true),
      ('guard_policies', 'updated_at', true),
      ('guardrails_test_runs', 'created_at', true),
      ('interactions', 'created_at', true),
      ('learning_episodes', 'created_at', true),
      ('learning_episodes', 'updated_at', true),
      ('learning_recommendation_events', 'created_at', true),
      ('learning_recommendations', 'computed_at', true),
      ('learning_recommendations', 'updated_at', true),
      ('message_threads', 'created_at', true),
      ('message_threads', 'updated_at', true),
      ('message_threads', 'resolved_at', false),
      ('routing_agent_metrics', 'last_completed_at', false),
      ('routing_agent_metrics', 'created_at', true),
      ('routing_agents', 'created_at', true),
      ('routing_agents', 'updated_at', true),
      ('routing_decisions', 'created_at', true),
      ('routing_tasks', 'created_at', true),
      ('routing_tasks', 'updated_at', true),
      ('shared_docs', 'created_at', true),
      ('shared_docs', 'updated_at', true),
      ('snippets', 'created_at', true),
      ('usage_meters', 'last_reconciled_at', false),
      ('usage_meters', 'updated_at', true),
      ('user_approaches', 'created_at', true),
      ('user_approaches', 'updated_at', true),
      ('user_moods', 'created_at', true),
      ('user_observations', 'created_at', true),
      ('user_preferences', 'created_at', true),
      ('users', 'created_at', true),
      ('users', 'last_login_at', true),
      ('waitlist', 'signed_up_at', true),
      ('webhooks', 'created_at', true)
    ) AS v(table_name, column_name, default_now)
    JOIN information_schema.columns c
      ON c.table_schema = 'public'
     AND c.table_name = v.table_name
     AND c.column_name = v.column_name
     AND c.data_type = 'text'
  LOOP
    EXECUTE format('ALTER TABLE %I ALTER COLUMN %I DROP DEFAULT', pair.t, pair.col);
    EXECUTE format(
      'ALTER TABLE %I ALTER COLUMN %I TYPE timestamp USING NULLIF(%I, '''')::timestamp',
      pair.t, pair.col, pair.col
    );
    IF pair.default_now THEN
      EXECUTE format('ALTER TABLE %I ALTER COLUMN %I SET DEFAULT now()', pair.t, pair.col);
    END IF;
  END LOOP;
END $$;
