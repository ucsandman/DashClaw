// Domain annotation: prefix a `pgTable(...)` line with `// @domain <name>` to
// tag the table. livingcode's schema collector (livingcode/collectors/schema.py)
// picks up the tag and stores it on TableInfo.domain in shape.json, so
// app/lib/doctor/shape.mjs can filter via getTablesByDomain('<name>') without
// a hand-maintained map. Current domains: governance. Regenerate after edits
// with `npm run livingcode:refresh`.
import { pgTable, text, timestamp, integer, boolean, uniqueIndex, unique, numeric, customType, serial, real, jsonb, pgEnum, check, bigint, primaryKey, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// Custom vector type for pgvector
const vector = customType({
  dataType() {
    return 'vector(1536)';
  },
});

// --- Base Tables ---

export const organizations = pgTable('organizations', {
  id: text('id').primaryKey(), // org_ prefix
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  plan: text('plan').default('free'),
  stripeCustomerId: text('stripe_customer_id'),
  stripeSubscriptionId: text('stripe_subscription_id'),
  subscriptionStatus: text('subscription_status').default('active'),
  currentPeriodEnd: text('current_period_end'),
  trialEndsAt: text('trial_ends_at'),
  hostedMode: boolean('hosted_mode').default(false).notNull(),
  trialActionCap: integer('trial_action_cap'),
  trialActionsUsed: integer('trial_actions_used').default(0).notNull(),
  // v5.3: org-grain trial visit stamps, written fire-and-forget by middleware
  // on trial-session resolution. A timestamp, not page-view analytics.
  trialFirstSeenAt: timestamp('trial_first_seen_at', { withTimezone: true }),
  trialLastSeenAt: timestamp('trial_last_seen_at', { withTimezone: true }),
  // v6.4 reach attribution: one write at mint, never updated. Label resolved
  // utm_source > referrer host > 'direct'; raw keeps only the sanitized
  // referrer/UTM strings it was derived from.
  trialMintSource: text('trial_mint_source'),
  trialMintSourceRaw: jsonb('trial_mint_source_raw'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const users = pgTable('users', {
  id: text('id').primaryKey(), // usr_ prefix
  orgId: text('org_id').notNull().references(() => organizations.id),
  email: text('email').notNull(),
  name: text('name'),
  image: text('image'),
  provider: text('provider'),
  providerAccountId: text('provider_account_id'),
  role: text('role').default('member'),
  createdAt: timestamp('created_at').defaultNow(),
  lastLoginAt: timestamp('last_login_at').defaultNow(),
}, (table) => ({
  providerUnique: uniqueIndex('users_provider_account_unique').on(table.provider, table.providerAccountId),
  roleCheck: check('users_role_check', sql`${table.role} IN ('admin', 'member')`),
}));

// @domain governance
export const apiKeys = pgTable('api_keys', {
  id: text('id').primaryKey(), // key_ prefix
  orgId: text('org_id').notNull().references(() => organizations.id),
  keyHash: text('key_hash').notNull(),
  keyPrefix: text('key_prefix').notNull(),
  label: text('label').default('default'),
  role: text('role').default('member'),
  scope: text('scope'),
  lastUsedAt: timestamp('last_used_at'),
  // v5.3: set once (COALESCE) alongside every last_used_at stamp; NULL means
  // "used before v5.3 or never" — deliberately not backfilled.
  firstUsedAt: timestamp('first_used_at'),
  revokedAt: timestamp('revoked_at'),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => ({
  roleCheck: check('api_keys_role_check', sql`${table.role} IN ('admin', 'member')`),
  // Hot path: middleware resolveApiKey() looks up by key_hash on every cache-miss.
  keyHashIdx: index('idx_api_keys_key_hash').on(table.keyHash),
}));

// @domain governance
export const oauthClients = pgTable('oauth_clients', {
  clientId: text('client_id').primaryKey(), // ocl_ prefix
  clientName: text('client_name'),
  redirectUris: text('redirect_uris').notNull(), // JSON array
  grantTypes: text('grant_types').notNull().default('authorization_code,refresh_token'),
  tokenEndpointAuthMethod: text('token_endpoint_auth_method').notNull().default('none'),
  scope: text('scope'),
  createdAt: timestamp('created_at').defaultNow(),
});

// @domain governance
export const oauthAuthorizationCodes = pgTable('oauth_authorization_codes', {
  codeHash: text('code_hash').primaryKey(),
  clientId: text('client_id').notNull(),
  orgId: text('org_id').notNull(),
  userId: text('user_id'),
  redirectUri: text('redirect_uri').notNull(),
  codeChallenge: text('code_challenge').notNull(),
  codeChallengeMethod: text('code_challenge_method').notNull().default('S256'),
  scope: text('scope'),
  agentId: text('agent_id'),
  expiresAt: timestamp('expires_at').notNull(),
  consumedAt: timestamp('consumed_at'),
  createdAt: timestamp('created_at').defaultNow(),
});

// @domain governance
export const oauthAccessTokens = pgTable('oauth_access_tokens', {
  tokenHash: text('token_hash').primaryKey(),
  refreshTokenHash: text('refresh_token_hash'),
  clientId: text('client_id').notNull(),
  orgId: text('org_id').notNull(),
  userId: text('user_id'),
  scope: text('scope'),
  agentId: text('agent_id').notNull().default('claude-desktop'),
  expiresAt: timestamp('expires_at').notNull(),
  revokedAt: timestamp('revoked_at'),
  lastUsedAt: timestamp('last_used_at'),
  createdAt: timestamp('created_at').defaultNow(),
});

// --- Action & Governance Tables ---

// @domain governance
export const actionRecords = pgTable('action_records', {
  id: serial('id').primaryKey(),
  actionId: text('action_id').unique(), // ar_ prefix
  orgId: text('org_id').notNull().references(() => organizations.id),
  agentId: text('agent_id').notNull(),
  agentName: text('agent_name'),
  swarmId: text('swarm_id'),
  parentActionId: text('parent_action_id'),
  actionType: text('action_type').notNull(),
  declaredGoal: text('declared_goal'),
  reasoning: text('reasoning'),
  authorizationScope: text('authorization_scope'),
  trigger: text('trigger'),
  systemsTouched: text('systems_touched'),
  inputSummary: text('input_summary'),
  status: text('status'),
  reversible: integer('reversible').default(1),
  riskScore: integer('risk_score').default(0),
  confidence: integer('confidence').default(50),
  recommendationId: text('recommendation_id'),
  recommendationApplied: integer('recommendation_applied').default(0),
  recommendationOverrideReason: text('recommendation_override_reason'),
  outputSummary: text('output_summary'),
  sideEffects: text('side_effects'),
  artifactsCreated: text('artifacts_created'),
  errorMessage: text('error_message'),
  timestampStart: text('timestamp_start'),
  timestampEnd: text('timestamp_end'),
  durationMs: integer('duration_ms'),
  costEstimate: real('cost_estimate').default(0),
  tokensIn: integer('tokens_in').default(0),
  tokensOut: integer('tokens_out').default(0),
  model: text('model'),
  signature: text('signature'),
  verified: boolean('verified').default(false),
  approvedBy: text('approved_by'),
  approvedAt: timestamp('approved_at'),
  // Separation of duties (drizzle/0055): the middleware-attributed principal
  // that created the row (key_<uuid> / operator / trial:<org> / session user).
  // Approvals reject approver === created_by (operator exempt — root
  // credential; single-admin self-host). NULL on legacy/system rows.
  createdBy: text('created_by'),
  // Single-use operator-approval grants (drizzle/0045): stamped by the
  // guard's atomic consume; NULL means the approval is still grantable.
  approvalGrantUsedAt: timestamp('approval_grant_used_at'),
  // Approvals lifecycle hygiene (drizzle/0039): when a pending_approval row
  // stops being approvable. Stamped at creation from the client-declared
  // approval_wait_seconds + retry grace; NULL on legacy rows (lazy sweep
  // treats those as expired 24h after creation).
  approvalExpiresAt: timestamp('approval_expires_at', { withTimezone: true }),
  // Durable execution finality — terminal outcome reported by the agent or
  // inferred by the cron sweep. See docs/architecture/durable-execution-finality.md.
  outcomeStatus: text('outcome_status').default('pending').notNull(),
  outcomeAt: timestamp('outcome_at', { withTimezone: true }),
  outcomeSummary: text('outcome_summary'),
  outcomeError: text('outcome_error'),
  outcomeProgress: jsonb('outcome_progress'),
  idempotencyKey: text('idempotency_key'),
  // Originating agent session (sess_ prefix), stamped by writers that know it.
  // Lets /sessions aggregate per-session action telemetry. See drizzle/0020.
  sessionId: text('session_id'),
  // Originating guard decision (act_gd_ prefix), stamped by writers that know
  // it (?record=true always; POST /api/actions optionally). Joins approval
  // outcomes back to guard_decisions.matched_policies for the policy-tuning
  // proposal loop. See drizzle/0035.
  guardDecisionId: text('guard_decision_id'),
  // Durable closure provenance (v4.2, drizzle/0048). Stamped server-side only:
  // 'outcome' (a normal PATCH/outcome write closed the row), 'stop_autoclose'
  // (a close_if_running PATCH won the close), 'direct' (created already
  // terminal). NULL = pre-v4.2 (no backfill). Makes outcome coverage computable
  // from durable data instead of string-matching the auto-close summary.
  closeSource: text('close_source'),
  // Fleet attribution (v4.3, drizzle/0049). harnessSessionId: the harness
  // session uuid stamped on every record — the fan-out grouping key (NOT
  // sessionId, which is the sess_* DashClaw-session namespace). subagentUuid:
  // the subagent instance uuid on a leaf call, persisted lineage evidence for
  // the read-time fan-out join. Both NULL on pre-v4.3 rows; no backfill.
  harnessSessionId: text('harness_session_id'),
  subagentUuid: text('subagent_uuid'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => ({
  outcomeStatusCheck: check(
    'action_records_outcome_status_check',
    sql`${table.outcomeStatus} IN ('pending', 'completed', 'partial', 'failed', 'lost_confirmation')`,
  ),
  // Codified from scripts/migrate-multi-tenant.mjs (they existed only on
  // live DBs migrated by that script — fresh installs were seq-scanning).
  // Names match the live indexes exactly so drizzle/0027 is a no-op there.
  orgIdIdx: index('idx_action_records_org_id').on(table.orgId),
  orgActionIdIdx: index('idx_action_records_org_action_id').on(table.orgId, table.actionId),
  orgAgentIdIdx: index('idx_action_records_org_agent_id').on(table.orgId, table.agentId),
  orgTsIdx: index('idx_action_records_org_ts').on(table.orgId, table.timestampStart),
  recommendationIdIdx: index('idx_action_records_recommendation_id').on(table.orgId, table.recommendationId),
  // Partial index backing the policy-tuning approval-outcome join (drizzle/0035).
  orgGuardDecisionIdx: index('idx_action_records_org_guard_decision')
    .on(table.orgId, table.guardDecisionId)
    .where(sql`${table.guardDecisionId} IS NOT NULL`),
  // Partial index backing the approvals lazy expiry sweep (drizzle/0039).
  pendingExpiryIdx: index('idx_action_records_pending_expiry')
    .on(table.orgId, table.approvalExpiresAt)
    .where(sql`${table.status} = 'pending_approval'`),
}));

export const openLoops = pgTable('open_loops', {
  id: serial('id').primaryKey(),
  loopId: text('loop_id').notNull(),
  orgId: text('org_id').notNull().references(() => organizations.id),
  actionId: text('action_id').notNull(),
  loopType: text('loop_type').notNull(),
  description: text('description').notNull(),
  status: text('status').default('open'),
  priority: text('priority').default('medium'),
  owner: text('owner'),
  resolution: text('resolution'),
  createdAt: timestamp('created_at').defaultNow(),
  resolvedAt: timestamp('resolved_at'),
});

export const assumptions = pgTable('assumptions', {
  id: serial('id').primaryKey(),
  assumptionId: text('assumption_id').notNull(),
  orgId: text('org_id').notNull().references(() => organizations.id),
  actionId: text('action_id').notNull(),
  assumption: text('assumption').notNull(),
  basis: text('basis'),
  validated: integer('validated').default(0),
  validatedAt: timestamp('validated_at'),
  invalidated: integer('invalidated').default(0),
  invalidatedReason: text('invalidated_reason'),
  invalidatedAt: timestamp('invalidated_at'),
  createdAt: timestamp('created_at').defaultNow(),
});

// --- Workspace & Intelligence Tables ---

export const goals = pgTable('goals', {
  id: serial('id').primaryKey(),
  orgId: text('org_id').notNull().references(() => organizations.id),
  agentId: text('agent_id'),
  title: text('title').notNull(),
  category: text('category'),
  description: text('description'),
  targetDate: text('target_date'),
  progress: integer('progress').default(0),
  status: text('status').default('active'),
  costEstimate: real('cost_estimate').default(0),
  createdAt: timestamp('created_at').defaultNow(),
});

export const milestones = pgTable('milestones', {
  id: serial('id').primaryKey(),
  orgId: text('org_id').notNull().default('org_default').references(() => organizations.id),
  agentId: text('agent_id'),
  goalId: integer('goal_id').references(() => goals.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  status: text('status').default('active'),
  progress: integer('progress').default(0),
  costEstimate: real('cost_estimate').default(0),
  createdAt: timestamp('created_at').defaultNow(),
});

export const decisions = pgTable('decisions', {
  id: serial('id').primaryKey(),
  orgId: text('org_id').notNull().references(() => organizations.id),
  agentId: text('agent_id'),
  decision: text('decision').notNull(),
  context: text('context'),
  reasoning: text('reasoning'),
  outcome: text('outcome').default('pending'),
  confidence: integer('confidence').default(50),
  timestamp: text('timestamp'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const content = pgTable('content', {
  id: serial('id').primaryKey(),
  orgId: text('org_id').notNull().references(() => organizations.id),
  agentId: text('agent_id'),
  title: text('title').notNull(),
  platform: text('platform'),
  status: text('status').default('draft'),
  url: text('url'),
  body: text('body'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const ideas = pgTable('ideas', {
  id: serial('id').primaryKey(),
  orgId: text('org_id').notNull().references(() => organizations.id),
  title: text('title').notNull(),
  description: text('description'),
  category: text('category'),
  score: integer('score').default(50),
  status: text('status').default('pending'),
  source: text('source'),
  capturedAt: text('captured_at'),
});

export const contacts = pgTable('contacts', {
  id: serial('id').primaryKey(),
  orgId: text('org_id').notNull().references(() => organizations.id),
  agentId: text('agent_id'),
  name: text('name').notNull(),
  platform: text('platform'),
  temperature: text('temperature'),
  notes: text('notes'),
  opportunityType: text('opportunity_type'),
  lastContact: text('last_contact'),
  interactionCount: integer('interaction_count').default(0),
  nextFollowup: text('next_followup'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const interactions = pgTable('interactions', {
  id: serial('id').primaryKey(),
  orgId: text('org_id').notNull().references(() => organizations.id),
  agentId: text('agent_id'),
  contactId: integer('contact_id'),
  direction: text('direction'),
  summary: text('summary'),
  notes: text('notes'),
  type: text('type'),
  platform: text('platform'),
  date: text('date'),
  createdAt: timestamp('created_at').defaultNow(),
});

// --- Learning Loop ---

export const learningEpisodes = pgTable('learning_episodes', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull().default('org_default'),
  actionId: text('action_id').notNull(),
  agentId: text('agent_id').notNull(),
  actionType: text('action_type').notNull(),
  status: text('status'),
  outcomeLabel: text('outcome_label').notNull().default('pending'),
  riskScore: integer('risk_score').default(0),
  reversible: integer('reversible').default(1),
  confidence: integer('confidence').default(50),
  durationMs: integer('duration_ms'),
  costEstimate: real('cost_estimate').default(0),
  invalidatedAssumptions: integer('invalidated_assumptions').default(0),
  openLoops: integer('open_loops').default(0),
  recommendationId: text('recommendation_id'),
  recommendationApplied: integer('recommendation_applied').default(0),
  score: integer('score').notNull(),
  scoreBreakdown: text('score_breakdown'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const learningRecommendations = pgTable('learning_recommendations', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull().default('org_default'),
  agentId: text('agent_id').notNull(),
  actionType: text('action_type').notNull(),
  confidence: integer('confidence').notNull().default(50),
  sampleSize: integer('sample_size').notNull().default(0),
  topSampleSize: integer('top_sample_size').notNull().default(0),
  successRate: real('success_rate').notNull().default(0),
  avgScore: real('avg_score').notNull().default(0),
  hints: text('hints').notNull(),
  guidance: text('guidance'),
  active: integer('active').notNull().default(1),
  computedAt: timestamp('computed_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const learningRecommendationEvents = pgTable('learning_recommendation_events', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull().default('org_default'),
  recommendationId: text('recommendation_id'),
  agentId: text('agent_id'),
  actionId: text('action_id'),
  eventType: text('event_type').notNull(),
  eventKey: text('event_key'),
  details: text('details'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const learningVelocity = pgTable('learning_velocity', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull(),
  agentId: text('agent_id').notNull(),
  period: text('period').default('daily'),
  periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
  periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
  episodeCount: integer('episode_count').default(0),
  avgScore: real('avg_score').default(0),
  successRate: real('success_rate').default(0),
  scoreDelta: real('score_delta').default(0),
  velocity: real('velocity').default(0),
  acceleration: real('acceleration').default(0),
  maturityScore: real('maturity_score').default(0),
  maturityLevel: text('maturity_level').default('novice'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (t) => ({
  orgAgentPeriod: uniqueIndex('idx_learning_velocity_org_agent_period').on(t.orgId, t.agentId, t.period),
}));

export const learningCurves = pgTable('learning_curves', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull(),
  agentId: text('agent_id').notNull(),
  actionType: text('action_type').notNull(),
  windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
  windowEnd: timestamp('window_end', { withTimezone: true }).notNull(),
  episodeCount: integer('episode_count').default(0),
  avgScore: real('avg_score').default(0),
  successRate: real('success_rate').default(0),
  avgDurationMs: real('avg_duration_ms').default(0),
  avgCost: real('avg_cost').default(0),
  p25Score: real('p25_score').default(0),
  p75Score: real('p75_score').default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (t) => ({
  orgAgentActionWindow: uniqueIndex('idx_learning_curves_org_agent_action_window').on(t.orgId, t.agentId, t.actionType, t.windowStart),
}));

// --- Health & Monitoring ---

export const healthSnapshots = pgTable('health_snapshots', {
  id: serial('id').primaryKey(),
  orgId: text('org_id').notNull().references(() => organizations.id),
  timestamp: text('timestamp').notNull(),
  healthScore: integer('health_score').default(0),
  totalFiles: integer('total_files').default(0),
  totalLines: integer('total_lines').default(0),
  totalSizeKb: integer('total_size_kb').default(0),
  memoryMdLines: integer('memory_md_lines').default(0),
  oldestDailyFile: text('oldest_daily_file'),
  newestDailyFile: text('newest_daily_file'),
  daysWithNotes: integer('days_with_notes').default(0),
  avgLinesPerDay: real('avg_lines_per_day').default(0),
  potentialDuplicates: integer('potential_duplicates').default(0),
  staleFactsCount: integer('stale_facts_count').default(0),
});

export const entities = pgTable('entities', {
  id: serial('id').primaryKey(),
  orgId: text('org_id').notNull().references(() => organizations.id),
  name: text('name').notNull(),
  type: text('type').default('other'),
  mentionCount: integer('mention_count').default(1),
});

export const topics = pgTable('topics', {
  id: serial('id').primaryKey(),
  orgId: text('org_id').notNull().references(() => organizations.id),
  name: text('name').notNull(),
  mentionCount: integer('mention_count').default(1),
});

// --- Infrastructure & Security ---

export const agentPresence = pgTable('agent_presence', {
  agentId: text('agent_id').primaryKey(),
  orgId: text('org_id').notNull().references(() => organizations.id),
  agentName: text('agent_name'),
  status: text('status').default('online'),
  currentTaskId: text('current_task_id'),
  lastHeartbeatAt: timestamp('last_heartbeat_at').defaultNow(),
  metadata: text('metadata'),
  // drizzle/0041: written by every heartbeat upsert; fresh installs lacked it
  // and silently dropped ALL presence writes (legacy DBs had it out-of-band).
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (t) => ({
  // Backs upsertAgentPresence's ON CONFLICT (org_id, agent_id). Legacy DBs
  // satisfy it via their composite PRIMARY KEY; drizzle/0041 adds this index
  // only where no unique (org_id, agent_id) exists.
  orgAgentUnique: unique('agent_presence_org_agent_unique').on(t.orgId, t.agentId),
}));

export const agentConnections = pgTable('agent_connections', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull().default('org_default'),
  agentId: text('agent_id').notNull(),
  provider: text('provider').notNull(),
  authType: text('auth_type').notNull().default('api_key'),
  planName: text('plan_name'),
  status: text('status').notNull().default('active'),
  metadata: text('metadata'),
  reportedAt: text('reported_at').notNull(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const tokenSnapshots = pgTable('token_snapshots', {
  id: serial('id').primaryKey(),
  orgId: text('org_id').notNull().references(() => organizations.id),
  agentId: text('agent_id'),
  timestamp: text('timestamp').notNull(),
  tokensIn: integer('tokens_in'),
  tokensOut: integer('tokens_out'),
  contextUsed: integer('context_used'),
  contextMax: integer('context_max'),
  contextPct: real('context_pct'),
  hourlyPctLeft: real('hourly_pct_left'),
  weeklyPctLeft: real('weekly_pct_left'),
  compactions: integer('compactions'),
  model: text('model'),
  sessionKey: text('session_key'),
});

export const dailyTotals = pgTable('daily_totals', {
  id: serial('id').primaryKey(),
  orgId: text('org_id').notNull().references(() => organizations.id),
  agentId: text('agent_id'),
  date: text('date').notNull(),
  totalTokensIn: integer('total_tokens_in').default(0),
  totalTokensOut: integer('total_tokens_out').default(0),
  totalTokens: integer('total_tokens').default(0),
  peakContextPct: real('peak_context_pct').default(0),
  snapshotsCount: integer('snapshots_count').default(0),
});

export const tokenBudgets = pgTable('token_budgets', {
  id: text('id').primaryKey().default('gen_random_uuid()'),
  orgId: text('org_id').notNull(),
  agentId: text('agent_id'),
  dailyLimit: integer('daily_limit').notNull().default(18000),
  weeklyLimit: integer('weekly_limit').notNull().default(126000),
  monthlyLimit: integer('monthly_limit').notNull().default(540000),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// --- Messaging & Collaboration ---

export const agentMessages = pgTable('agent_messages', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull().references(() => organizations.id),
  threadId: text('thread_id'),
  fromAgentId: text('from_agent_id').notNull(),
  toAgentId: text('to_agent_id'),
  messageType: text('message_type').notNull().default('info'),
  subject: text('subject'),
  body: text('body').notNull(),
  urgent: boolean('urgent').default(false),
  status: text('status').notNull().default('sent'),
  docRef: text('doc_ref'),
  readBy: text('read_by'),
  createdAt: timestamp('created_at').defaultNow(),
  readAt: timestamp('read_at'),
  archivedAt: timestamp('archived_at'),
  actionId: text('action_id'),
});

export const messageThreads = pgTable('message_threads', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull().references(() => organizations.id),
  name: text('name').notNull(),
  participants: text('participants'),
  status: text('status').notNull().default('open'),
  summary: text('summary'),
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
  resolvedAt: timestamp('resolved_at'),
});

export const sharedDocs = pgTable('shared_docs', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull().references(() => organizations.id),
  name: text('name').notNull(),
  content: text('content').notNull(),
  createdBy: text('created_by').notNull(),
  lastEditedBy: text('last_edited_by'),
  version: integer('version').notNull().default(1),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// --- Policy & Guard ---

// @domain governance
export const guardPolicies = pgTable('guard_policies', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull().references(() => organizations.id),
  name: text('name').notNull(),
  policyType: text('policy_type').notNull(),
  rules: text('rules').notNull(),
  active: integer('active').notNull().default(1),
  agentIds: text('agent_ids'),
  createdBy: text('created_by'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const guardDecisions = pgTable('guard_decisions', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull().references(() => organizations.id),
  agentId: text('agent_id'),
  agentName: text('agent_name'),
  // Phase 2: JWKS verification status.
  // verified       — JWT signature valid, sub used as agent_id
  // unverified     — no JWT or issuer outage (fail-soft); body attribution only
  // expired        — JWT signature valid but exp < now
  // failed         — bad signature, malformed token, or aud mismatch
  // unknown_issuer — iss not in DASHCLAW_ALLOWED_ISSUER (when configured)
  // exp_too_far    — exp > now + DASHCLAW_JTI_MAX_TTL_SECONDS (Phase 2b)
  verificationStatus: text('verification_status').default('unverified'),
  // Phase 2b: jti replay-protection outcome (issue #120, designed by @piiiico).
  // Possible values:
  //   not_applicable | unique | replayed | not_present | unavailable
  //   exp_too_far    | disabled (verified token but DASHCLAW_JTI_REPLAY_PROTECTION=off)
  replayStatus: text('replay_status').default('not_applicable'),
  // Forensic only — logged on every verified call so reviewers can correlate
  // replays across windows. Never read for validation.
  jti: text('jti'),
  // Phase 2c: action-binding outcome (issue #121, designed by @piiiico). Own
  // axis like replay_status — never overloads verification_status. Possible
  // values:
  //   not_applicable | match | mismatch | not_present | unsupported_typ
  //   ctx_incomplete
  actStatus: text('act_status').default('not_applicable'),
  // Forensic only — the claim-side digest the token committed to (the
  // unfakeable half). Null when no binding claim was present.
  actHash: text('act_hash'),
  decision: text('decision').notNull(),
  reason: text('reason'),
  matchedPolicies: text('matched_policies'),
  context: text('context'),
  // Non-fabrication integrity: the signed proof receipt + structured violations
  // for a non_fabrication decision. JSON text, null for every other decision.
  evidence: text('evidence'),
  riskScore: integer('risk_score'),
  actionType: text('action_type'),
  createdAt: timestamp('created_at').defaultNow(),
  // True when the decision was finalized off a degradation path (deadline race
  // today). Detail lives in context._degraded; this column exists so the
  // aggregation queries never string-match reason. See drizzle/0037.
  degraded: boolean('degraded').default(false).notNull(),
});

// Instance-global Ed25519 signing key (issuer of proof receipts + signed
// compliance bundles). Not org-scoped; singleton via a constant id. See
// drizzle/0013_non_fabrication_integrity.sql and app/lib/integrity/server-key.js.
export const serverSigningKeys = pgTable('server_signing_keys', {
  id: text('id').primaryKey(),
  kid: text('kid').notNull(),
  alg: text('alg').notNull().default('EdDSA'),
  privateJwk: text('private_jwk').notNull(),
  publicJwk: text('public_jwk').notNull(),
  active: integer('active').notNull().default(1),
  createdAt: timestamp('created_at').defaultNow(),
});

// Phase 2b: JWT replay log (issue #120). Composite PK reflects RFC 7519 —
// jti uniqueness is per-issuer, not global. expires_at mirrors JWT exp so
// rows become purgeable at the same instant the token does. agent_id is
// forensic-only and never used as a validation key.
export const jwtReplayLog = pgTable('jwt_replay_log', {
  issuer: text('issuer').notNull(),
  jti: text('jti').notNull(),
  expiresAt: bigint('expires_at', { mode: 'number' }).notNull(),
  seenAt: bigint('seen_at', { mode: 'number' }).notNull(),
  agentId: text('agent_id'),
}, (t) => ({
  pk: primaryKey({ columns: [t.issuer, t.jti] }),
  expiresIdx: index('idx_jwt_replay_log_expires').on(t.expiresAt),
}));

// --- Compliance & Audit ---

export const activityLogs = pgTable('activity_logs', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull().references(() => organizations.id),
  actorId: text('actor_id').notNull(),
  actorType: text('actor_type').notNull().default('user'),
  action: text('action').notNull(),
  resourceType: text('resource_type'),
  resourceId: text('resource_id'),
  details: text('details'),
  ipAddress: text('ip_address'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const guardrailsTestRuns = pgTable('guardrails_test_runs', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull().default('org_default'),
  totalPolicies: integer('total_policies').notNull().default(0),
  totalTests: integer('total_tests').notNull().default(0),
  passed: integer('passed').notNull().default(0),
  failed: integer('failed').notNull().default(0),
  success: integer('success').notNull().default(0),
  details: text('details'),
  triggeredBy: text('triggered_by'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const complianceSnapshots = pgTable('compliance_snapshots', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull().default('org_default'),
  framework: text('framework').notNull(),
  totalControls: integer('total_controls').notNull().default(0),
  covered: integer('covered').notNull().default(0),
  partial: integer('partial').notNull().default(0),
  gaps: integer('gaps').notNull().default(0),
  coveragePercentage: integer('coverage_percentage').notNull().default(0),
  riskLevel: text('risk_level'),
  fullReport: text('full_report'),
  createdAt: timestamp('created_at').defaultNow(),
});

// Scheduled and on-demand compliance export records. Codified from
// scripts/migrate-compliance-export.mjs (drizzle/0033) — some deploys already
// created these via that side script, so the DDL stays IF NOT EXISTS.
export const complianceExports = pgTable('compliance_exports', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull(),
  name: text('name').notNull(),
  frameworks: jsonb('frameworks').notNull().default('[]'),
  format: text('format').default('markdown'),
  windowDays: integer('window_days').default(30),
  includeEvidence: boolean('include_evidence').default(true),
  includeRemediation: boolean('include_remediation').default(true),
  includeTrends: boolean('include_trends').default(false),
  status: text('status').default('pending'),
  reportContent: text('report_content').default(''),
  evidenceSummary: jsonb('evidence_summary').default('{}'),
  snapshotIds: jsonb('snapshot_ids').default('[]'),
  fileSizeBytes: integer('file_size_bytes').default(0),
  errorMessage: text('error_message').default(''),
  requestedBy: text('requested_by').default('user'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  orgIdx: index('idx_compliance_exports_org').on(table.orgId),
  statusIdx: index('idx_compliance_exports_status').on(table.orgId, table.status),
  createdIdx: index('idx_compliance_exports_created').on(table.createdAt),
}));

// Recurring export schedules. NOTE: nothing executes these on the free tier
// (no cron) — they are reminders; exports run manually or via "Run now".
export const complianceSchedules = pgTable('compliance_schedules', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull(),
  name: text('name').notNull(),
  frameworks: jsonb('frameworks').notNull().default('[]'),
  format: text('format').default('markdown'),
  windowDays: integer('window_days').default(30),
  cronExpression: text('cron_expression').notNull(),
  includeEvidence: boolean('include_evidence').default(true),
  includeRemediation: boolean('include_remediation').default(true),
  includeTrends: boolean('include_trends').default(false),
  enabled: boolean('enabled').default(true),
  lastRunAt: timestamp('last_run_at', { withTimezone: true }),
  nextRunAt: timestamp('next_run_at', { withTimezone: true }),
  lastExportId: text('last_export_id').default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  orgIdx: index('idx_compliance_schedules_org').on(table.orgId),
  enabledIdx: index('idx_compliance_schedules_enabled').on(table.orgId, table.enabled),
}));

// --- Routing Engine ---

export const routingAgents = pgTable('routing_agents', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull().default('org_default'),
  name: text('name').notNull(),
  capabilities: text('capabilities'),
  maxConcurrent: integer('max_concurrent').notNull().default(3),
  currentLoad: integer('current_load').notNull().default(0),
  status: text('status').notNull().default('available'),
  endpoint: text('endpoint'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const routingTasks = pgTable('routing_tasks', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull().default('org_default'),
  title: text('title').notNull(),
  description: text('description'),
  requiredSkills: text('required_skills'),
  urgency: text('urgency').notNull().default('normal'),
  assignedTo: text('assigned_to'),
  status: text('status').notNull().default('pending'),
  result: text('result'),
  timeoutSeconds: integer('timeout_seconds').notNull().default(3600),
  maxRetries: integer('max_retries').notNull().default(2),
  retryCount: integer('retry_count').notNull().default(0),
  callbackUrl: text('callback_url'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const routingAgentMetrics = pgTable('routing_agent_metrics', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull().default('org_default'),
  agentId: text('agent_id').notNull(),
  skill: text('skill').notNull(),
  tasksCompleted: integer('tasks_completed').notNull().default(0),
  tasksFailed: integer('tasks_failed').notNull().default(0),
  avgDurationMs: integer('avg_duration_ms'),
  lastCompletedAt: timestamp('last_completed_at'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const routingDecisions = pgTable('routing_decisions', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull().default('org_default'),
  taskId: text('task_id').notNull(),
  candidates: text('candidates'),
  selectedAgentId: text('selected_agent_id'),
  selectedScore: real('selected_score'),
  reason: text('reason'),
  createdAt: timestamp('created_at').defaultNow(),
});

// --- Drift Engine ---

export const driftBaselines = pgTable('drift_baselines', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull(),
  agentId: text('agent_id').notNull(),
  metric: text('metric').notNull(),
  dimension: text('dimension').default('overall'),
  periodStart: timestamp('period_start').notNull(),
  periodEnd: timestamp('period_end').notNull(),
  sampleCount: integer('sample_count').default(0),
  mean: real('mean').default(0),
  stddev: real('stddev').default(0),
  median: real('median').default(0),
  p5: real('p5').default(0),
  p25: real('p25').default(0),
  p75: real('p75').default(0),
  p95: real('p95').default(0),
  minVal: real('min_val').default(0),
  maxVal: real('max_val').default(0),
  distribution: jsonb('distribution').default({}),
  createdAt: timestamp('created_at').defaultNow(),
});

export const driftAlerts = pgTable('drift_alerts', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull(),
  agentId: text('agent_id').notNull(),
  metric: text('metric').notNull(),
  dimension: text('dimension').default('overall'),
  severity: text('severity').default('info'),
  driftType: text('drift_type').default('shift'),
  baselineMean: real('baseline_mean').default(0),
  baselineStddev: real('baseline_stddev').default(0),
  currentMean: real('current_mean').default(0),
  currentStddev: real('current_stddev').default(0),
  zScore: real('z_score').default(0),
  pctChange: real('pct_change').default(0),
  sampleCount: integer('sample_count').default(0),
  direction: text('direction').default('unknown'),
  description: text('description').default(''),
  acknowledged: boolean('acknowledged').default(false),
  acknowledgedBy: text('acknowledged_by').default(''),
  acknowledgedAt: timestamp('acknowledged_at'),
  baselineId: text('baseline_id').default(''),
  createdAt: timestamp('created_at').defaultNow(),
});

export const driftSnapshots = pgTable('drift_snapshots', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull(),
  agentId: text('agent_id').default(''),
  metric: text('metric').notNull(),
  dimension: text('dimension').default('overall'),
  period: text('period').default('daily'),
  periodStart: timestamp('period_start').notNull(),
  mean: real('mean').default(0),
  stddev: real('stddev').default(0),
  sampleCount: integer('sample_count').default(0),
  createdAt: timestamp('created_at').defaultNow(),
});

// --- Miscellaneous Tables ---

export const contextPoints = pgTable('context_points', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull().default('org_default'),
  agentId: text('agent_id'),
  content: text('content').notNull(),
  category: text('category').default('general'),
  importance: integer('importance').default(5),
  sessionDate: text('session_date').notNull(),
  compressed: integer('compressed').default(0),
  createdAt: timestamp('created_at').defaultNow(),
});

export const contextEntries = pgTable('context_entries', {
  id: text('id').primaryKey(),
  threadId: text('thread_id').notNull(),
  orgId: text('org_id').notNull().default('org_default'),
  content: text('content').notNull(),
  entryType: text('entry_type').default('note'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const calendarEvents = pgTable('calendar_events', {
  id: serial('id').primaryKey(),
  orgId: text('org_id').notNull().default('org_default'),
  summary: text('summary').notNull(),
  startTime: timestamp('start_time', { withTimezone: true }).notNull(),
  endTime: timestamp('end_time', { withTimezone: true }),
  location: text('location'),
  description: text('description'),
});

export const waitlist = pgTable('waitlist', {
  id: serial('id').primaryKey(),
  email: text('email').notNull().unique(),
  signedUpAt: timestamp('signed_up_at').defaultNow(),
  signupCount: integer('signup_count').default(1),
  source: text('source').default('landing_page'),
  notes: text('notes'),
});

export const actionEmbeddings = pgTable('action_embeddings', {
  id: serial('id').primaryKey(),
  orgId: text('org_id').notNull().references(() => organizations.id),
  agentId: text('agent_id').notNull(),
  actionId: text('action_id').notNull(),
  embedding: vector('embedding'),
});

export const webhooks = pgTable('webhooks', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull().default('org_default'),
  url: text('url').notNull(),
  secret: text('secret').notNull(),
  events: text('events').notNull().default('[\"all\"]'),
  active: integer('active').notNull().default(1),
  createdBy: text('created_by'),
  failureCount: integer('failure_count').notNull().default(0),
  // TEXT, not timestamp: the live column was created as text in 0000 and every
  // runtime read/write uses ISO strings on `last_triggered_at`. The phantom
  // `last_trigger_at` duplicate (mis-codified by 0028) is dropped in 0030.
  lastTriggeredAt: text('last_triggered_at'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const webhookDeliveries = pgTable('webhook_deliveries', {
  id: text('id').primaryKey(),
  webhookId: text('webhook_id').notNull(),
  orgId: text('org_id').notNull().default('org_default'),
  eventType: text('event_type').notNull(),
  payload: text('payload'),
  status: text('status').notNull().default('pending'),
  responseStatus: integer('response_status'),
  responseBody: text('response_body'),
  attemptedAt: text('attempted_at').default(sql`now()`).notNull(),
  durationMs: integer('duration_ms'),
});

export const usageMeters = pgTable('usage_meters', {
  id: serial('id').primaryKey(),
  orgId: text('org_id').notNull().default('org_default'),
  period: text('period').notNull(),
  resource: text('resource').notNull(),
  count: integer('count').notNull().default(0),
  lastReconciledAt: timestamp('last_reconciled_at'),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const snippets = pgTable('snippets', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull().default('org_default'),
  agentId: text('agent_id'),
  name: text('name').notNull(),
  description: text('description'),
  code: text('code').notNull(),
  language: text('language'),
  tags: text('tags'),
  useCount: integer('use_count').default(0),
  createdAt: timestamp('created_at').defaultNow(),
  lastUsed: timestamp('last_used'),
});

export const promptTemplates = pgTable('prompt_templates', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull(),
  name: text('name').notNull(),
  description: text('description').default(''),
  category: text('category').default('general'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const promptVersions = pgTable('prompt_versions', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull(),
  templateId: text('template_id').notNull().references(() => promptTemplates.id, { onDelete: 'cascade' }),
  version: integer('version').notNull().default(1),
  content: text('content').notNull(),
  modelHint: text('model_hint').default(''),
  parameters: jsonb('parameters').default([]),
  changelog: text('changelog').default(''),
  isActive: boolean('is_active').default(false),
  createdBy: text('created_by').default('system'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const promptRuns = pgTable('prompt_runs', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull(),
  templateId: text('template_id').notNull().references(() => promptTemplates.id, { onDelete: 'cascade' }),
  versionId: text('version_id').notNull().references(() => promptVersions.id, { onDelete: 'cascade' }),
  actionId: text('action_id').default(''),
  agentId: text('agent_id').default(''),
  inputVars: jsonb('input_vars').default({}),
  rendered: text('rendered').default(''),
  tokensUsed: integer('tokens_used').default(0),
  latencyMs: integer('latency_ms').default(0),
  outcome: text('outcome').default(''),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const feedback = pgTable('feedback', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull(),
  actionId: text('action_id'),
  agentId: text('agent_id'),
  source: text('source').default('user'),
  rating: integer('rating'),
  sentiment: text('sentiment').default('neutral'),
  category: text('category').default('general'),
  comment: text('comment'),
  tags: jsonb('tags').default([]),
  metadata: jsonb('metadata').default({}),
  resolved: boolean('resolved').default(false),
  resolvedBy: text('resolved_by'),
  resolvedAt: timestamp('resolved_at'),
  createdBy: text('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const userObservations = pgTable('user_observations', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull().default('org_default'),
  userId: text('user_id'),
  agentId: text('agent_id'),
  observation: text('observation').notNull(),
  category: text('category'),
  importance: integer('importance').default(5),
  createdAt: timestamp('created_at').defaultNow(),
});

export const userPreferences = pgTable('user_preferences', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull().default('org_default'),
  userId: text('user_id'),
  agentId: text('agent_id'),
  preference: text('preference').notNull(),
  category: text('category'),
  confidence: integer('confidence').default(50),
  lastValidated: timestamp('last_validated'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const userMoods = pgTable('user_moods', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull().default('org_default'),
  userId: text('user_id'),
  agentId: text('agent_id'),
  mood: text('mood').notNull(),
  energy: text('energy'),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const userApproaches = pgTable('user_approaches', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull().default('org_default'),
  userId: text('user_id'),
  agentId: text('agent_id'),
  approach: text('approach').notNull(),
  context: text('context'),
  successCount: integer('success_count').default(0),
  failCount: integer('fail_count').default(0),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const notificationPreferences = pgTable('notification_preferences', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull(),
  userId: text('user_id').notNull(),
  channel: text('channel').default('email'),
  enabled: integer('enabled').default(1),
  signalTypes: text('signal_types').default('["all"]'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  uniqueUserChannel: uniqueIndex('notification_preferences_org_user_channel_unique').on(table.orgId, table.userId, table.channel),
}));

export const workflows = pgTable('workflows', {
  id: serial('id').primaryKey(),
  orgId: text('org_id').notNull(),
  agentId: text('agent_id'),
  name: text('name').notNull(),
  description: text('description'),
  enabled: integer('enabled').default(1),
  triggerType: text('trigger_type'),
  runCount: integer('run_count').default(0),
  lastRun: timestamp('last_run', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  uniqueName: uniqueIndex('workflows_org_name_unique').on(table.orgId, table.name),
}));

export const executions = pgTable('executions', {
  id: serial('id').primaryKey(),
  orgId: text('org_id').notNull(),
  agentId: text('agent_id'),
  workflowId: integer('workflow_id').references(() => workflows.id),
  status: text('status').default('pending'),
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  error: text('error'),
});

export const scheduledJobs = pgTable('scheduled_jobs', {
  id: serial('id').primaryKey(),
  orgId: text('org_id').notNull(),
  workflowId: integer('workflow_id').references(() => workflows.id),
  name: text('name'),
  cronExpression: text('cron_expression'),
  enabled: integer('enabled').default(1),
  nextRun: timestamp('next_run', { withTimezone: true }),
  lastRun: timestamp('last_run', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// eval_scorers — reusable scorer definitions. Historically created only by the
// standalone scripts/migrate-evaluations.mjs, so it was missing from the drizzle
// chain (and from here); see drizzle/0025. Columns/types mirror that script.
export const evalScorers = pgTable('eval_scorers', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull(),
  name: text('name').notNull(),
  scorerType: text('scorer_type').notNull(),
  config: text('config'),
  description: text('description'),
  createdBy: text('created_by'),
  createdAt: text('created_at'),
  updatedAt: text('updated_at'),
}, (table) => ({
  orgNameUnique: uniqueIndex('idx_eval_scorers_org_name').on(table.orgId, table.name),
}));

export const evalScores = pgTable('eval_scores', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull(),
  actionId: text('action_id').notNull(),
  // scorer_id + run_id — scorer_id was already being written by
  // executeEvalRun but was absent from schema; run_id is new, introduced
  // by F51 so the per-run distribution query can filter against the
  // originating run instead of aggregating every row for the same scorer.
  scorerId: text('scorer_id'),
  runId: text('run_id'),
  scorerName: text('scorer_name').notNull(),
  score: real('score').notNull(),
  label: text('label'),
  reasoning: text('reasoning'),
  evaluatedBy: text('evaluated_by'),
  metadata: text('metadata'),
  createdAt: timestamp('created_at').defaultNow(),
});

export const agentSchedules = pgTable('agent_schedules', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull(),
  agentId: text('agent_id').notNull(),
  name: text('name').notNull(),
  cronExpression: text('cron_expression').notNull(),
  description: text('description'),
  active: boolean('active').default(true),
  lastRun: timestamp('last_run', { withTimezone: true }),
  nextRun: timestamp('next_run', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const evalRuns = pgTable('eval_runs', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull(),
  name: text('name').notNull(),
  scorerId: text('scorer_id'),
  status: text('status').default('pending'),
  totalActions: integer('total_actions'),
  scoredCount: integer('scored_count').default(0),
  avgScore: real('avg_score'),
  summary: text('summary'),
  errorMessage: text('error_message'),
  filterCriteria: text('filter_criteria'),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
  createdBy: text('created_by'),
  createdAt: timestamp('created_at').defaultNow(),
});

// --- Scoring Profiles ---

export const scoringProfiles = pgTable('scoring_profiles', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull(),
  name: text('name').notNull(),
  description: text('description').default(''),
  actionType: text('action_type'),
  status: text('status').default('active'),
  compositeMethod: text('composite_method').default('weighted_average'),
  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const scoringDimensions = pgTable('scoring_dimensions', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull(),
  profileId: text('profile_id').notNull().references(() => scoringProfiles.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description').default(''),
  weight: real('weight').notNull().default(1.0),
  dataSource: text('data_source').notNull(),
  dataConfig: jsonb('data_config').default({}),
  scale: jsonb('scale').notNull().default([]),
  sortOrder: integer('sort_order').default(0),
  createdAt: timestamp('created_at').defaultNow(),
});

export const profileScores = pgTable('profile_scores', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull(),
  profileId: text('profile_id').notNull().references(() => scoringProfiles.id, { onDelete: 'cascade' }),
  actionId: text('action_id'),
  agentId: text('agent_id'),
  compositeScore: real('composite_score').notNull(),
  dimensionScores: jsonb('dimension_scores').notNull().default([]),
  metadata: jsonb('metadata').default({}),
  scoredAt: timestamp('scored_at').defaultNow(),
});

export const riskTemplates = pgTable('risk_templates', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull(),
  name: text('name').notNull(),
  description: text('description').default(''),
  actionType: text('action_type'),
  baseRisk: integer('base_risk').notNull().default(0),
  rules: jsonb('rules').notNull().default([]),
  status: text('status').default('active'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const agentPairings = pgTable('agent_pairings', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull().references(() => organizations.id),
  agentId: text('agent_id').notNull(),
  agentName: text('agent_name'),
  publicKey: text('public_key').notNull(),
  algorithm: text('algorithm').default('RSASSA-PKCS1-v1_5'),
  status: text('status').default('pending'),
  permissionLevel: text('permission_level').default('danger'),
  expiresAt: timestamp('expires_at'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const agentIdentities = pgTable('agent_identities', {
  orgId: text('org_id').notNull().references(() => organizations.id),
  agentId: text('agent_id').notNull(),
  publicKey: text('public_key').notNull(),
  algorithm: text('algorithm').default('RSASSA-PKCS1-v1_5'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => ({
  pk: uniqueIndex('agent_identities_org_agent_unique').on(table.orgId, table.agentId),
}));

// --- Agent Sessions ---
export const agentSessions = pgTable('agent_sessions', {
  id: text('id').primaryKey(),
  org_id: text('org_id').notNull(),
  agent_id: text('agent_id').notNull(),
  workspace: text('workspace'),
  branch: text('branch'),
  status: text('status').notNull().default('running'),
  status_since: timestamp('status_since', { withTimezone: true }).defaultNow(),
  blocked_reason: text('blocked_reason'),
  green_level: text('green_level'),
  branch_freshness: text('branch_freshness'),
  commits_behind: integer('commits_behind'),
  last_activity: timestamp('last_activity', { withTimezone: true }).defaultNow(),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

export const sessionEvents = pgTable('session_events', {
  id: serial('id').primaryKey(),
  session_id: text('session_id').notNull(),
  org_id: text('org_id').notNull(),
  seq: integer('seq').notNull(),
  kind: text('kind').notNull(),
  detail: text('detail'),
  created_at: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// --- Code Sessions (AgentLens absorption — Phase 2) ---
// Distinct from agent_sessions (live agent state) and session_events
// (event log on agent_sessions). These tables hold ingested Claude Code
// JSONL transcripts: live (source='hook', via the Stop hook reporter in
// Phase 3) or retroactive (source='jsonl', via the local CLI in Phase 4).
// Both paths use the same POST /api/code-sessions/ingest-jsonl endpoint.

export const codeProjects = pgTable('code_projects', {
  id: text('id').primaryKey(), // cp_ prefix
  orgId: text('org_id').notNull().references(() => organizations.id),
  slug: text('slug').notNull(),
  cwd: text('cwd'),
  sourceHost: text('source_host'), // 'hook' or 'jsonl' — whichever first created it
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  orgSlugUnique: uniqueIndex('code_projects_org_slug_unique').on(table.orgId, table.slug),
}));

export const codeSessions = pgTable('code_sessions', {
  id: text('id').primaryKey(), // cs_ prefix
  orgId: text('org_id').notNull().references(() => organizations.id),
  projectId: text('project_id').notNull().references(() => codeProjects.id),
  sessionUuid: text('session_uuid').notNull(), // Claude Code session ID from JSONL
  source: text('source').notNull(), // 'hook' | 'jsonl'
  sourceFile: text('source_file'),
  sourceMtime: text('source_mtime'),
  startedAt: text('started_at'),
  endedAt: text('ended_at'),
  messageCount: integer('message_count').notNull().default(0),
  modelPrimary: text('model_primary'),
  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
  cacheCreationTokens: integer('cache_creation_tokens').notNull().default(0),
  costUsd: numeric('cost_usd').notNull().default('0'),
  cacheSavingsUsd: numeric('cache_savings_usd').notNull().default('0'),
  stuckLoops: integer('stuck_loops').notNull().default(0),
  modelRequests: integer('model_requests').notNull().default(0),
  jsonlRecords: integer('jsonl_records').notNull().default(0),
  duplicateFragmentsSkipped: integer('duplicate_fragments_skipped').notNull().default(0),
  naiveInputTokens: integer('naive_input_tokens').notNull().default(0),
  naiveOutputTokens: integer('naive_output_tokens').notNull().default(0),
  naiveCacheReadTokens: integer('naive_cache_read_tokens').notNull().default(0),
  naiveCacheCreationTokens: integer('naive_cache_creation_tokens').notNull().default(0),
  naiveCostUsd: numeric('naive_cost_usd').notNull().default('0'),
  parserVersion: integer('parser_version').notNull().default(2),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  orgUuidUnique: uniqueIndex('code_sessions_org_uuid_unique').on(table.orgId, table.sessionUuid),
  sourceCheck: check('code_sessions_source_check', sql`${table.source} IN ('hook', 'jsonl')`),
}));

export const codeSessionMessages = pgTable('code_session_messages', {
  id: serial('id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => codeSessions.id, { onDelete: 'cascade' }),
  uuid: text('uuid'),
  role: text('role'),
  model: text('model'),
  timestamp: text('timestamp'),
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  cacheReadTokens: integer('cache_read_tokens'),
  cacheCreationTokens: integer('cache_creation_tokens'),
  costUsd: numeric('cost_usd'),
  textPreview: text('text_preview'),
  requestId: text('request_id'),
  messageId: text('message_id'),
});

export const codeSessionToolUses = pgTable('code_session_tool_uses', {
  id: serial('id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => codeSessions.id, { onDelete: 'cascade' }),
  messageId: integer('message_id').references(() => codeSessionMessages.id, { onDelete: 'set null' }),
  actionId: text('action_id').references(() => actionRecords.actionId, { onDelete: 'set null' }),
  name: text('name').notNull(),
  target: text('target'),
  timestamp: text('timestamp'),
  durationMs: integer('duration_ms'),
  toolUseId: text('tool_use_id'),
  requestId: text('request_id'),
  sourceLine: integer('source_line'),
});

export const codeSessionSignals = pgTable('code_session_signals', {
  id: serial('id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => codeSessions.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(), // optimizer rule id (e.g. MODEL_DOWNSHIFT) or 'repeated_run'
  confidence: text('confidence'),
  savingsUsd: numeric('savings_usd'),
  payload: jsonb('payload'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const codeSessionAlerts = pgTable('code_session_alerts', {
  id: serial('id').primaryKey(),
  orgId: text('org_id').notNull().references(() => organizations.id),
  projectId: text('project_id').references(() => codeProjects.id, { onDelete: 'cascade' }),
  sessionId: text('session_id').references(() => codeSessions.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(), // cost_anomaly | cache_crater | stuck_loop_streak | multi_project_usage
  severity: text('severity').notNull().default('info'),
  scope: text('scope').notNull().default('session'),
  title: text('title').notNull(),
  body: text('body'),
  readAt: timestamp('read_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});
// Note: the NULL-safe dedup unique index code_session_alerts_dedup is
// declared manually in the migration SQL because drizzle-kit doesn't emit
// COALESCE expressions for partial unique indexes.

export const codeSessionMemos = pgTable('code_session_memos', {
  id: serial('id').primaryKey(),
  orgId: text('org_id').notNull().references(() => organizations.id),
  projectId: text('project_id').notNull().references(() => codeProjects.id, { onDelete: 'cascade' }),
  isoWeekTag: text('iso_week_tag').notNull(),
  bodyMd: text('body_md'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  orgProjectWeekUnique: uniqueIndex('code_session_memos_org_project_week_unique')
    .on(table.orgId, table.projectId, table.isoWeekTag),
}));

export const codeOptimalFileManifests = pgTable('code_optimal_file_manifests', {
  id: text('id').primaryKey(), // cofm_ prefix
  orgId: text('org_id').notNull().references(() => organizations.id),
  sessionId: text('session_id').notNull().references(() => codeSessions.id, { onDelete: 'cascade' }),
  projectCwd: text('project_cwd').notNull(),
  plan: jsonb('plan').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

// @domain governance
export const codeSessionHandoffs = pgTable('code_session_handoffs', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  agentId: text('agent_id').notNull(),
  projectId: text('project_id').references(() => codeProjects.id, { onDelete: 'set null' }),
  createdInSessionId: text('created_in_session_id'),
  bundleJson: jsonb('bundle_json').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  consumedBySessionId: text('consumed_by_session_id'),
});

// @domain governance
export const governedSecrets = pgTable('governed_secrets', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  agentId: text('agent_id'),
  name: text('name').notNull(),
  lastRotatedAt: timestamp('last_rotated_at', { withTimezone: true }).notNull().defaultNow(),
  rotationIntervalDays: integer('rotation_interval_days').notNull().default(90),
  notes: text('notes'),
  // Managed secrets: optional encrypted value (AES-256-GCM via app/lib/encryption.ts,
  // AAD-bound to `${orgId}:${id}`). WRITE-ONLY — no API path ever returns the
  // plaintext to a browser or admin; values are delivered only to API-key
  // principals via GET /api/secrets/env when delivery_enabled = 1.
  valueEncrypted: text('value_encrypted'),
  valueAlgo: text('value_algo'),
  valueSetAt: timestamp('value_set_at', { withTimezone: true }),
  deliveryEnabled: integer('delivery_enabled').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  // NULLS NOT DISTINCT closes the gap for org-wide secrets (agent_id IS NULL):
  // Postgres 15+ treats NULLs as equal here so we get one row per (org, name)
  // even when agent_id is NULL. Migration SQL emits this as an inline
  // CONSTRAINT ... UNIQUE NULLS NOT DISTINCT (...).
  uniqueName: unique('governed_secrets_unique_per_agent').on(table.orgId, table.agentId, table.name).nullsNotDistinct(),
}));

// @domain governance
export const skillScanResults = pgTable('skill_scan_results', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  skillName: text('skill_name').notNull(),
  targetHash: text('target_hash').notNull(),
  findings: jsonb('findings').notNull(),
  passed: boolean('passed').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  dedupe: unique('skill_scan_results_dedupe').on(table.orgId, table.skillName, table.targetHash),
}));

// @domain governance
// Governance posture: per-finding resolution state so a resolved / snoozed /
// risk-accepted finding stops re-surfacing in the remediation queue. Keyed by
// the deterministic posture finding_key (stable across scans). A `drafted`
// status records that an INACTIVE policy draft exists for the finding — it does
// NOT count as covered, so the score is unaffected until a human activates it.
export const postureFindingsState = pgTable('posture_findings_state', {
  orgId: text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  findingKey: text('finding_key').notNull(),
  status: text('status').notNull(),
  note: text('note'),
  actor: text('actor'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.orgId, t.findingKey] }),
}));

// @domain governance
// Governance posture: trend snapshots written on explicit `scan`. `score` is
// NUMERIC (the Neon HTTP driver returns it as a string — coerce with Number()
// on read). `dimensions` holds the six-dimension breakdown at snapshot time.
export const postureSnapshots = pgTable('posture_snapshots', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  score: numeric('score').notNull(),
  dimensions: jsonb('dimensions').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orgCreatedIdx: index('idx_posture_snapshots_org_created').on(t.orgId, t.createdAt),
}));

// @domain governance
// v3.4 live-host canary: verdicts reported by the scheduled external probe
// (scripts/live-canary.mjs via the live-canary GitHub Actions cron). Structurally
// isolated from action_records/guard_decisions so synthetic probe traffic can
// never reach posture or calibration mining. `checks` holds the probe results:
// [{id, title, status, detail?, durationMs?, target?}].
export const liveCanaryRuns = pgTable('live_canary_runs', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  source: text('source').notNull().default('github-actions'),
  status: text('status').notNull(),
  checks: jsonb('checks').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
  finishedAt: timestamp('finished_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orgCreatedIdx: index('idx_live_canary_runs_org_created').on(t.orgId, t.createdAt),
}));

// @domain governance
// v4.2 coverage truth (drizzle/0048, docs/superpowers/specs/2026-07-04-coverage-truth.md).
// The Stop hook's per-turn expected-vs-recorded evidence: expected = governed
// tool_use blocks in the turn's transcript slice, recorded = those with an
// action_id in the session tool map. Append-only, org-scoped, one row per turn.
// Transcript ground truth is independent of whether Pre/PostToolUse fired, so a
// PreToolUse outage lowers a number the server can see (record coverage) instead
// of thinning the ledger silently. All access via coverage.repository.ts.
export const coverageReports = pgTable('coverage_reports', {
  id: text('id').primaryKey(), // cov_ prefix
  orgId: text('org_id').notNull(),
  agentId: text('agent_id').notNull(),
  harness: text('harness'),
  harnessSessionId: text('harness_session_id'),
  expected: integer('expected').notNull(),
  recorded: integer('recorded').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orgCreatedIdx: index('idx_coverage_reports_org_created').on(t.orgId, t.createdAt),
  orgAgentIdx: index('idx_coverage_reports_org_agent').on(t.orgId, t.agentId),
}));

// @domain governance
// Behavior Learning: opt-in ANONYMIZED behavior samples uploaded by the local
// recorder (BEHAVIOR_UPLOAD_ENABLED, default off). Paths arrive as salted
// hashes (never raw), protected-path classification arrives pre-computed in
// write_path_groups. One row per (org, event_id); a finalized record supersedes
// a "running" one (mirrors sample-store pickFinalSample). Pruned
// opportunistically on ingest (60 days / newest 20000 per org — no cron on the
// free tier).
export const behaviorSamples = pgTable('behavior_samples', {
  id: serial('id').primaryKey(),
  orgId: text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  eventId: text('event_id').notNull(),
  ts: timestamp('ts', { withTimezone: true }).notNull(),
  agentId: text('agent_id').notNull(),
  sessionHash: text('session_hash'),
  source: text('source'),
  tool: text('tool'),
  toolCategory: text('tool_category'),
  actionType: text('action_type'),
  commandShape: text('command_shape'),
  bashIntent: text('bash_intent'),
  riskScore: integer('risk_score'),
  guardDecision: text('guard_decision'),
  reversible: integer('reversible'),
  model: text('model'),
  readPathHashes: jsonb('read_path_hashes'),
  writePathHashes: jsonb('write_path_hashes'),
  writePathGroups: jsonb('write_path_groups'),
  sensitivePath: integer('sensitive_path'),
  outcomeStatus: text('outcome_status'),
  errorType: text('error_type'),
  durationMs: integer('duration_ms'),
  matchedPolicyCount: integer('matched_policy_count'),
  finalized: integer('finalized').default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (t) => ({
  orgEventUnique: unique('behavior_samples_org_event_unique').on(t.orgId, t.eventId),
  orgAgentTsIdx: index('idx_behavior_samples_org_agent_ts').on(t.orgId, t.agentId, t.ts.desc()),
}));

// @domain governance
// Behavior Learning: server-side twin of the local .dismissals.json so
// dismiss/adopt suppression works for uploaded samples on hosted instances.
// One row per (org, signature); last write wins.
export const behaviorDismissals = pgTable('behavior_dismissals', {
  id: serial('id').primaryKey(),
  orgId: text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  signature: text('signature').notNull(),
  agentId: text('agent_id'),
  type: text('type'),
  target: text('target'),
  reason: text('reason'),
  status: text('status'),
  suppressSimilar: integer('suppress_similar').default(0),
  // Set only on status='adopted' rows (drizzle/0050): points at the guard_policies
  // draft the adoption created, so undo can echo policy_kept and keep the draft.
  // NULL on dismissed / accepted_advisory rows.
  policyId: text('policy_id'),
  ts: timestamp('ts', { withTimezone: true }).defaultNow(),
}, (t) => ({
  orgSignatureUnique: unique('behavior_dismissals_org_signature_unique').on(t.orgId, t.signature),
}));

// @domain governance
// Approval notification registry: one row per external-channel message sent for
// a pending_approval action. On resolution (via any channel/surface) the
// fan-out edits/clears the message in every other channel and stamps
// `clearedAt`. Ephemeral operational data; cascades with the org.
export const approvalNotifications = pgTable('approval_notifications', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  actionId: text('action_id').notNull(),
  channel: text('channel').notNull(),
  messageId: text('message_id').notNull(),
  channelRef: text('channel_ref'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  clearedAt: timestamp('cleared_at', { withTimezone: true }),
}, (t) => ({
  actionIdx: index('idx_approval_notifications_action').on(t.orgId, t.actionId),
}));

// --- Work Orders (task-grade contracts + receipts ledger) ---

export const workOrderTypes = pgTable('work_order_types', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull(),
  type: text('type').notNull(),
  version: text('version').notNull().default('1.0'),
  displayName: text('display_name'),
  description: text('description'),
  inputSchema: jsonb('input_schema').notNull().default({}),
  outputSchema: jsonb('output_schema').notNull().default({}),
  defaultMaxCostUsd: numeric('default_max_cost_usd'),
  defaultTimeoutSeconds: integer('default_timeout_seconds').notNull().default(600),
  status: text('status').notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  uniqueOrgType: uniqueIndex('work_order_types_org_type_unique').on(table.orgId, table.type),
}));

export const workOrders = pgTable('work_orders', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull(),
  type: text('type').notNull(),
  typeVersion: text('type_version').notNull().default('1.0'),
  input: jsonb('input').notNull().default({}),
  inputHash: text('input_hash'),
  maxCostUsd: numeric('max_cost_usd').notNull(),
  timeoutSeconds: integer('timeout_seconds').notNull().default(600),
  status: text('status').notNull().default('queued'),
  requestedBy: text('requested_by'),
  claimedBy: text('claimed_by'),
  leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
  guardDecision: jsonb('guard_decision').default({}),
  approvalActionId: text('approval_action_id'),
  errorCode: text('error_code'),
  errorDetails: text('error_details'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  claimedAt: timestamp('claimed_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  orgStatusIdx: index('work_orders_org_status_idx').on(table.orgId, table.status),
  orgTypeIdx: index('work_orders_org_type_idx').on(table.orgId, table.type),
}));

export const workOrderReceipts = pgTable('work_order_receipts', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull(),
  workOrderId: text('work_order_id').notNull(),
  receipt: jsonb('receipt').notNull().default({}),
  receiptHash: text('receipt_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  uniqueWorkOrder: uniqueIndex('work_order_receipts_work_order_unique').on(table.workOrderId),
}));

// @domain governance
// Calibration proposals human surface (roadmap v2.6b): the human's
// ratify/dismiss judgment on a mined calibration proposal. Proposals are
// computed on read from the ledger (app/lib/calibration-mining.js); only the
// decision persists, keyed by the miner's content-stable cv_ id so it still
// binds when the same shape recurs in a later window. forged_at/vector_name
// close the loop after the maintainer commits the fixture vector.
export const calibrationProposalDecisions = pgTable('calibration_proposal_decisions', {
  id: serial('id').primaryKey(),
  orgId: text('org_id').notNull(),
  proposalId: text('proposal_id').notNull(),
  rule: text('rule').notNull(),
  decision: text('decision').notNull(), // 'ratified' | 'dismissed'
  suggestedLabel: text('suggested_label'),
  suggestedName: text('suggested_name'),
  provenance: text('provenance'),
  ratifyCommand: text('ratify_command'),
  representative: jsonb('representative'),
  reason: text('reason'),
  decidedBy: text('decided_by'),
  decidedAt: timestamp('decided_at', { withTimezone: true }).notNull().defaultNow(),
  forgedAt: timestamp('forged_at', { withTimezone: true }),
  vectorName: text('vector_name'),
}, (t) => ({
  orgProposalUnique: unique('calibration_proposal_decisions_org_proposal_unique').on(t.orgId, t.proposalId),
  orgDecisionIdx: index('idx_calibration_decisions_org_decision').on(t.orgId, t.decision),
}));

// @domain governance
// Tightening proposals (roadmap v3.2): the human's ratify/dismiss judgment on
// a posture-derived proposal to govern an ungoverned high-risk action pattern.
// Proposals are computed on read from guard_decisions (app/lib/posture/
// tightening.ts); only the decision persists, keyed by the engine's
// content-stable tp_ id so a dismissed pattern stops re-proposing. policy_id
// records the guard policy a ratify created — ratify closes its own loop.
export const tighteningProposalDecisions = pgTable('tightening_proposal_decisions', {
  id: serial('id').primaryKey(),
  orgId: text('org_id').notNull(),
  proposalId: text('proposal_id').notNull(),
  rule: text('rule').notNull(),
  decision: text('decision').notNull(), // 'ratified' | 'dismissed'
  actionType: text('action_type'),
  riskLevel: text('risk_level'),
  findingKey: text('finding_key'),
  snapshot: jsonb('snapshot'),
  policyId: text('policy_id'),
  reason: text('reason'),
  decidedBy: text('decided_by'),
  decidedAt: timestamp('decided_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orgProposalUnique: unique('tightening_proposal_decisions_org_proposal_unique').on(t.orgId, t.proposalId),
  orgDecisionIdx: index('idx_tightening_decisions_org_decision').on(t.orgId, t.decision),
}));

// @domain governance
// Loosening proposals (roadmap v4.5): the human's ratify/dismiss judgment on
// a ledger-derived proposal to RELAX an over-interrupting policy — the v3.2
// tightening mirror. Proposals are computed on read from approval outcomes
// (app/lib/posture/loosening.ts); only the decision persists, keyed by the
// engine's content-stable lp_ id. policy_id records the policy a ratify
// relaxed — undo keeps the change (change_kept, the policy_kept precedent);
// action_type is set on scope carve-outs, null on deactivations.
export const looseningProposalDecisions = pgTable('loosening_proposal_decisions', {
  id: serial('id').primaryKey(),
  orgId: text('org_id').notNull(),
  proposalId: text('proposal_id').notNull(),
  rule: text('rule').notNull(),
  decision: text('decision').notNull(), // 'ratified' | 'dismissed'
  actionType: text('action_type'),
  policyId: text('policy_id'),
  snapshot: jsonb('snapshot'),
  reason: text('reason'),
  decidedBy: text('decided_by'),
  decidedAt: timestamp('decided_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  orgProposalUnique: unique('loosening_proposal_decisions_org_proposal_unique').on(t.orgId, t.proposalId),
  orgDecisionIdx: index('idx_loosening_decisions_org_decision').on(t.orgId, t.decision),
}));

// v4.6 funnel truth: frozen funnel milestones for hosted trial workspaces,
// written by deleteHostedWorkspace BEFORE the FK child sweep (which would
// otherwise destroy the evidence and undercount mints — survivorship bias).
// No FK to organizations, deliberately: the catalog-driven sweep deletes
// every row that references the org; this row must survive it.
export const hostedTrialSnapshots = pgTable('hosted_trial_snapshots', {
  orgId: text('org_id').primaryKey(),
  mintedAt: timestamp('minted_at', { withTimezone: true }).notNull(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }).notNull().defaultNow(),
  keyUsed: boolean('key_used').notNull().default(false),
  firstActionAt: timestamp('first_action_at', { withTimezone: true }),
  lastActionAt: timestamp('last_action_at', { withTimezone: true }),
  actionCount: integer('action_count').notNull().default(0),
  retainedWeek1: boolean('retained_week1').notNull().default(false),
  // v5.3 sharpened facts; NULL on pre-v5.3 snapshots = unknown, never guessed.
  firstKeyUsedAt: timestamp('first_key_used_at', { withTimezone: true }),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  firstActionVia: text('first_action_via'), // 'browser' | 'agent'
  // v6.4: mint source frozen at deletion; NULL on pre-v6.4 snapshots = unknown.
  mintSource: text('mint_source'),
  mintSourceRaw: jsonb('mint_source_raw'),
});

// @domain governance
// x402 spend governance (drizzle/0021, money types normalized to numeric in
// drizzle/0044). These tables were raw-SQL-only from 0021 until 2026-07-03 —
// the money subsystem was invisible to schema tooling (arch-review finding).
// Modeled here so the source of truth is single; all access remains via
// app/lib/repositories/x402.repository.ts. Money columns are numeric, never
// float (trust & failure model ADR, D3); value/confidence scores are not
// money and stay real.
export const x402Providers = pgTable('x402_providers', {
  providerId: text('provider_id').primaryKey(),
  orgId: text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  description: text('description'),
  category: text('category').notNull().default('research'),
  baseUrl: text('base_url'),
  status: text('status').notNull().default('active'),
  defaultCurrency: text('default_currency').notNull().default('USDC'),
  pricingModel: text('pricing_model'),
  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (t) => ({
  orgSlugUnique: uniqueIndex('x402_providers_org_slug_unique').on(t.orgId, t.slug),
}));

// @domain governance
export const x402Endpoints = pgTable('x402_endpoints', {
  endpointId: text('endpoint_id').primaryKey(),
  orgId: text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  providerId: text('provider_id').notNull(),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  description: text('description'),
  endpointUrl: text('endpoint_url'),
  category: text('category').notNull().default('research'),
  sensitivityLevel: text('sensitivity_level').notNull().default('low'),
  defaultPrice: numeric('default_price'),
  priceUnit: text('price_unit').default('per_call'),
  enabled: integer('enabled').notNull().default(1),
  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (t) => ({
  providerIdx: index('idx_x402_endpoints_provider').on(t.orgId, t.providerId),
  providerSlugUnique: uniqueIndex('x402_endpoints_provider_slug_unique').on(t.orgId, t.providerId, t.slug),
}));

// @domain governance
export const x402Purchases = pgTable('x402_purchases', {
  actionId: text('action_id').primaryKey(),
  orgId: text('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  providerId: text('provider_id'),
  endpointId: text('endpoint_id'),
  agentId: text('agent_id'),
  spendAmount: numeric('spend_amount').notNull().default('0'),
  currency: text('currency').notNull().default('USDC'),
  paymentMethod: text('payment_method'),
  walletReference: text('wallet_reference'),
  paymentReference: text('payment_reference'),
  purchaseReason: text('purchase_reason'),
  contextGap: text('context_gap'),
  alternativesConsidered: text('alternatives_considered'),
  expectedValue: text('expected_value'),
  executionStatus: text('execution_status').notNull().default('pending'),
  resultSummary: text('result_summary'),
  resultReference: text('result_reference'),
  valueScore: real('value_score'),
  confidenceScore: real('confidence_score'),
  operatorFeedback: text('operator_feedback'),
  failureReason: text('failure_reason'),
  // End-to-end idempotency (v3.7 5d): mirrors action_records.idempotencyKey.
  // /api/actions and /api/guard already short-circuit duplicate
  // (org_id, idempotency_key) submissions; x402 purchases — the money route —
  // was the one sibling without it. See drizzle/0047 for the unique index.
  idempotencyKey: text('idempotency_key'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
}, (t) => ({
  providerIdx: index('idx_x402_purchases_provider').on(t.orgId, t.providerId, t.createdAt),
}));
