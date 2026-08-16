export const SETUP_MIGRATION_SCRIPTS = [
  // The drizzle chain FIRST — it is the schema source of truth (settings,
  // token_budgets, agent_messages.action_id, and every newer table live only
  // there). Hosted deploys run it during the Vercel build; local setup must
  // run it too or fresh installs end up with the legacy-script subset and
  // fail readiness on missing core tables (observed live: `npx dashclaw up`
  // ending in no_tables with `settings` absent).
  'scripts/auto-migrate.mjs',
  'scripts/migrate-api-keys-compat.mjs',
  'scripts/migrate-multi-tenant.mjs',
  'scripts/migrate-action-records-compat.mjs',
  'scripts/migrate-cost-analytics.mjs',
  'scripts/migrate-identity-binding.mjs',
  'scripts/migrate-agent-pairings.mjs',
  'scripts/migrate-hitl-metadata.mjs',
  'scripts/migrate-policy-agent-scope.mjs',
  'scripts/migrate-token-budgets.mjs',
  'scripts/migrate-prompt-injection.mjs',
  'scripts/migrate-evaluations.mjs',
  'scripts/migrate-scoring-profiles.mjs',
  'scripts/migrate-prompts.mjs',
  'scripts/migrate-feedback.mjs',
  'scripts/migrate-agent-schedules.mjs',
  'scripts/migrate-message-attachments.mjs',
  'scripts/migrate-ideas-subscores.mjs',
  'scripts/migrate-agent-messages-index.mjs',
];

export const SETUP_READINESS_MIGRATION_SCRIPTS = [
  'scripts/migrate-multi-tenant.mjs',
  'scripts/migrate-cost-analytics.mjs',
  'scripts/migrate-identity-binding.mjs',
];

export const CORE_SETUP_TABLES = [
  'action_records',
  'guard_decisions',
  'api_keys',
  'users',
  'settings',
  'guard_policies',
];

export function buildSetupMigrationCommands(scripts = SETUP_MIGRATION_SCRIPTS) {
  return scripts.map((script) => `node scripts/_run-with-env.mjs ${script}`);
}

export function getSetupMigrationCommand(script) {
  return buildSetupMigrationCommands([script])[0] || '';
}

