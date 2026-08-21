#!/usr/bin/env node

/**
 * auto-migrate.mjs
 *
 * Non-interactive schema migration for Vercel deploy button flows.
 * Runs as the buildCommand before `next build`:
 *   "node scripts/auto-migrate.mjs && next build"
 *
 * What it does:
 *   1. Verifies DATABASE_URL is present.
 *   2. Executes the Drizzle DDL SQL directly via postgres.js (no drizzle-kit,
 *      no interactive prompts, no TTY required).
 *   3. Seeds the `org_default` organization row if missing.
 *   4. Optionally seeds an api_keys row from DASHCLAW_API_KEY env var.
 *
 * Idempotent — safe to run on every deploy.
 * Exits 0 on success, non-zero on failure.
 */

process.on('unhandledRejection', (reason) => {
  console.error('[auto-migrate] Unhandled Rejection:', reason);
  process.exit(1);
});

import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { splitSqlStatements } from '../app/lib/setup/sql-statements.mjs';
import { seedCatastrophePack, holdMassDestructive, gateMassDestructiveOnEvidence } from '../app/lib/setup/catastrophe-pack.mjs';

// Load .env / .env.local if present (no-op in Vercel where vars are injected).
import './_load-env.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');

function log(msg) {
  console.log(`[auto-migrate] ${msg}`);
}

function fail(msg) {
  console.error(`[auto-migrate] ERROR: ${msg}`);
  process.exit(1);
}

// ── Step 0: Guard ──────────────────────────────────────────────────────────
if (!process.env.DATABASE_URL) {
  // Preview / non-production builds (e.g. Dependabot PRs on Vercel) get no
  // DATABASE_URL — it is scoped to the Production environment. There is no
  // database to migrate, so skip cleanly and let `next build` proceed instead
  // of failing the deploy and emailing a build-error on every PR. A PRODUCTION
  // build missing DATABASE_URL is a real misconfiguration and still fails loud.
  const vercelEnv = process.env.VERCEL_ENV;
  if (vercelEnv && vercelEnv !== 'production') {
    log(`No DATABASE_URL on a ${vercelEnv} build — skipping schema migration (nothing to migrate).`);
    process.exit(0);
  }
  fail('DATABASE_URL is not set. Cannot run schema migration.');
}

log('DATABASE_URL detected. Starting schema migration...');

// ── Connect via postgres.js (works with Neon, Supabase, any Postgres) ──────
const sql = postgres(process.env.DATABASE_URL, {
  max: 1,
  connect_timeout: 30,
  idle_timeout: 5,
});

// ── Step 1: Execute DDL directly (no drizzle-kit, no prompts) ──────────────
// Read every Drizzle migration file under drizzle/ in filename order and
// execute each statement individually. Files are expected to be named with
// a zero-padded sequence prefix (0000_..., 0001_..., 0002_..., etc.) so the
// filename sort matches the intended apply order. All statements use
// IF NOT EXISTS / IF EXISTS idempotent guards, and SAFE_CODES below covers
// the remaining "already applied" Postgres error codes, so re-running on an
// already-migrated database is a no-op.
log('Executing schema DDL...');

const migrationsDir = resolve(projectRoot, 'drizzle');
let migrationFiles;
try {
  migrationFiles = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
} catch (err) {
  fail(`Could not read migrations directory at ${migrationsDir}: ${err.message}`);
}

if (migrationFiles.length === 0) {
  fail(`No migration files found under ${migrationsDir}`);
}

log(`Found ${migrationFiles.length} migration file(s): ${migrationFiles.join(', ')}`);

const statements = [];
for (const filename of migrationFiles) {
  const content = readFileSync(resolve(migrationsDir, filename), 'utf8');
  // splitSqlStatements also strips full-line comments — REQUIRED, not
  // cosmetic: comment text is converted to the database encoding server-side,
  // and non-ASCII comment characters hard-fail on non-UTF8 databases (22P05
  // on WIN1252, the fresh-Windows embedded default), killing the whole chain.
  const fileStatements = splitSqlStatements(content);
  log(`  ${filename}: ${fileStatements.length} statements`);
  for (const stmt of fileStatements) statements.push(stmt);
}

log(`Total DDL statements across all migrations: ${statements.length}.`);

// Postgres error codes we can safely skip (idempotent re-runs):
const SAFE_CODES = new Set([
  '42P07', // duplicate_table
  '42P16', // invalid_table_definition (e.g. column already exists)
  '42701', // duplicate_column
  '42710', // duplicate_object (indexes, constraints)
  '42P10', // invalid_column_reference
  '23505', // unique_violation (for ON CONFLICT seed inserts)
]);

let created = 0;
let skipped = 0;
let pgvectorAvailable = null; // tri-state: null=unknown, true, false
// Tables we skipped because their CREATE TABLE required pgvector. Every
// later statement that only references one of these tables (index, FK,
// ALTER, policy) must also skip — otherwise it fails with 42P01 on a
// table that was never created.
const skippedTables = new Set();

/**
 * Returns the primary target of a DDL statement — the table being created,
 * altered, indexed on, or dropped. We skip statements whose primary target
 * is a pgvector-dependent table that was skipped upstream, regardless of
 * what else the statement references (FK targets, etc. — those are separate
 * tables and their own skip status is evaluated on their own statements).
 */
function primaryTargetTable(stmt) {
  const patterns = [
    /CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+"?(\w+)"?/i,
    /CREATE\s+(?:UNIQUE\s+)?INDEX(?:\s+CONCURRENTLY)?(?:\s+IF\s+NOT\s+EXISTS)?\s+\S+\s+ON\s+"?(\w+)"?/i,
    /ALTER\s+TABLE(?:\s+IF\s+EXISTS)?\s+"?(\w+)"?/i,
    /DROP\s+TABLE(?:\s+IF\s+EXISTS)?\s+"?(\w+)"?/i,
  ];
  for (const re of patterns) {
    const m = stmt.match(re);
    if (m) return m[1];
  }
  return null;
}

for (const stmt of statements) {
  // Enable pgvector on demand and remember whether it's available on this
  // database. CI Postgres images typically lack the pgvector extension;
  // in that case the vector-dependent statements are skipped deliberately
  // so the rest of the schema still lands.
  const needsVector = stmt.includes('vector(') && !stmt.startsWith('CREATE EXTENSION');
  if (needsVector && pgvectorAvailable === null) {
    try {
      await sql.unsafe('CREATE EXTENSION IF NOT EXISTS vector');
      pgvectorAvailable = true;
    } catch {
      pgvectorAvailable = false;
    }
  }
  if (needsVector && pgvectorAvailable === false) {
    // pgvector not installed — skip this statement. Record the primary
    // target (the table being created) so every subsequent ALTER / INDEX /
    // constraint that targets it is also skipped on its own turn.
    const target = primaryTargetTable(stmt);
    if (target) skippedTables.add(target);
    skipped++;
    continue;
  }

  // Skip statements whose primary target is a pgvector-dependent table
  // that was skipped. A FK / REFERENCES to an existing real table is
  // irrelevant — the statement still can't run because its own target
  // doesn't exist on this DB.
  if (skippedTables.size > 0) {
    const target = primaryTargetTable(stmt);
    if (target && skippedTables.has(target)) {
      skipped++;
      continue;
    }
  }

  try {
    await sql.unsafe(stmt);
    created++;
  } catch (err) {
    if (SAFE_CODES.has(err.code)) {
      skipped++;
      continue;
    }
    // Also handle "already exists" in the message (belt + suspenders)
    if (err.message?.includes('already exists')) {
      skipped++;
      continue;
    }
    // Real DDL failure — missing ref, syntax error, permission denied,
    // etc. Silently continuing produces a partial schema that the app
    // boots against, which is harder to diagnose than a loud failure.
    // Fail the deploy so the operator has to fix the DDL before ship.
    fail(`DDL statement failed (${err.code || 'unknown'}): ${err.message?.slice(0, 200)}`);
  }
}

log(`DDL complete: ${created} applied, ${skipped} skipped (already exist).`);

// ── Step 1b: Ensure columns on existing tables (schema drift fix) ──────────
// When tables already exist from an older deploy, CREATE TABLE is skipped but
// the old table may be missing columns added in later schema versions.
// ALTER TABLE ADD COLUMN IF NOT EXISTS is a no-op for columns that already exist.
log('Ensuring schema columns are up to date...');

let columnsAdded = 0;

for (const stmt of statements) {
  const tableMatch = stmt.match(/^CREATE TABLE\s+"(\w+)"\s*\(/i);
  if (!tableMatch) continue;
  const table = tableMatch[1];

  // Extract column lines: anything that starts with "column_name" type...
  // Stop at CONSTRAINT lines.
  const body = stmt.slice(stmt.indexOf('(') + 1, stmt.lastIndexOf(')'));
  const lines = body.split('\n').map((l) => l.trim().replace(/,\s*$/, ''));

  for (const line of lines) {
    if (!line.startsWith('"')) continue;
    // Parse: "col_name" type [DEFAULT ...] [NOT NULL]
    const colMatch = line.match(/^"(\w+)"\s+(.+)/);
    if (!colMatch) continue;

    const colName = colMatch[1];
    let rest = colMatch[2];
    // Strip trailing constraints that ALTER TABLE ADD COLUMN doesn't accept inline
    // Keep type + DEFAULT + NOT NULL but remove PRIMARY KEY / UNIQUE / CONSTRAINT
    rest = rest.replace(/\s*PRIMARY KEY.*/i, '');
    rest = rest.replace(/,\s*$/, '');

    try {
      await sql.unsafe(`ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "${colName}" ${rest}`);
      columnsAdded++;
    } catch {
      // Column already exists or type mismatch — skip silently
    }
  }
}

log(`Column sync complete: ${columnsAdded} ALTER statements executed (no-op if already present).`);

// ── Step 2: Seed org_default ───────────────────────────────────────────────
// The app requires at least one organization row with id='org_default'.
log('Checking for org_default seed...');

try {
  const created = await sql`
    INSERT INTO organizations (id, name, slug, plan)
    VALUES ('org_default', 'Default Organization', 'default', 'pro')
    ON CONFLICT (id) DO NOTHING
    RETURNING id
  `;
  if (created.length > 0) {
    // Only THIS run created the row (the inserting transaction is the only one
    // that gets it back) — seed the default pack once, at org birth. An org
    // that already existed is left alone so an operator's deletions in /policies
    // are never resurrected on the next deploy.
    log('org_default created — seeding catastrophe-only pack...');
    try {
      const { imported } = await seedCatastrophePack(sql, 'org_default');
      log(`Seeded catastrophe-only pack for org_default: ${imported} imported`);
    } catch (seedErr) {
      log(`Warning: Could not seed catastrophe-only pack — ${seedErr.message}`);
    }
  } else {
    log('org_default already existed — policies left as-is.');
  }
} catch (err) {
  // Non-fatal: log and continue. The app can still boot; setup page will guide user.
  log(`Warning: Could not seed org_default — ${err.message}`);
}

// Step 2b: the default packs never refuse outright (2026-08-21). Re-point any
// seeded "Block Mass-Destructive" row, in any org, at require_approval. Runs
// every deploy; matches the old name only, so it is a no-op once flipped.
try {
  const flipped = await holdMassDestructive(sql);
  log(`Mass-destructive line: ${flipped} seeded row(s) flipped from block to hold`);
} catch (err) {
  log(`Warning: Could not flip mass-destructive rows to hold — ${err.message}`);
}

// Step 2c: the mass-destructive line fires on the classifier's protected_target
// flag, not on the score (2026-08-21). Add the gate to any seeded row that
// predates it; a no-op once every row carries the key.
try {
  const gated = await gateMassDestructiveOnEvidence(sql);
  log(`Mass-destructive line: ${gated} seeded row(s) gated on protected_target evidence`);
} catch (err) {
  log(`Warning: Could not gate mass-destructive rows on evidence — ${err.message}`);
}

// ── Step 3: Optionally seed DASHCLAW_API_KEY ───────────────────────────────
// If the operator has pre-configured an API key via env var, register it.
const configuredKey = process.env.DASHCLAW_API_KEY;
const configuredOrgId = process.env.DASHCLAW_API_KEY_ORG || 'org_default';

if (configuredKey && configuredKey.startsWith('oc_live_')) {
  log('DASHCLAW_API_KEY detected — ensuring api_keys row exists...');

  const { createHash } = await import('node:crypto');
  const keyHash = createHash('sha256').update(configuredKey).digest('hex');
  const keyPrefix = configuredKey.slice(0, 16);

  try {
    // Ensure the target org exists before inserting the key (FK constraint).
    if (configuredOrgId !== 'org_default') {
      const created = await sql`
        INSERT INTO organizations (id, name, slug, plan)
        VALUES (${configuredOrgId}, ${configuredOrgId}, ${configuredOrgId}, 'pro')
        ON CONFLICT (id) DO NOTHING
        RETURNING id
      `;
      if (created.length > 0) {
        // Seed the default pack once, at org birth (same gate as org_default).
        try {
          const { imported } = await seedCatastrophePack(sql, configuredOrgId);
          log(`Seeded catastrophe-only pack for ${configuredOrgId}: ${imported} imported`);
        } catch (seedErr) {
          log(`Warning: Could not seed catastrophe-only pack — ${seedErr.message}`);
        }
      } else {
        log(`${configuredOrgId} already existed — policies left as-is.`);
      }
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
    log('api_keys row ensured.');
  } catch (err) {
    log(`Warning: Could not seed api_keys row — ${err.message}`);
  }
}

// Close the connection pool.
await sql.end({ timeout: 5 });

log('Auto-migration complete. Proceeding to next build.');
