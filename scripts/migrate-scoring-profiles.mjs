#!/usr/bin/env node

/**
 * Migration: Scoring Profiles (Phase 7)
 *
 * Creates tables for user-defined weighted scoring profiles,
 * computed profile scores, and automatic risk templates.
 *
 * Usage:
 *   DATABASE_URL=<your_url> node scripts/migrate-scoring-profiles.mjs
 */

import './_load-env.mjs';
import { createSqlFromEnv } from './_db.mjs';

async function migrate() {
  const sql = createSqlFromEnv();

  console.log('[migrate] Creating scoring_profiles table...');
  await sql`
    CREATE TABLE IF NOT EXISTS scoring_profiles (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      action_type TEXT DEFAULT NULL,
      status TEXT DEFAULT 'active' CHECK (status IN ('active', 'archived')),
      composite_method TEXT DEFAULT 'weighted_average'
        CHECK (composite_method IN ('weighted_average', 'minimum', 'geometric_mean')),
      metadata JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    )
  `;

  console.log('[migrate] Creating scoring_dimensions table...');
  await sql`
    CREATE TABLE IF NOT EXISTS scoring_dimensions (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      profile_id TEXT NOT NULL REFERENCES scoring_profiles(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      weight REAL NOT NULL DEFAULT 1.0 CHECK (weight >= 0 AND weight <= 1),
      data_source TEXT NOT NULL CHECK (data_source IN (
        'metadata_field', 'duration_ms', 'cost_estimate', 'tokens_total',
        'risk_score', 'confidence', 'eval_score', 'custom_function'
      )),
      data_config JSONB DEFAULT '{}',
      scale JSONB NOT NULL DEFAULT '[]',
      sort_order INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT now()
    )
  `;

  console.log('[migrate] Creating profile_scores table...');
  await sql`
    CREATE TABLE IF NOT EXISTS profile_scores (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      profile_id TEXT NOT NULL REFERENCES scoring_profiles(id) ON DELETE CASCADE,
      action_id TEXT DEFAULT NULL,
      agent_id TEXT DEFAULT NULL,
      composite_score REAL NOT NULL CHECK (composite_score >= 0 AND composite_score <= 100),
      dimension_scores JSONB NOT NULL DEFAULT '[]',
      metadata JSONB DEFAULT '{}',
      scored_at TIMESTAMPTZ DEFAULT now()
    )
  `;

  console.log('[migrate] Creating risk_templates table...');
  await sql`
    CREATE TABLE IF NOT EXISTS risk_templates (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      action_type TEXT DEFAULT NULL,
      base_risk INTEGER NOT NULL DEFAULT 0 CHECK (base_risk >= 0 AND base_risk <= 100),
      rules JSONB NOT NULL DEFAULT '[]',
      status TEXT DEFAULT 'active' CHECK (status IN ('active', 'archived')),
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    )
  `;

  // Indexes
  console.log('[migrate] Creating indexes...');
  await sql`CREATE INDEX IF NOT EXISTS idx_scoring_profiles_org ON scoring_profiles(org_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_scoring_profiles_action_type ON scoring_profiles(org_id, action_type)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_scoring_dimensions_profile ON scoring_dimensions(profile_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_profile_scores_profile ON profile_scores(profile_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_profile_scores_action ON profile_scores(action_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_profile_scores_agent ON profile_scores(org_id, agent_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_profile_scores_scored_at ON profile_scores(scored_at)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_risk_templates_org ON risk_templates(org_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_risk_templates_action_type ON risk_templates(org_id, action_type)`;

  console.log('[migrate] Done  --  scoring_profiles, scoring_dimensions, profile_scores, risk_templates created.');
  if (sql.end) await sql.end();
}

migrate().catch((err) => {
  console.error('[migrate] Failed:', err.message);
  process.exit(1);
});
