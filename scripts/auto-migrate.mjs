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
import { runSchemaMigrations } from '../app/lib/setup/migration-runner.mjs';
import { seedCatastrophePack, holdMassDestructive, gateMassDestructiveOnEvidence, seedLateAddedPackLines } from '../app/lib/setup/catastrophe-pack.mjs';

// Load .env / .env.local if present (no-op in Vercel where vars are injected).
import { ENV_LOAD_REPORT } from './_load-env.mjs';

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

function classifyDatabaseTarget(url) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') return 'local-postgres';
    if (hostname.endsWith('.neon.tech')) return 'managed-neon';
    return 'managed-or-remote-postgres';
  } catch {
    return 'unclassified-postgres';
  }
}

const runtimeEnvironment = process.env.VERCEL_ENV || process.env.NODE_ENV || 'local';
log(`Migration target: environment=${runtimeEnvironment}; database=${classifyDatabaseTarget(process.env.DATABASE_URL)}; configuration=${ENV_LOAD_REPORT.databaseSource}.`);

// ── Connect via postgres.js (works with Neon, Supabase, any Postgres) ──────
const sql = postgres(process.env.DATABASE_URL, {
  max: 1,
  connect_timeout: 30,
  idle_timeout: 5,
});

// ── Step 1: Execute DDL directly (no drizzle-kit, no prompts) ──────────────
// Read every Drizzle migration file under drizzle/ in filename order and
// execute each unapplied file under one serialized transaction. Files are expected to be named with
// a zero-padded sequence prefix (0000_..., 0001_..., 0002_..., etc.) so the
// filename sort matches the intended apply order. All statements use
// IF NOT EXISTS / IF EXISTS idempotent guards. The migration ledger makes
// ordinary re-runs a no-op; precise duplicate-object codes cover adoption by
// legacy databases that predate the ledger.
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

const migrations = migrationFiles.map((filename) => ({
  filename,
  content: readFileSync(resolve(migrationsDir, filename), 'utf8'),
}));
try {
  const result = await runSchemaMigrations(sql, migrations);
  log(`Migration ledger: ${result.migrationsApplied} applied, ${result.migrationsAlreadyApplied} already applied.`);
  log(`DDL complete: ${result.appliedStatements} applied, ${result.alreadyAppliedStatements} precise legacy/optional skips.`);
  log(`Column sync complete: ${result.reconciledColumns} strict ALTER statements executed (no-op if already present).`);
} catch (err) {
  try { await sql.end({ timeout: 2 }); } catch { /* connection teardown only */ }
  fail(err.message);
}

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

// Step 2d: pack lines added after an org was seeded (the real-money spend
// line, 2026-09-04) land in every org that carries the pack. No-op once
// every such org holds the line.
try {
  const added = await seedLateAddedPackLines(sql);
  log(`Catastrophe pack: ${added} late-added line(s) seeded into existing orgs`);
} catch (err) {
  log(`Warning: Could not seed late-added pack lines — ${err.message}`);
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
