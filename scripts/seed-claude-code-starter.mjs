#!/usr/bin/env node

// Seeds the "claude-code-starter" policy pack into an existing DashClaw
// instance. Idempotent — skips any policy whose name already exists in the
// target org. Intended for instances that existed before the pack shipped.
//
// Usage:
//   node scripts/seed-claude-code-starter.mjs [--org=<org_id>]
//
// If --org is omitted, seeds into 'org_default'.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import * as jsYaml from 'js-yaml';
import { createSqlFromEnv } from './_db.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const orgFlag = process.argv.find((a) => a.startsWith('--org='));
const orgId = orgFlag ? orgFlag.slice('--org='.length) : 'org_default';

const packPath = join(__dirname, '..', 'app', 'lib', 'guardrails', 'packs', 'claude-code-starter', 'policies.yml');
const pack = jsYaml.load(readFileSync(packPath, 'utf-8'));

const sql = createSqlFromEnv();

async function run() {
  let imported = 0;
  let skipped = 0;

  for (const policy of pack.policies) {
    const name = policy.description || policy.id;
    const existing = await sql`
      SELECT id FROM guard_policies
      WHERE org_id = ${orgId} AND name = ${name}
      LIMIT 1
    `;

    if (existing.length > 0) {
      console.log(`  skip  ${name} (already exists)`);
      skipped += 1;
      continue;
    }

    const id = `gp_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
    const now = new Date().toISOString();
    const rules = JSON.stringify(policy.rules);

    await sql`
      INSERT INTO guard_policies (id, org_id, name, policy_type, rules, active, created_at, updated_at)
      VALUES (${id}, ${orgId}, ${name}, ${policy.policy_type}, ${rules}, 1, ${now}, ${now})
    `;
    console.log(`  add   ${name}`);
    imported += 1;
  }

  console.log(`\nSeeded claude-code-starter into org=${orgId}: ${imported} imported, ${skipped} skipped.`);
  if (typeof sql.end === 'function') await sql.end();
}

run().catch((err) => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
