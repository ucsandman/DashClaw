#!/usr/bin/env node

/**
 * Multi-Tenant Migration Script
 *
 * Idempotent — safe to run multiple times.
 * Adds organizations + api_keys tables, adds org_id to all existing tables,
 * backfills existing data to org_default, makes org_id NOT NULL.
 *
 * Usage:
 *   DATABASE_URL=<db_url> node scripts/migrate-multi-tenant.mjs
 *   DATABASE_URL=<db_url> DASHCLAW_API_KEY=<key> node scripts/migrate-multi-tenant.mjs
 */

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

import { scryptSync } from 'node:crypto';
import { createSqlFromEnv } from './_db.mjs';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const sql = createSqlFromEnv();

function log(icon, msg) {
  console.log(`  ${icon} ${msg}`);
}

// All tables that need org_id
const TENANT_TABLES = [
  'action_records',
  'open_loops',
  'assumptions',
  'settings',
  'decisions',
  'outcomes',
  'lessons',
  'patterns',
  'ideas',
  'idea_updates',
  'goals',
  'milestones',
  'goal_updates',
  'contacts',
  'interactions',
  'workflows',
  'executions',
  'step_results',
  'scheduled_jobs',
  'token_usage',
  'content',
  'sync_log',
  'token_snapshots',
  'daily_totals',
  'health_snapshots',
  'entities',
  'topics',
  'calendar_events',
  'agent_connections',
  'usage_meters',
  'activity_logs',
  'webhooks',
  'webhook_deliveries',
  'notification_preferences',
  'signal_snapshots',
  'handoffs',
  'context_points',
  'context_threads',
  'context_entries',
  'snippets',
  'user_observations',
  'user_preferences',
  'user_moods',
  'user_approaches',
  'security_findings',
  'agent_messages',
  'message_threads',
  'shared_docs',
];

// Runs one SQL string through the same tagged-template driver path as sql`...`
// (both supported drivers detect a tagged call via Array.isArray(strings.raw)).
function runSql(text) {
  const template = Object.assign([text], { raw: [text] });
  return sql(template);
}

// One table-bootstrap step: optional console header, statements executed in order
// inside a single try/catch, success/warning logged like the original inline blocks.
async function runTableSteps(steps) {
  for (const step of steps) {
    if (step.header) console.log(step.header);
    try {
      for (const statement of step.statements) {
        await runSql(statement);
      }
      log(step.okIcon ?? '✅', step.okMessage);
    } catch (err) {
      log(step.warnIcon ?? '⚠️', `${step.warnLabel}: ${err.message}`);
    }
  }
}

// Step 4b: core data tables for fresh installs.
// Many API routes assume these tables exist; creating them here makes a brand-new DB usable.
const CORE_TABLE_STEPS = [
  {
    okIcon: 'âœ…',
    warnIcon: 'âš ï¸',
    okMessage: 'action_records table ready',
    warnLabel: 'action_records bootstrap',
    statements: [
      `
      CREATE TABLE IF NOT EXISTS action_records (
        id SERIAL PRIMARY KEY,
        org_id TEXT NOT NULL DEFAULT 'org_default' REFERENCES organizations(id),
        action_id TEXT UNIQUE,
        agent_id TEXT NOT NULL,
        agent_name TEXT,
        swarm_id TEXT,
        parent_action_id TEXT,
        action_type TEXT NOT NULL,
        declared_goal TEXT,
        reasoning TEXT,
        authorization_scope TEXT,
        trigger TEXT,
        systems_touched TEXT,
        input_summary TEXT,
        status TEXT,
        reversible INTEGER DEFAULT 1,
        risk_score INTEGER DEFAULT 0,
        confidence INTEGER DEFAULT 50,
        recommendation_id TEXT,
        recommendation_applied INTEGER DEFAULT 0,
        recommendation_override_reason TEXT,
        output_summary TEXT,
        side_effects TEXT,
        artifacts_created TEXT,
        error_message TEXT,
        timestamp_start TEXT,
        timestamp_end TEXT,
        duration_ms INTEGER,
        cost_estimate REAL DEFAULT 0,
        tokens_in INTEGER DEFAULT 0,
        tokens_out INTEGER DEFAULT 0,
        signature TEXT,
        verified BOOLEAN DEFAULT FALSE,
        approved_by TEXT,
        approved_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `,
      // Backfill: existing deployments may lack updated_at (added after initial schema)
      `ALTER TABLE action_records ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`,
      `CREATE INDEX IF NOT EXISTS idx_action_records_org_action_id ON action_records(org_id, action_id)`,
      `CREATE INDEX IF NOT EXISTS idx_action_records_org_agent_id ON action_records(org_id, agent_id)`,
      `CREATE INDEX IF NOT EXISTS idx_action_records_org_ts ON action_records(org_id, timestamp_start)`,
    ],
  },
  {
    okIcon: 'âœ…',
    warnIcon: 'âš ï¸',
    okMessage: 'goals table ready',
    warnLabel: 'goals bootstrap',
    statements: [
      `
      CREATE TABLE IF NOT EXISTS goals (
        id SERIAL PRIMARY KEY,
        org_id TEXT NOT NULL DEFAULT 'org_default' REFERENCES organizations(id),
        agent_id TEXT,
        title TEXT NOT NULL,
        category TEXT,
        description TEXT,
        target_date TEXT,
        progress INTEGER DEFAULT 0,
        status TEXT DEFAULT 'active',
        cost_estimate REAL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `,
      `CREATE INDEX IF NOT EXISTS idx_goals_org_agent_id ON goals(org_id, agent_id)`,
    ],
  },
  {
    okIcon: 'âœ…',
    warnIcon: 'âš ï¸',
    okMessage: 'milestones table ready',
    warnLabel: 'milestones bootstrap',
    statements: [
      `
      CREATE TABLE IF NOT EXISTS milestones (
        id SERIAL PRIMARY KEY,
        org_id TEXT NOT NULL DEFAULT 'org_default' REFERENCES organizations(id),
        agent_id TEXT,
        goal_id INTEGER REFERENCES goals(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        status TEXT DEFAULT 'active',
        progress INTEGER DEFAULT 0,
        cost_estimate REAL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `,
      `CREATE INDEX IF NOT EXISTS idx_milestones_org_goal_id ON milestones(org_id, goal_id)`,
      `CREATE INDEX IF NOT EXISTS idx_milestones_org_agent_id ON milestones(org_id, agent_id)`,
    ],
  },
  {
    okIcon: 'âœ…',
    warnIcon: 'âš ï¸',
    okMessage: 'open_loops table ready',
    warnLabel: 'open_loops bootstrap',
    statements: [
      `
      CREATE TABLE IF NOT EXISTS open_loops (
        id SERIAL PRIMARY KEY,
        org_id TEXT NOT NULL DEFAULT 'org_default' REFERENCES organizations(id),
        loop_id TEXT NOT NULL,
        action_id TEXT NOT NULL,
        loop_type TEXT NOT NULL,
        description TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        priority TEXT NOT NULL DEFAULT 'medium',
        owner TEXT,
        resolution TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        resolved_at TIMESTAMP
      )
    `,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_open_loops_org_loop_id_unique ON open_loops(org_id, loop_id)`,
      `CREATE INDEX IF NOT EXISTS idx_open_loops_org_action_id ON open_loops(org_id, action_id)`,
      `CREATE INDEX IF NOT EXISTS idx_open_loops_org_status ON open_loops(org_id, status)`,
    ],
  },
  {
    okIcon: 'âœ…',
    warnIcon: 'âš ï¸',
    okMessage: 'assumptions table ready',
    warnLabel: 'assumptions bootstrap',
    statements: [
      `
      CREATE TABLE IF NOT EXISTS assumptions (
        id SERIAL PRIMARY KEY,
        org_id TEXT NOT NULL DEFAULT 'org_default' REFERENCES organizations(id),
        assumption_id TEXT NOT NULL,
        action_id TEXT NOT NULL,
        assumption TEXT NOT NULL,
        basis TEXT,
        validated INTEGER DEFAULT 0,
        validated_at TIMESTAMP,
        invalidated INTEGER DEFAULT 0,
        invalidated_reason TEXT,
        invalidated_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_assumptions_org_assumption_id_unique ON assumptions(org_id, assumption_id)`,
      `CREATE INDEX IF NOT EXISTS idx_assumptions_org_action_id ON assumptions(org_id, action_id)`,
    ],
  },
  // Learning core tables (decisions/lessons/outcomes) used by /api/learning and /api/digest.
  {
    okMessage: 'decisions table ready',
    warnLabel: 'decisions bootstrap',
    statements: [
      `
      CREATE TABLE IF NOT EXISTS decisions (
        id SERIAL PRIMARY KEY,
        org_id TEXT NOT NULL DEFAULT 'org_default' REFERENCES organizations(id),
        agent_id TEXT,
        decision TEXT NOT NULL,
        context TEXT,
        reasoning TEXT,
        outcome TEXT DEFAULT 'pending',
        confidence INTEGER DEFAULT 50,
        timestamp TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `,
      `CREATE INDEX IF NOT EXISTS idx_decisions_org_agent_ts ON decisions(org_id, agent_id, timestamp)`,
    ],
  },
  {
    okMessage: 'lessons table ready',
    warnLabel: 'lessons bootstrap',
    statements: [
      `
      CREATE TABLE IF NOT EXISTS lessons (
        id SERIAL PRIMARY KEY,
        org_id TEXT NOT NULL DEFAULT 'org_default' REFERENCES organizations(id),
        agent_id TEXT,
        lesson TEXT,
        content TEXT,
        confidence INTEGER DEFAULT 50,
        timestamp TEXT,
        tags TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `,
      `CREATE INDEX IF NOT EXISTS idx_lessons_org_confidence ON lessons(org_id, confidence)`,
    ],
  },
  // Optional legacy outcomes table (compatibility with older joins/tools).
  {
    okMessage: 'outcomes table ready',
    warnLabel: 'outcomes bootstrap',
    statements: [
      `
      CREATE TABLE IF NOT EXISTS outcomes (
        id SERIAL PRIMARY KEY,
        org_id TEXT NOT NULL DEFAULT 'org_default' REFERENCES organizations(id),
        decision_id INTEGER,
        result TEXT DEFAULT 'pending',
        notes TEXT,
        timestamp TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `,
      `CREATE INDEX IF NOT EXISTS idx_outcomes_org_decision ON outcomes(org_id, decision_id)`,
    ],
  },
  // Content + inspiration + relationships (used by /workspace digest and dashboards).
  {
    okMessage: 'content table ready',
    warnLabel: 'content bootstrap',
    statements: [
      `
      CREATE TABLE IF NOT EXISTS content (
        id SERIAL PRIMARY KEY,
        org_id TEXT NOT NULL DEFAULT 'org_default' REFERENCES organizations(id),
        agent_id TEXT,
        title TEXT NOT NULL,
        platform TEXT,
        status TEXT DEFAULT 'draft',
        url TEXT,
        body TEXT,
        created_at TEXT
      )
    `,
      `CREATE INDEX IF NOT EXISTS idx_content_org_created ON content(org_id, created_at)`,
      `CREATE INDEX IF NOT EXISTS idx_content_org_agent ON content(org_id, agent_id)`,
    ],
  },
  {
    okMessage: 'ideas table ready',
    warnLabel: 'ideas bootstrap',
    statements: [
      `
      CREATE TABLE IF NOT EXISTS ideas (
        id SERIAL PRIMARY KEY,
        org_id TEXT NOT NULL DEFAULT 'org_default' REFERENCES organizations(id),
        title TEXT NOT NULL,
        description TEXT,
        category TEXT,
        score INTEGER DEFAULT 50,
        status TEXT DEFAULT 'pending',
        source TEXT,
        captured_at TEXT
      )
    `,
      `CREATE INDEX IF NOT EXISTS idx_ideas_org_captured ON ideas(org_id, captured_at)`,
    ],
  },
  {
    okMessage: 'contacts table ready',
    warnLabel: 'contacts bootstrap',
    statements: [
      `
      CREATE TABLE IF NOT EXISTS contacts (
        id SERIAL PRIMARY KEY,
        org_id TEXT NOT NULL DEFAULT 'org_default' REFERENCES organizations(id),
        agent_id TEXT,
        name TEXT NOT NULL,
        platform TEXT,
        temperature TEXT,
        notes TEXT,
        opportunity_type TEXT,
        last_contact TEXT,
        interaction_count INTEGER DEFAULT 0,
        next_followup TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `,
      `CREATE INDEX IF NOT EXISTS idx_contacts_org_agent_last ON contacts(org_id, agent_id, last_contact)`,
    ],
  },
  {
    okMessage: 'interactions table ready',
    warnLabel: 'interactions bootstrap',
    statements: [
      `
      CREATE TABLE IF NOT EXISTS interactions (
        id SERIAL PRIMARY KEY,
        org_id TEXT NOT NULL DEFAULT 'org_default' REFERENCES organizations(id),
        agent_id TEXT,
        contact_id INTEGER,
        direction TEXT,
        summary TEXT,
        notes TEXT,
        type TEXT,
        platform TEXT,
        date TEXT,
        created_at TEXT
      )
    `,
      `CREATE INDEX IF NOT EXISTS idx_interactions_org_created ON interactions(org_id, created_at)`,
      `CREATE INDEX IF NOT EXISTS idx_interactions_org_agent ON interactions(org_id, agent_id)`,
    ],
  },
  // Learning loop (recommendations) tables to avoid /api/learning/recommendations 500s on fresh DBs.
  {
    okMessage: 'learning-loop tables ready',
    warnLabel: 'learning-loop bootstrap',
    statements: [
      `ALTER TABLE action_records ADD COLUMN IF NOT EXISTS recommendation_id TEXT`,
      `ALTER TABLE action_records ADD COLUMN IF NOT EXISTS recommendation_applied INTEGER DEFAULT 0`,
      `ALTER TABLE action_records ADD COLUMN IF NOT EXISTS recommendation_override_reason TEXT`,
      `CREATE INDEX IF NOT EXISTS idx_action_records_recommendation_id ON action_records(org_id, recommendation_id)`,
      `
      CREATE TABLE IF NOT EXISTS learning_episodes (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL DEFAULT 'org_default',
        action_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        action_type TEXT NOT NULL,
        status TEXT,
        outcome_label TEXT NOT NULL DEFAULT 'pending',
        risk_score INTEGER DEFAULT 0,
        reversible INTEGER DEFAULT 1,
        confidence INTEGER DEFAULT 50,
        duration_ms INTEGER,
        cost_estimate REAL DEFAULT 0,
        invalidated_assumptions INTEGER DEFAULT 0,
        open_loops INTEGER DEFAULT 0,
        recommendation_id TEXT,
        recommendation_applied INTEGER DEFAULT 0,
        score INTEGER NOT NULL,
        score_breakdown TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `,
      `
      CREATE UNIQUE INDEX IF NOT EXISTS learning_episodes_org_action_unique
      ON learning_episodes (org_id, action_id)
    `,
      `
      CREATE INDEX IF NOT EXISTS idx_learning_episodes_org_agent_action
      ON learning_episodes (org_id, agent_id, action_type)
    `,
      `
      CREATE TABLE IF NOT EXISTS learning_recommendations (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL DEFAULT 'org_default',
        agent_id TEXT NOT NULL,
        action_type TEXT NOT NULL,
        confidence INTEGER NOT NULL DEFAULT 50,
        sample_size INTEGER NOT NULL DEFAULT 0,
        top_sample_size INTEGER NOT NULL DEFAULT 0,
        success_rate REAL NOT NULL DEFAULT 0,
        avg_score REAL NOT NULL DEFAULT 0,
        hints TEXT NOT NULL,
        guidance TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        computed_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `,
      `
      CREATE UNIQUE INDEX IF NOT EXISTS learning_recommendations_org_agent_action_unique
      ON learning_recommendations (org_id, agent_id, action_type)
    `,
      `
      CREATE TABLE IF NOT EXISTS learning_recommendation_events (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL DEFAULT 'org_default',
        recommendation_id TEXT,
        agent_id TEXT,
        action_id TEXT,
        event_type TEXT NOT NULL,
        event_key TEXT,
        details TEXT,
        created_at TEXT NOT NULL
      )
    `,
      `
      CREATE INDEX IF NOT EXISTS idx_learning_recommendation_events_org_created
      ON learning_recommendation_events (org_id, created_at)
    `,
    ],
  },
];

// Steps 11-15: platform tables (connections, token telemetry, memory health, scheduling, auth).
const PLATFORM_TABLE_STEPS = [
  // Step 11: Create agent_connections table
  {
    header: 'Step 11: Creating agent_connections table...',
    okMessage: 'agent_connections table + indexes ready',
    warnLabel: 'agent_connections migration',
    statements: [
      `
      CREATE TABLE IF NOT EXISTS agent_connections (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL DEFAULT 'org_default',
        agent_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        auth_type TEXT NOT NULL DEFAULT 'api_key',
        plan_name TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        metadata TEXT,
        reported_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `,
      `
      CREATE UNIQUE INDEX IF NOT EXISTS agent_connections_org_agent_provider_unique
      ON agent_connections (org_id, agent_id, provider)
    `,
      `CREATE INDEX IF NOT EXISTS idx_agent_connections_agent_id ON agent_connections(agent_id)`,
    ],
  },
  // Step 12: Create token_snapshots + daily_totals tables (with agent_id)
  {
    header: 'Step 12: Creating token_snapshots + daily_totals tables...',
    okMessage: 'token_snapshots table + indexes ready',
    warnLabel: 'token_snapshots migration',
    statements: [
      `
      CREATE TABLE IF NOT EXISTS token_snapshots (
        id SERIAL PRIMARY KEY,
        org_id TEXT NOT NULL DEFAULT 'org_default',
        agent_id TEXT,
        timestamp TEXT NOT NULL,
        tokens_in INTEGER,
        tokens_out INTEGER,
        context_used INTEGER,
        context_max INTEGER,
        context_pct REAL,
        hourly_pct_left REAL,
        weekly_pct_left REAL,
        compactions INTEGER,
        model TEXT,
        session_key TEXT
      )
    `,
      `CREATE INDEX IF NOT EXISTS idx_token_snapshots_org_id ON token_snapshots(org_id)`,
      `CREATE INDEX IF NOT EXISTS idx_token_snapshots_agent_id ON token_snapshots(agent_id)`,
      `CREATE INDEX IF NOT EXISTS idx_token_snapshots_timestamp ON token_snapshots(timestamp)`,
    ],
  },
  {
    okMessage: 'daily_totals table + indexes ready',
    warnLabel: 'daily_totals migration',
    statements: [
      `
      CREATE TABLE IF NOT EXISTS daily_totals (
        id SERIAL PRIMARY KEY,
        org_id TEXT NOT NULL DEFAULT 'org_default',
        agent_id TEXT,
        date TEXT NOT NULL,
        total_tokens_in INTEGER DEFAULT 0,
        total_tokens_out INTEGER DEFAULT 0,
        total_tokens INTEGER DEFAULT 0,
        peak_context_pct REAL DEFAULT 0,
        snapshots_count INTEGER DEFAULT 0
      )
    `,
      // Functional unique: per-agent daily totals (NULL agent_id = org-wide aggregate)
      `
      CREATE UNIQUE INDEX IF NOT EXISTS daily_totals_org_agent_date_unique
      ON daily_totals (org_id, COALESCE(agent_id, ''), date)
    `,
      `CREATE INDEX IF NOT EXISTS idx_daily_totals_org_id ON daily_totals(org_id)`,
      `CREATE INDEX IF NOT EXISTS idx_daily_totals_agent_id ON daily_totals(agent_id)`,
    ],
  },
  // Step 13: Create health_snapshots, entities, topics tables (memory health)
  {
    header: 'Step 13: Creating memory health tables...',
    okMessage: 'health_snapshots table + indexes ready',
    warnLabel: 'health_snapshots migration',
    statements: [
      `
      CREATE TABLE IF NOT EXISTS health_snapshots (
        id SERIAL PRIMARY KEY,
        org_id TEXT NOT NULL DEFAULT 'org_default',
        timestamp TEXT NOT NULL,
        health_score INTEGER DEFAULT 0,
        total_files INTEGER DEFAULT 0,
        total_lines INTEGER DEFAULT 0,
        total_size_kb INTEGER DEFAULT 0,
        memory_md_lines INTEGER DEFAULT 0,
        oldest_daily_file TEXT,
        newest_daily_file TEXT,
        days_with_notes INTEGER DEFAULT 0,
        avg_lines_per_day REAL DEFAULT 0,
        potential_duplicates INTEGER DEFAULT 0,
        stale_facts_count INTEGER DEFAULT 0
      )
    `,
      `CREATE INDEX IF NOT EXISTS idx_health_snapshots_org_id ON health_snapshots(org_id)`,
      `CREATE INDEX IF NOT EXISTS idx_health_snapshots_timestamp ON health_snapshots(timestamp)`,
    ],
  },
  {
    okMessage: 'entities table + index ready',
    warnLabel: 'entities migration',
    statements: [
      `
      CREATE TABLE IF NOT EXISTS entities (
        id SERIAL PRIMARY KEY,
        org_id TEXT NOT NULL DEFAULT 'org_default',
        name TEXT NOT NULL,
        type TEXT DEFAULT 'other',
        mention_count INTEGER DEFAULT 1
      )
    `,
      `CREATE INDEX IF NOT EXISTS idx_entities_org_id ON entities(org_id)`,
    ],
  },
  {
    okMessage: 'topics table + index ready',
    warnLabel: 'topics migration',
    statements: [
      `
      CREATE TABLE IF NOT EXISTS topics (
        id SERIAL PRIMARY KEY,
        org_id TEXT NOT NULL DEFAULT 'org_default',
        name TEXT NOT NULL,
        mention_count INTEGER DEFAULT 1
      )
    `,
      `CREATE INDEX IF NOT EXISTS idx_topics_org_id ON topics(org_id)`,
    ],
  },
  // Step 13b: Create calendar_events table
  {
    header: 'Step 13b: Creating calendar_events table...',
    okMessage: 'calendar_events table + indexes ready',
    warnLabel: 'calendar_events migration',
    statements: [
      `
      CREATE TABLE IF NOT EXISTS calendar_events (
        id SERIAL PRIMARY KEY,
        org_id TEXT NOT NULL DEFAULT 'org_default',
        summary TEXT NOT NULL,
        start_time TIMESTAMPTZ NOT NULL,
        end_time TIMESTAMPTZ,
        location TEXT,
        description TEXT
      )
    `,
      `CREATE INDEX IF NOT EXISTS idx_calendar_events_org_id ON calendar_events(org_id)`,
      `CREATE INDEX IF NOT EXISTS idx_calendar_events_start_time ON calendar_events(start_time)`,
    ],
  },
  // Step 13c: Create workflows table
  {
    header: 'Step 13c: Creating workflows table...',
    okMessage: 'workflows table + indexes ready',
    warnLabel: 'workflows migration',
    statements: [
      `
      CREATE TABLE IF NOT EXISTS workflows (
        id SERIAL PRIMARY KEY,
        org_id TEXT NOT NULL DEFAULT 'org_default',
        agent_id TEXT,
        name TEXT NOT NULL,
        description TEXT,
        enabled INTEGER DEFAULT 1,
        trigger_type TEXT,
        run_count INTEGER DEFAULT 0,
        last_run TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `,
      `CREATE INDEX IF NOT EXISTS idx_workflows_org_id ON workflows(org_id)`,
      `
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'workflows_org_name_unique'
        ) THEN
          ALTER TABLE workflows ADD CONSTRAINT workflows_org_name_unique UNIQUE (org_id, name);
        END IF;
      END $$
    `,
    ],
  },
  // Step 13d: Create executions table
  {
    header: 'Step 13d: Creating executions table...',
    okMessage: 'executions table + indexes ready',
    warnLabel: 'executions migration',
    statements: [
      `
      CREATE TABLE IF NOT EXISTS executions (
        id SERIAL PRIMARY KEY,
        org_id TEXT NOT NULL DEFAULT 'org_default',
        agent_id TEXT,
        workflow_id INTEGER REFERENCES workflows(id),
        status TEXT DEFAULT 'pending',
        started_at TIMESTAMPTZ DEFAULT NOW(),
        finished_at TIMESTAMPTZ,
        error TEXT
      )
    `,
      `CREATE INDEX IF NOT EXISTS idx_executions_org_id ON executions(org_id)`,
      `CREATE INDEX IF NOT EXISTS idx_executions_started_at ON executions(started_at)`,
    ],
  },
  // Step 13e: Create scheduled_jobs table
  {
    header: 'Step 13e: Creating scheduled_jobs table...',
    okMessage: 'scheduled_jobs table + indexes ready',
    warnLabel: 'scheduled_jobs migration',
    statements: [
      `
      CREATE TABLE IF NOT EXISTS scheduled_jobs (
        id SERIAL PRIMARY KEY,
        org_id TEXT NOT NULL DEFAULT 'org_default',
        workflow_id INTEGER REFERENCES workflows(id),
        name TEXT,
        cron_expression TEXT,
        enabled INTEGER DEFAULT 1,
        next_run TIMESTAMPTZ,
        last_run TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `,
      `CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_org_id ON scheduled_jobs(org_id)`,
      `CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_next_run ON scheduled_jobs(next_run)`,
    ],
  },
  // Step 14: Create waitlist table (pre-auth, no org_id)
  {
    header: 'Step 14: Creating waitlist table...',
    okMessage: 'waitlist table + indexes ready',
    warnLabel: 'waitlist migration',
    statements: [
      `
      CREATE TABLE IF NOT EXISTS waitlist (
        id SERIAL PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        signed_up_at TEXT NOT NULL,
        signup_count INTEGER DEFAULT 1,
        source TEXT DEFAULT 'landing_page',
        notes TEXT
      )
    `,
      `CREATE INDEX IF NOT EXISTS idx_waitlist_email ON waitlist(email)`,
      `CREATE INDEX IF NOT EXISTS idx_waitlist_signed_up_at ON waitlist(signed_up_at)`,
    ],
  },
  // Step 15: Users table (NextAuth integration)
  {
    header: 'Step 15: Creating users table...',
    okMessage: 'users table + indexes ready',
    warnLabel: 'users migration',
    statements: [
      `
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL DEFAULT 'org_default',
        email TEXT NOT NULL,
        name TEXT,
        image TEXT,
        provider TEXT NOT NULL,
        provider_account_id TEXT NOT NULL,
        role TEXT DEFAULT 'member',
        created_at TEXT NOT NULL,
        last_login_at TEXT NOT NULL
      )
    `,
      `CREATE UNIQUE INDEX IF NOT EXISTS users_provider_account_unique ON users(provider, provider_account_id)`,
      `CREATE INDEX IF NOT EXISTS idx_users_org_id ON users(org_id)`,
      `CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`,
    ],
  },
];

// Steps 17-40: feature tables (team, billing, observability, messaging, governance, routing).
const FEATURE_TABLE_STEPS = [
  // Step 17: Create invites table (team invitations)
  {
    header: 'Step 17: Creating invites table...',
    okMessage: 'invites table + indexes ready',
    warnLabel: 'invites migration',
    statements: [
      `
      CREATE TABLE IF NOT EXISTS invites (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        email TEXT,
        role TEXT DEFAULT 'member',
        token TEXT UNIQUE NOT NULL,
        invited_by TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        accepted_by TEXT,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `,
      `CREATE INDEX IF NOT EXISTS idx_invites_token ON invites(token)`,
      `CREATE INDEX IF NOT EXISTS idx_invites_org_id ON invites(org_id)`,
      `CREATE INDEX IF NOT EXISTS idx_invites_status ON invites(status)`,
    ],
  },
  // Step 18: Add Stripe billing columns to organizations
  {
    header: 'Step 18: Adding Stripe billing columns to organizations...',
    okMessage: 'organizations: Stripe billing columns + indexes ready',
    warnLabel: 'organizations Stripe columns',
    statements: [
      `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT`,
      `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT`,
      `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS subscription_status TEXT DEFAULT 'active'`,
      `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS current_period_end TEXT`,
      `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS trial_ends_at TEXT`,
      `CREATE INDEX IF NOT EXISTS idx_organizations_stripe_customer_id ON organizations(stripe_customer_id)`,
      `CREATE INDEX IF NOT EXISTS idx_organizations_stripe_subscription_id ON organizations(stripe_subscription_id)`,
    ],
  },
  // Step 19: Create usage_meters table (billing quota fast path)
  {
    header: 'Step 19: Creating usage_meters table...',
    okMessage: 'usage_meters table + indexes ready',
    warnLabel: 'usage_meters migration',
    statements: [
      `
      CREATE TABLE IF NOT EXISTS usage_meters (
        id SERIAL PRIMARY KEY,
        org_id TEXT NOT NULL DEFAULT 'org_default',
        period TEXT NOT NULL,
        resource TEXT NOT NULL,
        count INTEGER NOT NULL DEFAULT 0,
        last_reconciled_at TEXT,
        updated_at TEXT NOT NULL
      )
    `,
      `
      CREATE UNIQUE INDEX IF NOT EXISTS usage_meters_org_period_resource_unique
      ON usage_meters (org_id, period, resource)
    `,
      `CREATE INDEX IF NOT EXISTS idx_usage_meters_org_id ON usage_meters(org_id)`,
    ],
  },
  // Step 20: Create activity_logs table
  {
    header: 'Step 20: Creating activity_logs table...',
    okMessage: 'activity_logs table + indexes ready',
    warnLabel: 'activity_logs migration',
    statements: [
      `
      CREATE TABLE IF NOT EXISTS activity_logs (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL DEFAULT 'org_default',
        actor_id TEXT NOT NULL,
        actor_type TEXT NOT NULL DEFAULT 'user',
        action TEXT NOT NULL,
        resource_type TEXT,
        resource_id TEXT,
        details TEXT,
        ip_address TEXT,
        created_at TEXT NOT NULL
      )
    `,
      `CREATE INDEX IF NOT EXISTS idx_activity_logs_org_id ON activity_logs(org_id)`,
      `CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at ON activity_logs(created_at)`,
      `CREATE INDEX IF NOT EXISTS idx_activity_logs_action ON activity_logs(action)`,
      `CREATE INDEX IF NOT EXISTS idx_activity_logs_actor_id ON activity_logs(actor_id)`,
    ],
  },
  // Step 21: Create webhooks table
  {
    header: 'Step 21: Creating webhooks table...',
    okMessage: 'webhooks table + indexes ready',
    warnLabel: 'webhooks migration',
    statements: [
      `
      CREATE TABLE IF NOT EXISTS webhooks (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL DEFAULT 'org_default',
        url TEXT NOT NULL,
        secret TEXT NOT NULL,
        events TEXT NOT NULL DEFAULT '["all"]',
        active INTEGER NOT NULL DEFAULT 1,
        created_by TEXT,
        failure_count INTEGER NOT NULL DEFAULT 0,
        last_triggered_at TEXT,
        created_at TEXT NOT NULL
      )
    `,
      `CREATE INDEX IF NOT EXISTS idx_webhooks_org_id ON webhooks(org_id)`,
      `CREATE INDEX IF NOT EXISTS idx_webhooks_active ON webhooks(active)`,
    ],
  },
  // Step 22: Create webhook_deliveries table
  {
    header: 'Step 22: Creating webhook_deliveries table...',
    okMessage: 'webhook_deliveries table + indexes ready',
    warnLabel: 'webhook_deliveries migration',
    statements: [
      `
      CREATE TABLE IF NOT EXISTS webhook_deliveries (
        id TEXT PRIMARY KEY,
        webhook_id TEXT NOT NULL,
        org_id TEXT NOT NULL DEFAULT 'org_default',
        event_type TEXT NOT NULL,
        payload TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        response_status INTEGER,
        response_body TEXT,
        attempted_at TEXT NOT NULL,
        duration_ms INTEGER
      )
    `,
      `CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_webhook_id ON webhook_deliveries(webhook_id)`,
      `CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_org_id ON webhook_deliveries(org_id)`,
      `CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_attempted_at ON webhook_deliveries(attempted_at)`,
    ],
  },
  // Step 23: Create notification_preferences + signal_snapshots tables
  {
    header: 'Step 23: Creating notification_preferences + signal_snapshots tables...',
    okMessage: 'notification_preferences table + unique index ready',
    warnLabel: 'notification_preferences migration',
    statements: [
      `
      CREATE TABLE IF NOT EXISTS notification_preferences (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL DEFAULT 'org_default',
        user_id TEXT NOT NULL,
        channel TEXT NOT NULL DEFAULT 'email',
        enabled INTEGER NOT NULL DEFAULT 1,
        signal_types TEXT NOT NULL DEFAULT '["all"]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `,
      `
      CREATE UNIQUE INDEX IF NOT EXISTS notification_preferences_org_user_channel_unique
      ON notification_preferences (org_id, user_id, channel)
    `,
    ],
  },
  {
    okMessage: 'signal_snapshots table + unique index ready',
    warnLabel: 'signal_snapshots migration',
    statements: [
      `
      CREATE TABLE IF NOT EXISTS signal_snapshots (
        id SERIAL PRIMARY KEY,
        org_id TEXT NOT NULL DEFAULT 'org_default',
        signal_hash TEXT NOT NULL,
        signal_type TEXT NOT NULL,
        severity TEXT NOT NULL,
        agent_id TEXT,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL
      )
    `,
      `
      CREATE UNIQUE INDEX IF NOT EXISTS signal_snapshots_org_hash_unique
      ON signal_snapshots (org_id, signal_hash)
    `,
    ],
  },
  // Step 24: Create handoffs table (session handoffs)
  {
    header: 'Step 24: Creating handoffs table...',
    okMessage: 'handoffs table + indexes ready',
    warnLabel: 'handoffs migration',
    statements: [
      `
      CREATE TABLE IF NOT EXISTS handoffs (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL DEFAULT 'org_default',
        agent_id TEXT NOT NULL,
        session_date TEXT NOT NULL,
        summary TEXT NOT NULL,
        key_decisions TEXT,
        open_tasks TEXT,
        mood_notes TEXT,
        next_priorities TEXT,
        created_at TEXT NOT NULL
      )
    `,
      `CREATE INDEX IF NOT EXISTS idx_handoffs_org_id ON handoffs(org_id)`,
      `CREATE INDEX IF NOT EXISTS idx_handoffs_agent_id ON handoffs(agent_id)`,
      `CREATE INDEX IF NOT EXISTS idx_handoffs_session_date ON handoffs(session_date)`,
    ],
  },
  // Step 25: Create context_points table
  {
    header: 'Step 25: Creating context_points table...',
    okMessage: 'context_points table + indexes ready',
    warnLabel: 'context_points migration',
    statements: [
      `
      CREATE TABLE IF NOT EXISTS context_points (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL DEFAULT 'org_default',
        agent_id TEXT,
        content TEXT NOT NULL,
        category TEXT DEFAULT 'general',
        importance INTEGER DEFAULT 5,
        session_date TEXT NOT NULL,
        compressed INTEGER DEFAULT 0,
        created_at TEXT NOT NULL
      )
    `,
      `CREATE INDEX IF NOT EXISTS idx_context_points_org_id ON context_points(org_id)`,
      `CREATE INDEX IF NOT EXISTS idx_context_points_agent_id ON context_points(agent_id)`,
      `CREATE INDEX IF NOT EXISTS idx_context_points_session_date ON context_points(session_date)`,
    ],
  },
  // Step 26: Create context_threads + context_entries tables
  {
    header: 'Step 26: Creating context_threads + context_entries tables...',
    okMessage: 'context_threads table + indexes ready',
    warnLabel: 'context_threads migration',
    statements: [
      `
      CREATE TABLE IF NOT EXISTS context_threads (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL DEFAULT 'org_default',
        agent_id TEXT,
        name TEXT NOT NULL,
        summary TEXT,
        status TEXT DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `,
      `
      CREATE UNIQUE INDEX IF NOT EXISTS context_threads_org_agent_name_unique
      ON context_threads (org_id, COALESCE(agent_id, ''), name)
    `,
      `CREATE INDEX IF NOT EXISTS idx_context_threads_org_id ON context_threads(org_id)`,
      `CREATE INDEX IF NOT EXISTS idx_context_threads_agent_id ON context_threads(agent_id)`,
      `CREATE INDEX IF NOT EXISTS idx_context_threads_status ON context_threads(status)`,
    ],
  },
  {
    okMessage: 'context_entries table + indexes ready',
    warnLabel: 'context_entries migration',
    statements: [
      `
      CREATE TABLE IF NOT EXISTS context_entries (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        org_id TEXT NOT NULL DEFAULT 'org_default',
        content TEXT NOT NULL,
        entry_type TEXT DEFAULT 'note',
        created_at TEXT NOT NULL
      )
    `,
      `CREATE INDEX IF NOT EXISTS idx_context_entries_thread_id ON context_entries(thread_id)`,
      `CREATE INDEX IF NOT EXISTS idx_context_entries_org_id ON context_entries(org_id)`,
    ],
  },
  // Step 27: Create snippets table
  {
    header: 'Step 27: Creating snippets table...',
    okMessage: 'snippets table + indexes ready',
    warnLabel: 'snippets migration',
    statements: [
      `
      CREATE TABLE IF NOT EXISTS snippets (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL DEFAULT 'org_default',
        agent_id TEXT,
        name TEXT NOT NULL,
        description TEXT,
        code TEXT NOT NULL,
        language TEXT,
        tags TEXT,
        use_count INTEGER DEFAULT 0,
        created_at TEXT NOT NULL,
        last_used TEXT
      )
    `,
      `
      CREATE UNIQUE INDEX IF NOT EXISTS snippets_org_name_unique
      ON snippets (org_id, name)
    `,
      `CREATE INDEX IF NOT EXISTS idx_snippets_org_id ON snippets(org_id)`,
      `CREATE INDEX IF NOT EXISTS idx_snippets_agent_id ON snippets(agent_id)`,
    ],
  },
  // Step 28: Create user preference tables (4 tables)
  {
    header: 'Step 28: Creating user preference tables...',
    okMessage: 'user_observations table + indexes ready',
    warnLabel: 'user_observations migration',
    statements: [
      `
      CREATE TABLE IF NOT EXISTS user_observations (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL DEFAULT 'org_default',
        user_id TEXT,
        agent_id TEXT,
        observation TEXT NOT NULL,
        category TEXT,
        importance INTEGER DEFAULT 5,
        created_at TEXT NOT NULL
      )
    `,
      `CREATE INDEX IF NOT EXISTS idx_user_observations_org_id ON user_observations(org_id)`,
      `CREATE INDEX IF NOT EXISTS idx_user_observations_agent_id ON user_observations(agent_id)`,
    ],
  },
  {
    okMessage: 'user_preferences table + indexes ready',
    warnLabel: 'user_preferences migration',
    statements: [
      `
      CREATE TABLE IF NOT EXISTS user_preferences (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL DEFAULT 'org_default',
        user_id TEXT,
        agent_id TEXT,
        preference TEXT NOT NULL,
        category TEXT,
        confidence INTEGER DEFAULT 50,
        last_validated TEXT,
        created_at TEXT NOT NULL
      )
    `,
      `CREATE INDEX IF NOT EXISTS idx_user_preferences_org_id ON user_preferences(org_id)`,
      `CREATE INDEX IF NOT EXISTS idx_user_preferences_agent_id ON user_preferences(agent_id)`,
    ],
  },
  {
    okMessage: 'user_moods table + indexes ready',
    warnLabel: 'user_moods migration',
    statements: [
      `
      CREATE TABLE IF NOT EXISTS user_moods (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL DEFAULT 'org_default',
        user_id TEXT,
        agent_id TEXT,
        mood TEXT NOT NULL,
        energy TEXT,
        notes TEXT,
        created_at TEXT NOT NULL
      )
    `,
      `CREATE INDEX IF NOT EXISTS idx_user_moods_org_id ON user_moods(org_id)`,
      `CREATE INDEX IF NOT EXISTS idx_user_moods_agent_id ON user_moods(agent_id)`,
    ],
  },
  {
    okMessage: 'user_approaches table + indexes ready',
    warnLabel: 'user_approaches migration',
    statements: [
      `
      CREATE TABLE IF NOT EXISTS user_approaches (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL DEFAULT 'org_default',
        user_id TEXT,
        agent_id TEXT,
        approach TEXT NOT NULL,
        context TEXT,
        success_count INTEGER DEFAULT 0,
        fail_count INTEGER DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `,
      `
      CREATE UNIQUE INDEX IF NOT EXISTS user_approaches_org_agent_approach_unique
      ON user_approaches (org_id, COALESCE(agent_id, ''), approach)
    `,
      `CREATE INDEX IF NOT EXISTS idx_user_approaches_org_id ON user_approaches(org_id)`,
      `CREATE INDEX IF NOT EXISTS idx_user_approaches_agent_id ON user_approaches(agent_id)`,
    ],
  },
  // Step 29: Create security_findings table
  {
    header: 'Step 29: Creating security_findings table...',
    okMessage: 'security_findings table + indexes ready',
    warnLabel: 'security_findings migration',
    statements: [
      `
      CREATE TABLE IF NOT EXISTS security_findings (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL DEFAULT 'org_default',
        agent_id TEXT,
        content_hash TEXT NOT NULL,
        findings_count INTEGER DEFAULT 0,
        critical_count INTEGER DEFAULT 0,
        categories TEXT,
        scanned_at TEXT NOT NULL
      )
    `,
      `CREATE INDEX IF NOT EXISTS idx_security_findings_org_id ON security_findings(org_id)`,
      `CREATE INDEX IF NOT EXISTS idx_security_findings_content_hash ON security_findings(content_hash)`,
    ],
  },
  // Step 30: Create agent_messages table
  {
    header: 'Step 30: Creating agent_messages table...',
    okMessage: 'agent_messages table + indexes ready',
    warnLabel: 'agent_messages migration',
    statements: [
      `
      CREATE TABLE IF NOT EXISTS agent_messages (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL DEFAULT 'org_default',
        thread_id TEXT,
        from_agent_id TEXT NOT NULL,
        to_agent_id TEXT,
        message_type TEXT NOT NULL DEFAULT 'info',
        subject TEXT,
        body TEXT NOT NULL,
        urgent BOOLEAN DEFAULT false,
        status TEXT NOT NULL DEFAULT 'sent',
        doc_ref TEXT,
        read_by TEXT,
        created_at TEXT NOT NULL,
        read_at TEXT,
        archived_at TEXT
      )
    `,
      `CREATE INDEX IF NOT EXISTS idx_agent_messages_org_id ON agent_messages(org_id)`,
      `CREATE INDEX IF NOT EXISTS idx_agent_messages_inbox ON agent_messages(org_id, to_agent_id, status)`,
      `CREATE INDEX IF NOT EXISTS idx_agent_messages_thread_id ON agent_messages(thread_id)`,
      `CREATE INDEX IF NOT EXISTS idx_agent_messages_from ON agent_messages(org_id, from_agent_id)`,
    ],
  },
  // Step 31: Create message_threads table
  {
    header: 'Step 31: Creating message_threads table...',
    okMessage: 'message_threads table + indexes ready',
    warnLabel: 'message_threads migration',
    statements: [
      `
      CREATE TABLE IF NOT EXISTS message_threads (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL DEFAULT 'org_default',
        name TEXT NOT NULL,
        participants TEXT,
        status TEXT NOT NULL DEFAULT 'open',
        summary TEXT,
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        resolved_at TEXT
      )
    `,
      `CREATE INDEX IF NOT EXISTS idx_message_threads_org_id ON message_threads(org_id)`,
      `CREATE INDEX IF NOT EXISTS idx_message_threads_org_status ON message_threads(org_id, status)`,
    ],
  },
  // Step 32: Create shared_docs table
  {
    header: 'Step 32: Creating shared_docs table...',
    okMessage: 'shared_docs table + indexes ready',
    warnLabel: 'shared_docs migration',
    statements: [
      `
      CREATE TABLE IF NOT EXISTS shared_docs (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL DEFAULT 'org_default',
        name TEXT NOT NULL,
        content TEXT NOT NULL,
        created_by TEXT NOT NULL,
        last_edited_by TEXT,
        version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `,
      `CREATE INDEX IF NOT EXISTS idx_shared_docs_org_id ON shared_docs(org_id)`,
      `
      CREATE UNIQUE INDEX IF NOT EXISTS shared_docs_org_name_unique
      ON shared_docs (org_id, name)
    `,
    ],
  },
  // Step 33: Create guard_policies and guard_decisions tables
  {
    header: 'Step 33: Creating guard_policies and guard_decisions tables...',
    okMessage: 'guard_policies table + indexes ready',
    warnLabel: 'guard_policies migration',
    statements: [
      `
      CREATE TABLE IF NOT EXISTS guard_policies (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL DEFAULT 'org_default',
        name TEXT NOT NULL,
        policy_type TEXT NOT NULL,
        rules TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1,
        created_by TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `,
      `CREATE INDEX IF NOT EXISTS idx_guard_policies_org_id ON guard_policies(org_id)`,
      `
      CREATE UNIQUE INDEX IF NOT EXISTS guard_policies_org_name_unique
      ON guard_policies (org_id, name)
    `,
    ],
  },
  {
    okMessage: 'guard_decisions table + indexes ready',
    warnLabel: 'guard_decisions migration',
    statements: [
      `
      CREATE TABLE IF NOT EXISTS guard_decisions (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL DEFAULT 'org_default',
        agent_id TEXT,
        decision TEXT NOT NULL,
        reason TEXT,
        matched_policies TEXT,
        context TEXT,
        risk_score INTEGER,
        action_type TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `,
      // Backfill: pre-existing instances had created_at as TEXT, which broke every
      // comparison against NOW() (signals dashboard, decisions ledger, recent-decisions MCP tool).
      // ALTER is idempotent — if the column is already TIMESTAMPTZ the cast is a no-op.
      `
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'guard_decisions'
            AND column_name = 'created_at'
            AND data_type = 'text'
        ) THEN
          ALTER TABLE guard_decisions
            ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at::timestamptz;
          ALTER TABLE guard_decisions
            ALTER COLUMN created_at SET DEFAULT NOW();
        END IF;
      END
      $$;
    `,
      `CREATE INDEX IF NOT EXISTS idx_guard_decisions_org_id ON guard_decisions(org_id)`,
      `CREATE INDEX IF NOT EXISTS idx_guard_decisions_created_at ON guard_decisions(created_at)`,
      `CREATE INDEX IF NOT EXISTS idx_guard_decisions_agent_id ON guard_decisions(agent_id)`,
    ],
  },
  // --- Integration Phase: Guardrails, Compliance, Routing tables ---
  // Step 34: Guardrails test runs
  {
    okMessage: 'guardrails_test_runs table + indexes ready',
    warnLabel: 'guardrails_test_runs migration',
    statements: [
      `
      CREATE TABLE IF NOT EXISTS guardrails_test_runs (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL DEFAULT 'org_default',
        total_policies INTEGER NOT NULL DEFAULT 0,
        total_tests INTEGER NOT NULL DEFAULT 0,
        passed INTEGER NOT NULL DEFAULT 0,
        failed INTEGER NOT NULL DEFAULT 0,
        success INTEGER NOT NULL DEFAULT 0,
        details TEXT,
        triggered_by TEXT,
        created_at TEXT NOT NULL DEFAULT (NOW()::TEXT)
      )
    `,
      `CREATE INDEX IF NOT EXISTS idx_guardrails_test_runs_org ON guardrails_test_runs(org_id)`,
      `CREATE INDEX IF NOT EXISTS idx_guardrails_test_runs_created ON guardrails_test_runs(created_at)`,
    ],
  },
  // Step 35: Compliance snapshots
  {
    okMessage: 'compliance_snapshots table + indexes ready',
    warnLabel: 'compliance_snapshots migration',
    statements: [
      `
      CREATE TABLE IF NOT EXISTS compliance_snapshots (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL DEFAULT 'org_default',
        framework TEXT NOT NULL,
        total_controls INTEGER NOT NULL DEFAULT 0,
        covered INTEGER NOT NULL DEFAULT 0,
        partial INTEGER NOT NULL DEFAULT 0,
        gaps INTEGER NOT NULL DEFAULT 0,
        coverage_percentage INTEGER NOT NULL DEFAULT 0,
        risk_level TEXT,
        full_report TEXT,
        created_at TEXT NOT NULL DEFAULT (NOW()::TEXT)
      )
    `,
      `CREATE INDEX IF NOT EXISTS idx_compliance_snapshots_org ON compliance_snapshots(org_id)`,
      `CREATE INDEX IF NOT EXISTS idx_compliance_snapshots_framework ON compliance_snapshots(org_id, framework)`,
      `CREATE INDEX IF NOT EXISTS idx_compliance_snapshots_created ON compliance_snapshots(created_at)`,
    ],
  },
  // Step 36: Routing agents
  {
    okMessage: 'routing_agents table + indexes ready',
    warnLabel: 'routing_agents migration',
    statements: [
      `
      CREATE TABLE IF NOT EXISTS routing_agents (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL DEFAULT 'org_default',
        name TEXT NOT NULL,
        capabilities TEXT,
        max_concurrent INTEGER NOT NULL DEFAULT 3,
        current_load INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'available',
        endpoint TEXT,
        created_at TEXT NOT NULL DEFAULT (NOW()::TEXT),
        updated_at TEXT NOT NULL DEFAULT (NOW()::TEXT)
      )
    `,
      `CREATE INDEX IF NOT EXISTS idx_routing_agents_org ON routing_agents(org_id)`,
      `CREATE INDEX IF NOT EXISTS idx_routing_agents_status ON routing_agents(org_id, status)`,
    ],
  },
  // Step 37: Routing tasks
  {
    okMessage: 'routing_tasks table + indexes ready',
    warnLabel: 'routing_tasks migration',
    statements: [
      `
      CREATE TABLE IF NOT EXISTS routing_tasks (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL DEFAULT 'org_default',
        title TEXT NOT NULL,
        description TEXT,
        required_skills TEXT,
        urgency TEXT NOT NULL DEFAULT 'normal',
        assigned_to TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        result TEXT,
        timeout_seconds INTEGER NOT NULL DEFAULT 3600,
        max_retries INTEGER NOT NULL DEFAULT 2,
        retry_count INTEGER NOT NULL DEFAULT 0,
        callback_url TEXT,
        created_at TEXT NOT NULL DEFAULT (NOW()::TEXT),
        updated_at TEXT NOT NULL DEFAULT (NOW()::TEXT)
      )
    `,
      `CREATE INDEX IF NOT EXISTS idx_routing_tasks_org ON routing_tasks(org_id)`,
      `CREATE INDEX IF NOT EXISTS idx_routing_tasks_status ON routing_tasks(org_id, status)`,
      `CREATE INDEX IF NOT EXISTS idx_routing_tasks_assigned ON routing_tasks(org_id, assigned_to)`,
    ],
  },
  // Step 38: Routing agent metrics
  {
    okMessage: 'routing_agent_metrics table + indexes ready',
    warnLabel: 'routing_agent_metrics migration',
    statements: [
      `
      CREATE TABLE IF NOT EXISTS routing_agent_metrics (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL DEFAULT 'org_default',
        agent_id TEXT NOT NULL,
        skill TEXT NOT NULL,
        tasks_completed INTEGER NOT NULL DEFAULT 0,
        tasks_failed INTEGER NOT NULL DEFAULT 0,
        avg_duration_ms INTEGER,
        last_completed_at TEXT,
        created_at TEXT NOT NULL DEFAULT (NOW()::TEXT)
      )
    `,
      `CREATE INDEX IF NOT EXISTS idx_routing_metrics_agent ON routing_agent_metrics(org_id, agent_id)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_routing_metrics_agent_skill ON routing_agent_metrics(org_id, agent_id, skill)`,
    ],
  },
  // Step 39: Routing decisions (audit trail)
  {
    okMessage: 'routing_decisions table + indexes ready',
    warnLabel: 'routing_decisions migration',
    statements: [
      `
      CREATE TABLE IF NOT EXISTS routing_decisions (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL DEFAULT 'org_default',
        task_id TEXT NOT NULL,
        candidates TEXT,
        selected_agent_id TEXT,
        selected_score REAL,
        reason TEXT,
        created_at TEXT NOT NULL DEFAULT (NOW()::TEXT)
      )
    `,
      `CREATE INDEX IF NOT EXISTS idx_routing_decisions_org ON routing_decisions(org_id)`,
      `CREATE INDEX IF NOT EXISTS idx_routing_decisions_task ON routing_decisions(task_id)`,
    ],
  },
  // Step 40: Bug hunter scans table
  {
    okMessage: 'bug_hunter_scans table + indexes ready',
    warnLabel: 'bug_hunter_scans migration',
    statements: [
      `
      CREATE TABLE IF NOT EXISTS bug_hunter_scans (
        id SERIAL PRIMARY KEY,
        scan_id TEXT UNIQUE NOT NULL,
        org_id TEXT NOT NULL DEFAULT 'org_default',
        agent_id TEXT,
        scope TEXT,
        status TEXT DEFAULT 'completed',
        findings_count INTEGER DEFAULT 0,
        resolved_count INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `,
      `CREATE INDEX IF NOT EXISTS idx_bug_hunter_scans_org ON bug_hunter_scans(org_id)`,
      `CREATE INDEX IF NOT EXISTS idx_bug_hunter_scans_agent ON bug_hunter_scans(org_id, agent_id)`,
    ],
  },
];

// Step 1: Create organizations table
async function ensureOrganizationsTable() {
  console.log('Step 1: Creating organizations table...');
  await sql`
    CREATE TABLE IF NOT EXISTS organizations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      plan TEXT DEFAULT 'free',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `;
  log('✅', 'organizations table ready');
}

// Step 2: Create api_keys table
async function ensureApiKeysTable() {
  console.log('Step 2: Creating api_keys table...');
  await sql`
    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES organizations(id),
      key_hash TEXT NOT NULL,
      key_prefix TEXT NOT NULL,
      label TEXT DEFAULT 'default',
      role TEXT DEFAULT 'member',
      last_used_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      revoked_at TIMESTAMP
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash ON api_keys(key_hash)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_api_keys_org_id ON api_keys(org_id)`;
  // ADD COLUMN IF NOT EXISTS guards — safe to run on legacy schemas that already have the table.
  // Ensures upgraders from older api_keys schemas (without all columns) don't crash here.
  await sql.query("ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS org_id TEXT", []);
  await sql.query("ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS key_hash TEXT", []);
  await sql.query("ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS key_prefix TEXT", []);
  await sql.query("ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS label TEXT DEFAULT 'default'", []);
  await sql.query("ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'member'", []);
  await sql.query("ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMP", []);
  await sql.query("ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMP", []);
  log('✅', 'api_keys table ready');
}

// Step 3: Create default organization
async function ensureDefaultOrg() {
  console.log('Step 3: Creating default organization...');
  await sql`
    INSERT INTO organizations (id, name, slug, plan)
    VALUES ('org_default', 'Default Organization', 'default', 'pro')
    ON CONFLICT (id) DO NOTHING
  `;
  log('✅', 'org_default exists');
}

// Step 3b: Create DASHCLAW_API_KEY_ORG organization if configured and different from org_default
async function ensureConfiguredOrg() {
  const configuredOrgId = process.env.DASHCLAW_API_KEY_ORG;
  if (configuredOrgId && configuredOrgId !== 'org_default') {
    console.log('Step 3b: Ensuring DASHCLAW_API_KEY_ORG organization exists...');
    const slug = configuredOrgId.replace(/^org_/, '').replace(/[^a-z0-9-]/g, '-').slice(0, 64);
    await sql`
      INSERT INTO organizations (id, name, slug, plan)
      VALUES (${configuredOrgId}, 'DashClaw Instance', ${slug}, 'pro')
      ON CONFLICT (id) DO NOTHING
    `;
    log('✅', 'DASHCLAW_API_KEY_ORG organization exists');
  }
  return configuredOrgId;
}

// Step 4: Seed admin key from DASHCLAW_API_KEY (if set)
async function seedAdminKey(configuredOrgId) {
  const dashboardKey = process.env.DASHCLAW_API_KEY;
  const keyTargetOrg = configuredOrgId || 'org_default';
  if (dashboardKey) {
    console.log('Step 4: Seeding admin API key from DASHCLAW_API_KEY...');
    // Use a computationally expensive KDF (scrypt) instead of a single fast hash
    const keyHash = scryptSync(dashboardKey, 'dashclaw_api_key_salt', 64).toString('hex');
    const keyPrefix = dashboardKey.substring(0, 8);
    const keyId = 'key_default_admin';

    await sql`
      INSERT INTO api_keys (id, org_id, key_hash, key_prefix, label, role)
      VALUES (${keyId}, ${keyTargetOrg}, ${keyHash}, ${keyPrefix}, 'Dashboard Admin Key', 'admin')
      ON CONFLICT (id) DO UPDATE SET
        org_id = ${keyTargetOrg},
        key_hash = EXCLUDED.key_hash,
        key_prefix = EXCLUDED.key_prefix
    `;
    log('✅', 'Admin key seeded');
  } else {
    console.log('Step 4: No DASHCLAW_API_KEY set — skipping admin key seed');
    log('⚠️', 'Set DASHCLAW_API_KEY and re-run to seed admin key');
  }
  return dashboardKey;
}

// Rethrows unless the error is "table does not exist" — that's fine, schema creation will handle it.
function skipIfMissingTable(err, skipMessage) {
  if (!err.message?.includes('does not exist')) throw err;
  log('⚠️', skipMessage);
}

// Step 5: Add org_id column to all existing tables
async function addOrgIdColumns() {
  console.log('Step 5: Adding org_id column to existing tables...');
  for (const table of TENANT_TABLES) {
    try {
      await sql.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS org_id TEXT`, []);
      log('✅', `${table}.org_id column ready`);
    } catch (err) {
      skipIfMissingTable(err, `${table} does not exist — skipping (will be created by schema)`);
    }
  }
}

// Step 6: Backfill existing data to org_default
async function backfillOrgIds() {
  console.log('Step 6: Backfilling org_id = org_default...');
  for (const table of TENANT_TABLES) {
    try {
      const result = await sql.query(
        `UPDATE ${table} SET org_id = 'org_default' WHERE org_id IS NULL`,
        []
      );
      const count = result?.length || 0;
      if (count > 0) {
        log('✅', `${table}: backfilled ${count} rows`);
      } else {
        log('✅', `${table}: no rows to backfill`);
      }
    } catch (err) {
      skipIfMissingTable(err, `${table} does not exist — skipping backfill`);
    }
  }
}

// Step 7: Set org_id NOT NULL + add indexes
async function enforceOrgIdConstraints() {
  console.log('Step 7: Setting NOT NULL constraints and indexes...');
  for (const table of TENANT_TABLES) {
    try {
      // Set default for new rows
      await sql.query(
        `ALTER TABLE ${table} ALTER COLUMN org_id SET DEFAULT 'org_default'`,
        []
      );
      // Make NOT NULL
      await sql.query(
        `ALTER TABLE ${table} ALTER COLUMN org_id SET NOT NULL`,
        []
      );
      // Add index
      await sql.query(
        `CREATE INDEX IF NOT EXISTS idx_${table}_org_id ON ${table}(org_id)`,
        []
      );
      log('✅', `${table}: NOT NULL + index ready`);
    } catch (err) {
      handleOrgIdConstraintError(table, err);
    }
  }
}

function handleOrgIdConstraintError(table, err) {
  if (err.message?.includes('does not exist')) {
    log('⚠️', `${table} does not exist — skipping constraints`);
    return;
  }
  if (err.message?.includes('contains null values')) {
    log('❌', `${table}: still has NULL org_id values — run backfill again`);
  }
  throw err;
}

// Step 8: Fix settings table (composite unique key)
async function fixSettingsCompositeKey() {
  console.log('Step 8: Fixing settings table composite key...');
  try {
    // Check if settings table exists and has a 'key' column
    const settingsCols = await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'settings' AND column_name = 'key'
    `;
    if (settingsCols.length > 0) {
      await rebuildSettingsCompositeKey();
      log('✅', 'settings: composite key (org_id, key) ready');
    } else {
      log('⚠️', 'settings table has no key column — skipping PK fix');
    }
  } catch (err) {
    if (err.message?.includes('does not exist')) {
      log('⚠️', 'settings table does not exist — skipping PK fix');
    } else {
      // Non-fatal: log and continue
      log('⚠️', `settings PK fix: ${err.message}`);
    }
  }
}

// Moves the settings primary key off 'key' alone and onto a serial id + (org_id, key) unique.
// (SQL literals keep their original embedded indentation byte-for-byte.)
async function rebuildSettingsCompositeKey() {
  // Drop old PK if it was on 'key' alone
  await sql`
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conname = 'settings_pkey'
            AND conrelid = 'settings'::regclass
          ) THEN
            ALTER TABLE settings DROP CONSTRAINT settings_pkey;
          END IF;
        END $$
      `;
  // Add serial ID if not present
  const hasId = await sql`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'settings' AND column_name = 'id'
      `;
  if (hasId.length === 0) {
    await sql`ALTER TABLE settings ADD COLUMN id SERIAL`;
  }
  // Add PK on id
  await sql`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conname = 'settings_pkey'
            AND conrelid = 'settings'::regclass
          ) THEN
            ALTER TABLE settings ADD PRIMARY KEY (id);
          END IF;
        END $$
      `;
  // Add composite unique constraint
  await sql`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conname = 'settings_org_key_unique'
          ) THEN
            ALTER TABLE settings ADD CONSTRAINT settings_org_key_unique UNIQUE (org_id, key);
          END IF;
        END $$
      `;
}

// Step 9: Fix workflows unique constraint
async function fixWorkflowsUniqueConstraint() {
  console.log('Step 9: Fixing workflows unique constraint...');
  try {
    await sql`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'workflows_name_key'
        ) THEN
          ALTER TABLE workflows DROP CONSTRAINT workflows_name_key;
        END IF;
      END $$
    `;
    await sql`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'workflows_org_name_unique'
        ) THEN
          ALTER TABLE workflows ADD CONSTRAINT workflows_org_name_unique UNIQUE (org_id, name);
        END IF;
      END $$
    `;
    log('✅', 'workflows: unique (org_id, name) ready');
  } catch (err) {
    if (err.message?.includes('does not exist')) {
      log('⚠️', 'workflows table does not exist — skipping constraint fix');
    } else {
      log('⚠️', `workflows constraint fix: ${err.message}`);
    }
  }
}

// Step 10: Add agent_id to settings table for per-agent integrations
async function addSettingsAgentId() {
  console.log('Step 10: Adding agent_id to settings table...');
  try {
    const settingsExists = await sql`
      SELECT 1 FROM information_schema.tables
      WHERE table_name = 'settings' AND table_schema = 'public'
    `;
    if (settingsExists.length > 0) {
      // Add agent_id column (nullable — NULL means org-level default)
      await sql`ALTER TABLE settings ADD COLUMN IF NOT EXISTS agent_id TEXT`;

      // Drop old constraint if it exists
      await sql`
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conname = 'settings_org_key_unique'
          ) THEN
            ALTER TABLE settings DROP CONSTRAINT settings_org_key_unique;
          END IF;
        END $$
      `;

      // Create new functional unique index (COALESCE handles NULL agent_id)
      await sql`
        CREATE UNIQUE INDEX IF NOT EXISTS settings_org_agent_key_unique
        ON settings (org_id, COALESCE(agent_id, ''), key)
      `;

      // Add index on agent_id for fast per-agent lookups
      await sql`CREATE INDEX IF NOT EXISTS idx_settings_agent_id ON settings(agent_id)`;

      log('✅', 'settings: agent_id column + functional unique index ready');
    } else {
      log('⚠️', 'settings table does not exist — skipping agent_id migration');
    }
  } catch (err) {
    log('⚠️', `settings agent_id migration: ${err.message}`);
  }
}

// Step 16: Add agent_id to content, contacts, interactions, goals, milestones, workflows, executions
async function addAgentIdColumns() {
  console.log('Step 16: Adding agent_id to data tables...');
  const agentIdTables = ['content', 'contacts', 'interactions', 'goals', 'milestones', 'workflows', 'executions'];
  for (const table of agentIdTables) {
    try {
      await sql.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS agent_id TEXT`);
      await sql.query(`CREATE INDEX IF NOT EXISTS idx_${table}_agent_id ON ${table}(agent_id)`);
      log('✅', `${table}: agent_id column + index ready`);
    } catch (err) {
      log('⚠️', `${table} agent_id migration: ${err.message}`);
    }
  }
}

// Verification
async function verifyMigration(dashboardKey) {
  console.log('\n=== Verification ===\n');

  const orgCheck = await sql`SELECT * FROM organizations WHERE id = 'org_default'`;
  log(orgCheck.length > 0 ? '✅' : '❌', `org_default exists: ${orgCheck.length > 0}`);

  const colCheck = await sql`
    SELECT table_name, is_nullable
    FROM information_schema.columns
    WHERE column_name = 'org_id'
    AND table_schema = 'public'
    ORDER BY table_name
  `;
  log('📊', `Tables with org_id: ${colCheck.length}`);
  const nullableTables = colCheck.filter(c => c.is_nullable === 'YES');
  if (nullableTables.length > 0) {
    log('⚠️', `Tables with nullable org_id: ${nullableTables.map(t => t.table_name).join(', ')}`);
  } else {
    log('✅', 'All org_id columns are NOT NULL');
  }

  if (dashboardKey) {
    const keyCheck = await sql`SELECT id, key_prefix, role FROM api_keys WHERE org_id = 'org_default'`;
    log(keyCheck.length > 0 ? '✅' : '❌', `Admin key exists: ${keyCheck.length > 0}`);
  }

  console.log('\n=== Migration Complete ===\n');
}

async function run() {
  console.log('\n=== Multi-Tenant Migration ===\n');

  await ensureOrganizationsTable();
  await ensureApiKeysTable();
  await ensureDefaultOrg();
  const configuredOrgId = await ensureConfiguredOrg();
  const dashboardKey = await seedAdminKey(configuredOrgId);

  // Step 4b: Bootstrap core data tables for fresh installs.
  // Many API routes assume these tables exist; creating them here makes a brand-new DB usable.
  console.log('Step 4b: Bootstrapping core tables (dashboard core)...');
  await runTableSteps(CORE_TABLE_STEPS);

  await addOrgIdColumns();
  await backfillOrgIds();
  await enforceOrgIdConstraints();
  await fixSettingsCompositeKey();
  await fixWorkflowsUniqueConstraint();
  await addSettingsAgentId();

  await runTableSteps(PLATFORM_TABLE_STEPS); // Steps 11-15
  await addAgentIdColumns(); // Step 16
  await runTableSteps(FEATURE_TABLE_STEPS); // Steps 17-40

  await verifyMigration(dashboardKey);
}

run().catch(err => {
  console.error('\nMigration failed:', err.message);
  process.exit(1);
});
