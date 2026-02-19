#!/usr/bin/env node

import { createSqlFromEnv } from './_db.mjs';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const sql = createSqlFromEnv();

async function migrate() {
  console.log('[migrate-feedback] Starting feedback migration...');

  // -- feedback: individual feedback entries tied to action traces
  await sql`
    CREATE TABLE IF NOT EXISTS feedback (
      id            TEXT PRIMARY KEY,
      org_id        TEXT NOT NULL,
      action_id     TEXT DEFAULT '',
      agent_id      TEXT DEFAULT '',
      source        TEXT DEFAULT 'user',
      rating        INTEGER CHECK (rating >= 1 AND rating <= 5),
      sentiment     TEXT DEFAULT 'neutral',
      category      TEXT DEFAULT 'general',
      comment       TEXT DEFAULT '',
      tags          JSONB DEFAULT '[]',
      metadata      JSONB DEFAULT '{}',
      resolved      BOOLEAN DEFAULT FALSE,
      resolved_at   TIMESTAMPTZ,
      resolved_by   TEXT DEFAULT '',
      created_by    TEXT DEFAULT '',
      created_at    TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  console.log('[migrate-feedback] Created feedback');

  // -- feedback_summaries: periodic aggregated summaries by agent/category
  await sql`
    CREATE TABLE IF NOT EXISTS feedback_summaries (
      id            TEXT PRIMARY KEY,
      org_id        TEXT NOT NULL,
      agent_id      TEXT DEFAULT '',
      category      TEXT DEFAULT 'general',
      period        TEXT DEFAULT 'daily',
      period_start  TIMESTAMPTZ NOT NULL,
      period_end    TIMESTAMPTZ NOT NULL,
      total_count   INTEGER DEFAULT 0,
      avg_rating    REAL DEFAULT 0,
      sentiment_dist JSONB DEFAULT '{}',
      top_tags      JSONB DEFAULT '[]',
      summary_text  TEXT DEFAULT '',
      created_at    TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  console.log('[migrate-feedback] Created feedback_summaries');

  // Indexes
  await sql`CREATE INDEX IF NOT EXISTS idx_feedback_org ON feedback(org_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_feedback_action ON feedback(action_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_feedback_agent ON feedback(agent_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_feedback_rating ON feedback(org_id, rating)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_feedback_category ON feedback(org_id, category)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback(created_at)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_feedback_resolved ON feedback(org_id, resolved)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_feedback_summaries_period ON feedback_summaries(org_id, period, period_start)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_feedback_summaries_agent ON feedback_summaries(agent_id)`;

  console.log('[migrate-feedback] Migration complete.');
  process.exit(0);
}

migrate().catch(err => {
  console.error('[migrate-feedback] Migration failed:', err);
  process.exit(1);
});
