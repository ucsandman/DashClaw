export const ACTION_RECORDS_RUNTIME_COLUMN_DEFINITIONS = [
  { name: 'action_id', sql: 'text' },
  { name: 'swarm_id', sql: 'text' },
  { name: 'parent_action_id', sql: 'text' },
  { name: 'authorization_scope', sql: 'text' },
  { name: 'trigger', sql: 'text' },
  { name: 'input_summary', sql: 'text' },
  { name: 'reversible', sql: 'integer DEFAULT 1' },
  { name: 'recommendation_id', sql: 'text' },
  { name: 'recommendation_applied', sql: 'integer DEFAULT 0' },
  { name: 'recommendation_override_reason', sql: 'text' },
  { name: 'output_summary', sql: 'text' },
  { name: 'side_effects', sql: 'text' },
  { name: 'artifacts_created', sql: 'text' },
  { name: 'error_message', sql: 'text' },
  { name: 'timestamp_start', sql: 'text' },
  { name: 'timestamp_end', sql: 'text' },
  { name: 'duration_ms', sql: 'integer' },
  { name: 'cost_estimate', sql: 'real' },
  { name: 'tokens_in', sql: 'integer DEFAULT 0' },
  { name: 'tokens_out', sql: 'integer DEFAULT 0' },
  { name: 'signature', sql: 'text' },
  { name: 'verified', sql: 'integer DEFAULT 0' },
  { name: 'approved_by', sql: 'text' },
  { name: 'approved_at', sql: 'timestamp' },
  // Single-use operator-approval grants (drizzle/0045): stamped by the
  // guard's atomic consume; NULL means the approval is still grantable.
  { name: 'approval_grant_used_at', sql: 'timestamp' },
  // Closure provenance (drizzle/0048, v4.2 coverage truth): 'outcome' |
  // 'stop_autoclose' | 'direct'; NULL means pre-v4.2 row.
  { name: 'close_source', sql: 'text' },
  // Fleet attribution (drizzle/0049, v4.3): harness session uuid (fan-out
  // grouping key) + subagent instance uuid (leaf lineage evidence).
  { name: 'harness_session_id', sql: 'text' },
  { name: 'subagent_uuid', sql: 'text' }
];

export const ACTION_RECORDS_RUNTIME_COLUMNS = ACTION_RECORDS_RUNTIME_COLUMN_DEFINITIONS.map((column) => column.name);

export const ACTION_RECORDS_RUNTIME_INDEX_DEFINITIONS = [
  {
    name: 'action_records_action_id_idx',
    sql: 'CREATE INDEX IF NOT EXISTS "action_records_action_id_idx" ON "action_records" ("action_id")',
  },
  {
    name: 'action_records_org_timestamp_idx',
    sql: 'CREATE INDEX IF NOT EXISTS "action_records_org_timestamp_idx" ON "action_records" ("org_id", "timestamp_start")',
  },
];

export const ACTION_RECORDS_RUNTIME_INDEXES = ACTION_RECORDS_RUNTIME_INDEX_DEFINITIONS.map((index) => index.name);
