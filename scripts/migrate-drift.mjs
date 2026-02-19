#!/usr/bin/env node

import { createSqlFromEnv } from './_db.mjs';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const sql = createSqlFromEnv();

async function migrate() {
  console.log('[migrate-drift] Starting drift detection migration...');

  // -- drift_baselines: statistical baselines computed from historical data
  await sql`
    CREATE TABLE IF NOT EXISTS drift_baselines (
      id            TEXT PRIMARY KEY,
      org_id        TEXT NOT NULL,
      agent_id      TEXT NOT NULL,
      metric        TEXT NOT NULL,
      dimension     TEXT DEFAULT 'overall',
      period_start  TIMESTAMPTZ NOT NULL,
      period_end    TIMESTAMPTZ NOT NULL,
      sample_count  INTEGER DEFAULT 0,
      mean          REAL DEFAULT 0,
      stddev        REAL DEFAULT 0,
      median        REAL DEFAULT 0,
      p5            REAL DEFAULT 0,
      p25           REAL DEFAULT 0,
      p75           REAL DEFAULT 0,
      p95           REAL DEFAULT 0,
      min_val       REAL DEFAULT 0,
      max_val       REAL DEFAULT 0,
      distribution  JSONB DEFAULT '{}',
      created_at    TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  console.log('[migrate-drift] Created drift_baselines');

  // -- drift_alerts: detected drift events
  await sql`
    CREATE TABLE IF NOT EXISTS drift_alerts (
      id            TEXT PRIMARY KEY,
      org_id        TEXT NOT NULL,
      agent_id      TEXT NOT NULL,
      metric        TEXT NOT NULL,
      dimension     TEXT DEFAULT 'overall',
      severity      TEXT DEFAULT 'info',
      drift_type    TEXT DEFAULT 'shift',
      baseline_mean REAL DEFAULT 0,
      baseline_stddev REAL DEFAULT 0,
      current_mean  REAL DEFAULT 0,
      current_stddev REAL DEFAULT 0,
      z_score       REAL DEFAULT 0,
      pct_change    REAL DEFAULT 0,
      sample_count  INTEGER DEFAULT 0,
      direction     TEXT DEFAULT 'unknown',
      description   TEXT DEFAULT '',
      acknowledged  BOOLEAN DEFAULT FALSE,
      acknowledged_by TEXT DEFAULT '',
      acknowledged_at TIMESTAMPTZ,
      baseline_id   TEXT DEFAULT '',
      created_at    TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  console.log('[migrate-drift] Created drift_alerts');

  // -- drift_snapshots: periodic metric snapshots for trend visualization
  await sql`
    CREATE TABLE IF NOT EXISTS drift_snapshots (
      id            TEXT PRIMARY KEY,
      org_id        TEXT NOT NULL,
      agent_id      TEXT DEFAULT '',
      metric        TEXT NOT NULL,
      dimension     TEXT DEFAULT 'overall',
      period        TEXT DEFAULT 'daily',
      period_start  TIMESTAMPTZ NOT NULL,
      mean          REAL DEFAULT 0,
      stddev        REAL DEFAULT 0,
      sample_count  INTEGER DEFAULT 0,
      created_at    TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  console.log('[migrate-drift] Created drift_snapshots');

  // Indexes
  await sql`CREATE INDEX IF NOT EXISTS idx_drift_baselines_org ON drift_baselines(org_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_drift_baselines_agent ON drift_baselines(org_id, agent_id, metric)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_drift_alerts_org ON drift_alerts(org_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_drift_alerts_severity ON drift_alerts(org_id, severity)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_drift_alerts_agent ON drift_alerts(org_id, agent_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_drift_alerts_ack ON drift_alerts(org_id, acknowledged)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_drift_alerts_created ON drift_alerts(created_at)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_drift_snapshots_org ON drift_snapshots(org_id, metric, period_start)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_drift_snapshots_agent ON drift_snapshots(org_id, agent_id, metric)`;

  console.log('[migrate-drift] Migration complete.');
  process.exit(0);
}

migrate().catch(err => {
  console.error('[migrate-drift] Migration failed:', err);
  process.exit(1);
});
