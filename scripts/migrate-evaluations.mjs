#!/usr/bin/env node

/**
 * Evaluation Framework Migration
 *
 * Creates eval_scorers, eval_scores, eval_runs tables.
 * Idempotent   safe to run multiple times.
 *
 * Usage:
 *   DATABASE_URL=<db_url> node scripts/migrate-evaluations.mjs
 */

import './_load-env.mjs';
import { createSqlFromEnv } from './_db.mjs';

async function migrate() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  console.log('\n=== Evaluation Framework Migration ===\n');
  const sql = createSqlFromEnv();

  try {
    // 1. eval_scorers   reusable scorer definitions
    console.log('1. Creating eval_scorers table...');
    await sql`
      CREATE TABLE IF NOT EXISTS eval_scorers (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        name TEXT NOT NULL,
        scorer_type TEXT NOT NULL,
        config TEXT,
        description TEXT,
        created_by TEXT,
        created_at TEXT,
        updated_at TEXT
      )
    `;
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_eval_scorers_org_name ON eval_scorers(org_id, name)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_eval_scorers_org ON eval_scorers(org_id)`;
    console.log('  [OK] eval_scorers ready');

    // 2. eval_scores   individual evaluation scores linked to actions
    console.log('2. Creating eval_scores table...');
    await sql`
      CREATE TABLE IF NOT EXISTS eval_scores (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        action_id TEXT NOT NULL,
        scorer_id TEXT,
        scorer_name TEXT NOT NULL,
        score REAL NOT NULL,
        label TEXT,
        reasoning TEXT,
        metadata TEXT,
        evaluated_by TEXT,
        created_at TEXT
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_eval_scores_org ON eval_scores(org_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_eval_scores_action ON eval_scores(action_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_eval_scores_scorer ON eval_scores(scorer_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_eval_scores_org_scorer_name ON eval_scores(org_id, scorer_name)`;
    console.log('  [OK] eval_scores ready');

    // 3. eval_runs   batch evaluation runs
    console.log('3. Creating eval_runs table...');
    await sql`
      CREATE TABLE IF NOT EXISTS eval_runs (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL,
        name TEXT NOT NULL,
        scorer_id TEXT,
        status TEXT DEFAULT 'pending',
        total_actions INTEGER,
        scored_count INTEGER DEFAULT 0,
        avg_score REAL,
        summary TEXT,
        error_message TEXT,
        filter_criteria TEXT,
        started_at TEXT,
        completed_at TEXT,
        created_by TEXT,
        created_at TEXT
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_eval_runs_org ON eval_runs(org_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_eval_runs_org_status ON eval_runs(org_id, status)`;
    console.log('  [OK] eval_runs ready');

    console.log('\n[OK] Evaluation Framework Migration complete!');
  } catch (err) {
    console.error('[FAIL] Migration failed:', err.message);
    process.exit(1);
  }
}

migrate();
