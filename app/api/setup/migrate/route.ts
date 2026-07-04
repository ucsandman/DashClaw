export const dynamic = 'force-dynamic';
export const maxDuration = 30;

import { NextResponse } from 'next/server';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import postgres from 'postgres';
import { isAlreadyInitialized, isAuthorizedSetupWriter } from '../../../lib/setup/auth-gate';
import {
  ACTION_RECORDS_RUNTIME_COLUMN_DEFINITIONS,
  ACTION_RECORDS_RUNTIME_INDEX_DEFINITIONS,
} from '../../../lib/setup/action-records-runtime-schema.mjs';

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

    const statements = ddl
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter(Boolean);

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
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

/**
 * Inline DDL for the critical governance tables.
 * Used as fallback if the drizzle DDL file isn't in the serverless bundle.
 */
const CRITICAL_TABLES_DDL = `
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
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now(),
  CONSTRAINT "organizations_slug_unique" UNIQUE("slug")
)
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "guard_policies" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL,
  "name" text NOT NULL,
  "policy_type" text NOT NULL,
  "rules" text NOT NULL,
  "active" integer DEFAULT 1,
  "agent_ids" text,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
)
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "guard_decisions" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL,
  "agent_id" text,
  "action_type" text,
  "risk_score" integer,
  "decision" text NOT NULL,
  "reason" text,
  "matched_policies" text,
  "context" text,
  "created_at" timestamp DEFAULT now()
)
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "action_records" (
  "id" serial PRIMARY KEY NOT NULL,
  "action_id" text,
  "org_id" text NOT NULL,
  "agent_id" text NOT NULL,
  "agent_name" text,
  "action_type" text NOT NULL,
  "declared_goal" text,
  "reasoning" text,
  "status" text,
  "risk_score" integer DEFAULT 0,
  "confidence" integer DEFAULT 50,
  "systems_touched" text,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
)
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "api_keys" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL,
  "key_hash" text NOT NULL,
  "key_prefix" text,
  "label" text,
  "role" text DEFAULT 'admin',
  "scope" text,
  "last_used_at" timestamp,
  "created_at" timestamp DEFAULT now()
)
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "settings" (
  "id" serial PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL,
  "key" text NOT NULL,
  "value" text,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
)
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "users" (
  "id" text PRIMARY KEY NOT NULL,
  "org_id" text NOT NULL,
  "name" text,
  "email" text,
  "role" text DEFAULT 'member',
  "provider" text,
  "provider_account_id" text,
  "image" text,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
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
CREATE INDEX IF NOT EXISTS organizations_hosted_mode_idx ON organizations(hosted_mode) WHERE hosted_mode = TRUE
`.trim();
