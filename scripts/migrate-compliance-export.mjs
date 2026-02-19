#!/usr/bin/env node

import { createSqlFromEnv } from './_db.mjs';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const sql = createSqlFromEnv();

async function migrate() {
  console.log('[migrate-compliance-export] Starting compliance export migration...');

  // -- compliance_exports: scheduled and on-demand export records
  await sql`
    CREATE TABLE IF NOT EXISTS compliance_exports (
      id            TEXT PRIMARY KEY,
      org_id        TEXT NOT NULL,
      name          TEXT NOT NULL,
      frameworks    JSONB NOT NULL DEFAULT '[]',
      format        TEXT DEFAULT 'markdown',
      window_days   INTEGER DEFAULT 30,
      include_evidence BOOLEAN DEFAULT TRUE,
      include_remediation BOOLEAN DEFAULT TRUE,
      include_trends BOOLEAN DEFAULT FALSE,
      status        TEXT DEFAULT 'pending',
      report_content TEXT DEFAULT '',
      evidence_summary JSONB DEFAULT '{}',
      snapshot_ids  JSONB DEFAULT '[]',
      file_size_bytes INTEGER DEFAULT 0,
      error_message TEXT DEFAULT '',
      requested_by  TEXT DEFAULT 'user',
      started_at    TIMESTAMPTZ,
      completed_at  TIMESTAMPTZ,
      created_at    TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  console.log('[migrate-compliance-export] Created compliance_exports');

  // -- compliance_schedules: recurring export schedules
  await sql`
    CREATE TABLE IF NOT EXISTS compliance_schedules (
      id            TEXT PRIMARY KEY,
      org_id        TEXT NOT NULL,
      name          TEXT NOT NULL,
      frameworks    JSONB NOT NULL DEFAULT '[]',
      format        TEXT DEFAULT 'markdown',
      window_days   INTEGER DEFAULT 30,
      cron_expression TEXT NOT NULL,
      include_evidence BOOLEAN DEFAULT TRUE,
      include_remediation BOOLEAN DEFAULT TRUE,
      include_trends BOOLEAN DEFAULT FALSE,
      enabled       BOOLEAN DEFAULT TRUE,
      last_run_at   TIMESTAMPTZ,
      next_run_at   TIMESTAMPTZ,
      last_export_id TEXT DEFAULT '',
      created_at    TIMESTAMPTZ DEFAULT NOW(),
      updated_at    TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  console.log('[migrate-compliance-export] Created compliance_schedules');

  // Indexes
  await sql`CREATE INDEX IF NOT EXISTS idx_compliance_exports_org ON compliance_exports(org_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_compliance_exports_status ON compliance_exports(org_id, status)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_compliance_exports_created ON compliance_exports(created_at)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_compliance_schedules_org ON compliance_schedules(org_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_compliance_schedules_enabled ON compliance_schedules(org_id, enabled)`;

  // Ensure compliance_snapshots table exists (may already exist)
  await sql`
    CREATE TABLE IF NOT EXISTS compliance_snapshots (
      id                  TEXT PRIMARY KEY,
      org_id              TEXT NOT NULL,
      framework           TEXT NOT NULL,
      total_controls      INTEGER DEFAULT 0,
      covered             INTEGER DEFAULT 0,
      partial             INTEGER DEFAULT 0,
      gaps                INTEGER DEFAULT 0,
      coverage_percentage INTEGER DEFAULT 0,
      risk_level          TEXT DEFAULT 'UNKNOWN',
      full_report         TEXT,
      created_at          TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  console.log('[migrate-compliance-export] Ensured compliance_snapshots exists');

  console.log('[migrate-compliance-export] Migration complete.');
  process.exit(0);
}

migrate().catch(err => {
  console.error('[migrate-compliance-export] Migration failed:', err);
  process.exit(1);
});
