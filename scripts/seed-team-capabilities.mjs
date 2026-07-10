#!/usr/bin/env node

// Seeds the Team Protocol Phase-3 first-wave credential capabilities
// (spec: clawd docs/superpowers/specs/2026-07-09-team-protocol-design.md §7).
// Idempotent — skips any capability whose (org_id, slug) already exists.
//
// Usage:
//   node scripts/seed-team-capabilities.mjs [--org=<org_id>]
//
// If --org is omitted, seeds into 'org_default'.

import { randomUUID } from 'node:crypto';
import { createSqlFromEnv } from './_db.mjs';

const orgFlag = process.argv.find((a) => a.startsWith('--org='));
const orgId = orgFlag ? orgFlag.slice('--org='.length) : 'org_default';

// All Tier 2: requires_approval on every row; wrappers are dry-run by default.
const CAPABILITIES = [
  {
    slug: 'post-to-x',
    name: 'Post to X',
    description: 'Post a tweet via X API v2 (OAuth 1.0a user context). Pay-per-use; wrapper: clawd tools/post-to-x.',
    category: 'social',
    risk_level: 'high',
    pricing: { model: 'per_post', estimate_usd: 0.015, estimate_with_url_usd: 0.2 },
    schema: { type: 'object', required: ['text'], properties: { text: { type: 'string', maxLength: 280 } } },
  },
  {
    slug: 'post-to-linkedin-personal',
    name: 'Post to LinkedIn (personal profile)',
    description: 'Share a post on the personal profile via w_member_social OAuth. Personal profile ONLY — company pages are out of scope (partner-gated).',
    category: 'social',
    risk_level: 'high',
    pricing: { model: 'free' },
    schema: { type: 'object', required: ['text'], properties: { text: { type: 'string', maxLength: 3000 } } },
  },
  {
    slug: 'post-to-reddit',
    name: 'Post to Reddit',
    description: 'Submit a post via Reddit OAuth (free tier). Platform norms enforced by protocol: must survive as a non-marketing post.',
    category: 'social',
    risk_level: 'high',
    pricing: { model: 'free' },
    schema: { type: 'object', required: ['subreddit', 'title'], properties: { subreddit: { type: 'string' }, title: { type: 'string' }, body: { type: 'string' } } },
  },
  {
    slug: 'send-email',
    name: 'Send email (per-agent identity)',
    description: 'Send email from the invoking agent’s own address (claude@ / moltfire@practicalsystems.io). Wrapper-enforced CC to Wes and AI-agent signature on every send.',
    category: 'email',
    risk_level: 'high',
    pricing: { model: 'free' },
    schema: { type: 'object', required: ['to', 'subject', 'body'], properties: { to: { type: 'string' }, subject: { type: 'string' }, body: { type: 'string' } } },
  },
];

const sql = createSqlFromEnv();

async function run() {
  let imported = 0;
  let skipped = 0;

  for (const cap of CAPABILITIES) {
    const existing = await sql`
      SELECT capability_id FROM capabilities
      WHERE org_id = ${orgId} AND slug = ${cap.slug}
      LIMIT 1
    `;

    if (existing.length > 0) {
      console.log(`  skip  ${cap.slug} (already exists)`);
      skipped += 1;
      continue;
    }

    const id = `cap_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
    const now = new Date().toISOString();

    await sql`
      INSERT INTO capabilities (
        capability_id, org_id, name, slug, description, category,
        source_type, auth_type, risk_level, requires_approval,
        tags_json, pricing_json, health_status, invocation_schema_json,
        created_at, updated_at
      )
      VALUES (
        ${id}, ${orgId}, ${cap.name}, ${cap.slug}, ${cap.description}, ${cap.category},
        'internal_sdk', 'api_key', ${cap.risk_level}, 1,
        ${JSON.stringify(['team-protocol', 'phase-3'])}, ${JSON.stringify(cap.pricing)},
        'unknown', ${JSON.stringify(cap.schema)},
        ${now}, ${now}
      )
    `;
    console.log(`  add   ${cap.slug}`);
    imported += 1;
  }

  console.log(`\nSeeded team capabilities into org=${orgId}: ${imported} imported, ${skipped} skipped.`);
  if (typeof sql.end === 'function') await sql.end();
}

run().catch((err) => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
