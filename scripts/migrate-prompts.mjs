#!/usr/bin/env node

import { createSqlFromEnv } from './_db.mjs';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const sql = createSqlFromEnv();

async function migrate() {
  console.log('[migrate-prompts] Starting prompt management migration...');

  // -- prompt_templates: the registry of prompt definitions
  await sql`
    CREATE TABLE IF NOT EXISTS prompt_templates (
      id            TEXT PRIMARY KEY,
      org_id        TEXT NOT NULL,
      name          TEXT NOT NULL,
      description   TEXT DEFAULT '',
      category      TEXT DEFAULT 'general',
      created_at    TIMESTAMPTZ DEFAULT NOW(),
      updated_at    TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  console.log('[migrate-prompts] Created prompt_templates');

  // -- prompt_versions: immutable versions of each template
  await sql`
    CREATE TABLE IF NOT EXISTS prompt_versions (
      id            TEXT PRIMARY KEY,
      org_id        TEXT NOT NULL,
      template_id   TEXT NOT NULL REFERENCES prompt_templates(id) ON DELETE CASCADE,
      version       INTEGER NOT NULL DEFAULT 1,
      content       TEXT NOT NULL,
      model_hint    TEXT DEFAULT '',
      parameters    JSONB DEFAULT '[]',
      changelog     TEXT DEFAULT '',
      is_active     BOOLEAN DEFAULT FALSE,
      created_by    TEXT DEFAULT 'system',
      created_at    TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  console.log('[migrate-prompts] Created prompt_versions');

  // -- prompt_runs: tracking prompt version usage tied to actions
  await sql`
    CREATE TABLE IF NOT EXISTS prompt_runs (
      id            TEXT PRIMARY KEY,
      org_id        TEXT NOT NULL,
      template_id   TEXT NOT NULL REFERENCES prompt_templates(id) ON DELETE CASCADE,
      version_id    TEXT NOT NULL REFERENCES prompt_versions(id) ON DELETE CASCADE,
      action_id     TEXT DEFAULT '',
      agent_id      TEXT DEFAULT '',
      input_vars    JSONB DEFAULT '{}',
      rendered      TEXT DEFAULT '',
      tokens_used   INTEGER DEFAULT 0,
      latency_ms    INTEGER DEFAULT 0,
      outcome       TEXT DEFAULT '',
      created_at    TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  console.log('[migrate-prompts] Created prompt_runs');

  // Indexes
  await sql`CREATE INDEX IF NOT EXISTS idx_prompt_templates_org ON prompt_templates(org_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_prompt_versions_template ON prompt_versions(template_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_prompt_versions_active ON prompt_versions(template_id, is_active)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_prompt_runs_template ON prompt_runs(template_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_prompt_runs_version ON prompt_runs(version_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_prompt_runs_action ON prompt_runs(action_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_prompt_runs_agent ON prompt_runs(agent_id)`;

  console.log('[migrate-prompts] Migration complete.');
  process.exit(0);
}

migrate().catch(err => {
  console.error('[migrate-prompts] Migration failed:', err);
  process.exit(1);
});
