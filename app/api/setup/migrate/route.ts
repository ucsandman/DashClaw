export const dynamic = 'force-dynamic';
export const maxDuration = 30;

import { NextResponse } from 'next/server';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import postgres from 'postgres';
import { isAlreadyInitialized, isAuthorizedSetupWriter } from '../../../lib/setup/auth-gate';
import { redactErrorDetail } from '../../../lib/apiErrors';
import {
  ACTION_RECORDS_RUNTIME_COLUMN_DEFINITIONS,
  ACTION_RECORDS_RUNTIME_INDEX_DEFINITIONS,
} from '../../../lib/setup/action-records-runtime-schema.mjs';
import { splitSqlStatements } from '../../../lib/setup/sql-statements.mjs';

export {
  ACTION_RECORDS_RUNTIME_COLUMN_DEFINITIONS,
  ACTION_RECORDS_RUNTIME_COLUMNS,
  ACTION_RECORDS_RUNTIME_INDEX_DEFINITIONS,
  ACTION_RECORDS_RUNTIME_INDEXES,
} from '../../../lib/setup/action-records-runtime-schema.mjs';

async function reconcileActionRecordsRuntimeSchema(sql: any) {
  for (const column of ACTION_RECORDS_RUNTIME_COLUMN_DEFINITIONS) {
    try {
      await sql.unsafe(
        `ALTER TABLE "action_records" ADD COLUMN IF NOT EXISTS "${column.name}" ${column.sql}`,
      );
    } catch { /* best-effort: older installs may already have equivalent columns with slight type differences */ }
  }

  for (const index of ACTION_RECORDS_RUNTIME_INDEX_DEFINITIONS) {
    try {
      await sql.unsafe(index.sql);
    } catch { /* best-effort: index drift is caught by the setup validator */ }
  }
}

/**
 * POST /api/setup/migrate — Runtime database migration.
 *
 * Safety net for when auto-migrate didn't run during build.
 * Executes the Drizzle DDL SQL, seeds org_default, and returns a result.
 *
 * Idempotent — safe to call multiple times.
 * Public during first-run bootstrap (before org_default exists). After
 * initialization, requires an admin-scoped API key so it can't be used
 * by unauthenticated callers to re-seed plan='pro' or overwrite state.
 */
export async function POST(request: Request) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    return NextResponse.json(
      { error: 'DATABASE_URL is not set. Add it to your Vercel project settings and redeploy.' },
      { status: 500 }
    );
  }

  const sql = postgres(url, { max: 1, connect_timeout: 30, idle_timeout: 5 });

  try {
    if (await isAlreadyInitialized(sql) && !(await isAuthorizedSetupWriter(sql, request))) {
      return NextResponse.json(
        { error: 'Instance already initialized. Admin API key required to re-run migrations.' },
        { status: 401 }
      );
    }
    // Read all Drizzle migration SQL files in order
    const drizzleDir = resolve(process.cwd(), 'drizzle');
    let ddl: string;
    try {
      const sqlFiles = readdirSync(drizzleDir)
        .filter((f) => f.endsWith('.sql'))
        .sort();
      ddl = sqlFiles
        .map((f) => readFileSync(resolve(drizzleDir, f), 'utf8'))
        .join('\n--> statement-breakpoint\n');
    } catch {
      // Fallback: create only the critical tables needed for governance loop
      ddl = CRITICAL_TABLES_DDL;
    }

    // Strips full-line comments too — non-ASCII comment characters hard-fail
    // statement encoding conversion on non-UTF8 databases (see sql-statements.mjs).
    const statements = splitSqlStatements(ddl);

    // Postgres error codes safe to skip on re-run
    const SAFE_CODES = new Set([
      '42P07', '42P16', '42701', '42710', '42P10', '23505',
    ]);

    let created = 0;
    let skipped = 0;

    for (const stmt of statements) {
      try {
        if (stmt.includes('vector(') && !stmt.startsWith('CREATE EXTENSION')) {
          try { await sql.unsafe('CREATE EXTENSION IF NOT EXISTS vector'); } catch { /* best-effort: pgvector not available — vector statements skipped */ }
        }
        await sql.unsafe(stmt);
        created++;
      } catch (err) {
        if (SAFE_CODES.has((err as { code?: string }).code as string) || (err as Error).message?.includes('already exists')) {
          skipped++;
        } else {
          skipped++;
        }
      }
    }

    // Ensure columns on existing tables (handles schema drift from older deploys)
    for (const stmt of statements) {
      const tableMatch = stmt.match(/^CREATE TABLE\s+"(\w+)"\s*\(/i);
      if (!tableMatch) continue;
      const table = tableMatch[1];
      const body = stmt.slice(stmt.indexOf('(') + 1, stmt.lastIndexOf(')'));
      const lines = body.split('\n').map((l) => l.trim().replace(/,\s*$/, ''));
      for (const line of lines) {
        if (!line.startsWith('"')) continue;
        const colMatch = line.match(/^"(\w+)"\s+(.+)/);
        if (!colMatch) continue;
        let rest = colMatch[2]!.replace(/\s*PRIMARY KEY.*/i, '').replace(/,\s*$/, '');
        try { await sql.unsafe(`ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "${colMatch[1]}" ${rest}`); } catch { /* best-effort: column already exists with an equivalent shape */ }
      }
    }

    await reconcileActionRecordsRuntimeSchema(sql);

    // Seed org_default
    let orgSeeded = false;
    try {
      await sql`
        INSERT INTO organizations (id, name, slug, plan)
        VALUES ('org_default', 'Default Organization', 'default', 'pro')
        ON CONFLICT (id) DO NOTHING
      `;
      orgSeeded = true;
    } catch { /* best-effort: failure reported via org_seeded in the response */ }

    // Optionally seed API key from env
    let keySeeded = false;
    const configuredKey = process.env.DASHCLAW_API_KEY;
    const configuredOrgId = process.env.DASHCLAW_API_KEY_ORG || 'org_default';

    if (configuredKey && configuredKey.startsWith('oc_live_')) {
      const { createHash } = await import('node:crypto');
      const keyHash = createHash('sha256').update(configuredKey).digest('hex');
      const keyPrefix = configuredKey.slice(0, 16);

      try {
        if (configuredOrgId !== 'org_default') {
          await sql`
            INSERT INTO organizations (id, name, slug, plan)
            VALUES (${configuredOrgId}, ${configuredOrgId}, ${configuredOrgId}, 'pro')
            ON CONFLICT (id) DO NOTHING
          `;
        }
        await sql`
          INSERT INTO api_keys (id, org_id, key_hash, key_prefix, label, role)
          VALUES (
            ${'key_' + keyHash.slice(0, 16)},
            ${configuredOrgId},
            ${keyHash},
            ${keyPrefix},
            'auto-provisioned',
            'admin'
          )
          ON CONFLICT (id) DO NOTHING
        `;
        keySeeded = true;
      } catch { /* best-effort: failure reported via key_seeded in the response */ }
    }

    await sql.end({ timeout: 5 });

    return NextResponse.json({
      ok: true,
      schema: { applied: created, skipped },
      org_seeded: orgSeeded,
      key_seeded: keySeeded,
    });
  } catch (err) {
    try { await sql.end({ timeout: 2 }); } catch { /* best-effort: connection teardown on the error path */ }
    console.error('[SETUP/MIGRATE] error:', err);
    // Public route (pre-init bootstrap) — same production redaction gate as
    // apiErrorResponse; a raw err.message here would leak internals to any
    // unauthenticated caller before org_default exists.
    return NextResponse.json({ error: redactErrorDetail(err) }, { status: 500 });
  }
}

/**
 * Inline DDL for the critical governance tables.
 * Used as fallback if the drizzle DDL file isn't in the serverless bundle.
 *
 * Every table block here MUST match its `schema/schema.js` pgTable column
 * set exactly (column names + SQL types + defaults) — `settings` is the one
 * exception, since it has no pgTable object in schema.js and is instead
 * sourced straight from `drizzle/0000_clammy_falcon.sql` (the only place it's
 * declared). __tests__/unit/critical-tables-ddl-drift.test.js asserts this
 * for every schema.js-backed table so this constant can't silently rot again
 * (see v3.7 item 5a ride-along — a stale guard_decisions snapshot here once
 * missing verification_status/replay_status/jti/act_status/act_hash/evidence/
 * degraded/agent_name would hard-fail the required audit INSERT with 42703
 * on any deploy that ever took this fallback branch).
 */
export const CRITICAL_TABLES_DDL = `
CREATE TABLE IF NOT EXISTS "organizations" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "slug" text NOT NULL,
  "plan" text DEFAULT 'free',
  "stripe_customer_id" text,
  "stripe_subscription_id" text,
  "subscription_status" text DEFAULT 'active',
  "current_period_end" text,
  "trial_ends_at" text,
  "hosted_mode" boolean NOT NULL DEFAULT FALSE,
  "trial_action_cap" integer,
  "trial_actions_used" integer NOT NULL DEFAULT 0,
  "trial_first_seen_at" timestamptz,
  "trial_last_seen_at" timestamptz,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  "trial_mint_source" text,
  "trial_mint_source_raw" jsonb,
  "trial_exported_at" timestamptz,
  CONSTRAINT "organizations_slug_unique" UNIQUE("slug")
)
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "hosted_trial_snapshots" (
  "org_id" text PRIMARY KEY NOT NULL,
  "minted_at" timestamptz NOT NULL,
  "deleted_at" timestamptz NOT NULL DEFAULT now(),
  "key_used" boolean NOT NULL DEFAULT false,
  "first_action_at" timestamptz,
  "last_action_at" timestamptz,
  "action_count" integer NOT NULL DEFAULT 0,
  "retained_week1" boolean NOT NULL DEFAULT false,
  "first_key_used_at" timestamptz,
  "first_seen_at" timestamptz,
  "last_seen_at" timestamptz,
  "first_action_via" text,
  "mint_source" text,
  "mint_source_raw" jsonb,
  "exported_at" timestamptz
)
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "guard_policies" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL,
  "name" text NOT NULL,
  "policy_type" text NOT NULL,
  "rules" text NOT NULL,
  "active" integer NOT NULL DEFAULT 1,
  "agent_ids" text,
  "created_by" text,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
)
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "guard_decisions" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL,
  "agent_id" text,
  "agent_name" text,
  "verification_status" text DEFAULT 'unverified',
  "replay_status" text DEFAULT 'not_applicable',
  "jti" text,
  "act_status" text DEFAULT 'not_applicable',
  "act_hash" text,
  "decision" text NOT NULL,
  "reason" text,
  "matched_policies" text,
  "context" text,
  "evidence" text,
  "risk_score" integer,
  "action_type" text,
  "idempotency_key" text,
  "created_at" timestamp DEFAULT now(),
  "degraded" boolean NOT NULL DEFAULT false
)
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_guard_decisions_org_idem" ON "guard_decisions" ("org_id", "idempotency_key") WHERE "idempotency_key" IS NOT NULL
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "action_records" (
  "id" serial PRIMARY KEY NOT NULL,
  "action_id" text,
  "org_id" text NOT NULL,
  "agent_id" text NOT NULL,
  "agent_name" text,
  "swarm_id" text,
  "parent_action_id" text,
  "action_type" text NOT NULL,
  "declared_goal" text,
  "reasoning" text,
  "authorization_scope" text,
  "trigger" text,
  "systems_touched" text,
  "input_summary" text,
  "status" text,
  "reversible" integer DEFAULT 1,
  "risk_score" integer DEFAULT 0,
  "confidence" integer DEFAULT 50,
  "recommendation_id" text,
  "recommendation_applied" integer DEFAULT 0,
  "recommendation_override_reason" text,
  "output_summary" text,
  "side_effects" text,
  "artifacts_created" text,
  "error_message" text,
  "timestamp_start" text,
  "timestamp_end" text,
  "duration_ms" integer,
  "cost_estimate" real DEFAULT 0,
  "tokens_in" integer DEFAULT 0,
  "tokens_out" integer DEFAULT 0,
  "model" text,
  "signature" text,
  "verified" boolean DEFAULT false,
  "approved_by" text,
  "approved_at" timestamp,
  "created_by" text,
  "approval_grant_used_at" timestamp,
  "act_content_hash" text,
  "approval_expires_at" timestamp with time zone,
  "outcome_status" text NOT NULL DEFAULT 'pending',
  "outcome_at" timestamp with time zone,
  "outcome_summary" text,
  "outcome_error" text,
  "outcome_progress" jsonb,
  "idempotency_key" text,
  "session_id" text,
  "guard_decision_id" text,
  "close_source" text,
  "containment_status" text,
  "containment_ref" text,
  "containment_resolved_by" text,
  "containment_resolved_at" timestamp,
  "harness_session_id" text,
  "subagent_uuid" text,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  CONSTRAINT "action_records_action_id_unique" UNIQUE("action_id")
)
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "api_keys" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL,
  "key_hash" text NOT NULL,
  "key_prefix" text NOT NULL,
  "label" text DEFAULT 'default',
  "role" text DEFAULT 'member',
  "scope" text,
  "last_used_at" timestamp,
  "first_used_at" timestamp,
  "revoked_at" timestamp,
  "created_at" timestamp DEFAULT now()
)
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "settings" (
  "id" serial PRIMARY KEY NOT NULL,
  "org_id" text DEFAULT 'org_default' NOT NULL,
  "agent_id" text,
  "key" text NOT NULL,
  "value" text,
  "category" text DEFAULT 'general',
  "encrypted" boolean DEFAULT false,
  "updated_at" timestamp DEFAULT now()
)
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL,
  "email" text NOT NULL,
  "name" text,
  "image" text,
  "provider" text,
  "provider_account_id" text,
  "role" text DEFAULT 'member',
  "created_at" timestamp DEFAULT now(),
  "last_login_at" timestamp DEFAULT now()
)
--> statement-breakpoint
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS hosted_mode BOOLEAN NOT NULL DEFAULT FALSE
--> statement-breakpoint
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS trial_action_cap INTEGER
--> statement-breakpoint
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS trial_actions_used INTEGER NOT NULL DEFAULT 0
--> statement-breakpoint
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS scope TEXT
--> statement-breakpoint
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS trial_first_seen_at timestamptz
--> statement-breakpoint
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS trial_last_seen_at timestamptz
--> statement-breakpoint
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS first_used_at timestamp
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS organizations_hosted_mode_idx ON organizations(hosted_mode) WHERE hosted_mode = TRUE
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS settings_org_agent_key_unique ON settings (org_id, COALESCE(agent_id, ''), key)
`.trim();
