#!/usr/bin/env node

import { createSqlFromEnv } from './_db.mjs';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const sql = createSqlFromEnv();

async function migrate() {
  console.log('[migrate-learning-analytics] Starting learning analytics migration...');

  // -- learning_velocity: periodic velocity snapshots (how fast agents learn)
  await sql`
    CREATE TABLE IF NOT EXISTS learning_velocity (
      id            TEXT PRIMARY KEY,
      org_id        TEXT NOT NULL,
      agent_id      TEXT NOT NULL,
      period        TEXT DEFAULT 'daily',
      period_start  TIMESTAMPTZ NOT NULL,
      period_end    TIMESTAMPTZ NOT NULL,
      episode_count INTEGER DEFAULT 0,
      avg_score     REAL DEFAULT 0,
      success_rate  REAL DEFAULT 0,
      score_delta   REAL DEFAULT 0,
      velocity      REAL DEFAULT 0,
      acceleration  REAL DEFAULT 0,
      maturity_score REAL DEFAULT 0,
      maturity_level TEXT DEFAULT 'novice',
      created_at    TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  console.log('[migrate-learning-analytics] Created learning_velocity');

  // -- learning_curves: time-series score data per agent+action_type for curve plotting
  await sql`
    CREATE TABLE IF NOT EXISTS learning_curves (
      id            TEXT PRIMARY KEY,
      org_id        TEXT NOT NULL,
      agent_id      TEXT NOT NULL,
      action_type   TEXT NOT NULL,
      window_start  TIMESTAMPTZ NOT NULL,
      window_end    TIMESTAMPTZ NOT NULL,
      episode_count INTEGER DEFAULT 0,
      avg_score     REAL DEFAULT 0,
      success_rate  REAL DEFAULT 0,
      avg_duration_ms REAL DEFAULT 0,
      avg_cost      REAL DEFAULT 0,
      p25_score     REAL DEFAULT 0,
      p75_score     REAL DEFAULT 0,
      created_at    TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  console.log('[migrate-learning-analytics] Created learning_curves');

  // Indexes
  await sql`CREATE INDEX IF NOT EXISTS idx_learning_velocity_org ON learning_velocity(org_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_learning_velocity_agent ON learning_velocity(org_id, agent_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_learning_velocity_period ON learning_velocity(org_id, period_start)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_learning_curves_org ON learning_curves(org_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_learning_curves_agent ON learning_curves(org_id, agent_id, action_type)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_learning_curves_window ON learning_curves(org_id, window_start)`;

  console.log('[migrate-learning-analytics] Migration complete.');
  process.exit(0);
}

migrate().catch(err => {
  console.error('[migrate-learning-analytics] Migration failed:', err);
  process.exit(1);
});
