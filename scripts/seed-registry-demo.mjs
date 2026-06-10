#!/usr/bin/env node

/**
 * Seed a working Agent Registry demo: an echo capability (targeting this
 * deployment's own public /api/echo route — no external network dependency),
 * a registered "Demo Echo Provider", and the grouping between them. After
 * seeding, the registry page's Invoke panel can fire a real governed call
 * whose decision lands in /decisions.
 *
 * Usage:
 *   node scripts/seed-registry-demo.mjs
 *   node scripts/seed-registry-demo.mjs --org-id org_default
 *
 * Environment:
 *   DATABASE_URL   - Postgres connection string (auto-loaded from .env.local)
 *   DASHCLAW_URL   - public base URL of this deployment (the echo target).
 *                    Note: the capability runtime's SSRF guard blocks
 *                    private/loopback hosts, so invoking the echo capability
 *                    only works on a publicly reachable deployment.
 *
 * Idempotent — safe to run multiple times.
 */

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

import crypto from 'node:crypto';
import './_load-env.mjs';
import { createSqlFromEnv } from './_db.mjs';

const args = process.argv.slice(2);
const orgIdIdx = args.indexOf('--org-id');
const ORG_ID = orgIdIdx !== -1 ? args[orgIdIdx + 1] : (process.env.ORG_ID || 'org_default');
const BASE_URL = (process.env.DASHCLAW_BASE_URL || process.env.DASHCLAW_URL || 'https://your-deployment.example.com').replace(/\/$/, '');

const CAP_SLUG = 'demo-echo';
const AGENT_SLUG = 'demo-echo-provider';

async function main() {
  const sql = createSqlFromEnv();

  console.log('\n[seed-registry-demo] Seeding the registry demo...');
  console.log(`  org:  ${ORG_ID}`);
  console.log(`  echo: ${BASE_URL}/api/echo\n`);

  // 1. Echo capability (idempotent on org+slug)
  let capRows = await sql`
    SELECT capability_id FROM capabilities WHERE org_id = ${ORG_ID} AND slug = ${CAP_SLUG}
  `;
  let capabilityId = capRows[0]?.capability_id;
  if (capabilityId) {
    console.log(`  Capability ${CAP_SLUG} already exists (${capabilityId}). Skipping.`);
  } else {
    capabilityId = `cap_${crypto.randomUUID()}`;
    const invocationSchema = JSON.stringify({
      endpoint: `${BASE_URL}/api/echo`,
      method: 'POST',
      auth: { type: 'none' },
      timeout_ms: 10000,
      request_mapping: { message: '$.message' },
      response_mapping: { received: '$.received', at: '$.at' },
    });
    await sql`
      INSERT INTO capabilities (
        capability_id, org_id, name, slug, description, category, source_type,
        auth_type, risk_level, requires_approval, tags_json, pricing_json,
        health_status, invocation_schema_json
      ) VALUES (
        ${capabilityId}, ${ORG_ID}, 'Demo Echo', ${CAP_SLUG},
        'Demo capability that POSTs to this deployment''s own /api/echo and returns {received: true}. Exists so the registry loop can be exercised end-to-end without external services.',
        'demo', 'http_api', 'none', 'low', 0, '["demo","echo"]',
        '{"model":"per_call","estimated_cost_usd":0}', 'unknown', ${invocationSchema}
      )
    `;
    console.log(`  Created capability Demo Echo (${capabilityId})`);
  }

  // 2. Registered demo provider (idempotent on org+slug)
  let agentRows = await sql`
    SELECT entry_id FROM registered_agents WHERE org_id = ${ORG_ID} AND slug = ${AGENT_SLUG}
  `;
  let entryId = agentRows[0]?.entry_id;
  if (entryId) {
    console.log(`  Registered agent ${AGENT_SLUG} already exists (${entryId}). Skipping.`);
  } else {
    entryId = `ra_${crypto.randomUUID()}`;
    await sql`
      INSERT INTO registered_agents (entry_id, org_id, name, slug, endpoint, auth_type, risk_class, default_budget_usd, status)
      VALUES (${entryId}, ${ORG_ID}, 'Demo Echo Provider', ${AGENT_SLUG}, ${BASE_URL + '/api/echo'}, 'none', 'low', 0, 'active')
    `;
    console.log(`  Registered Demo Echo Provider (${entryId})`);
  }

  // 3. Group the capability under the provider (idempotent via unique constraint)
  await sql`
    INSERT INTO registered_agent_capabilities (id, org_id, registered_agent_id, capability_id)
    VALUES (${'rac_' + crypto.randomUUID()}, ${ORG_ID}, ${entryId}, ${capabilityId})
    ON CONFLICT ON CONSTRAINT registered_agent_capabilities_unique DO NOTHING
  `;
  console.log('  Grouped Demo Echo under Demo Echo Provider.');

  console.log('\n  Done. Open /agents/registry, select "Demo Echo Provider", and use');
  console.log('  the Invoke panel with payload {"message": "hello"} — the governed');
  console.log('  decision lands in /decisions. (Invoking requires a publicly');
  console.log('  reachable deployment; the SSRF guard blocks localhost targets.)\n');

  await sql.end?.();
}

main();
