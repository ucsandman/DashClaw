#!/usr/bin/env node
/**
 * cross-org-smoke.mjs — live cross-org isolation suite against a running DashClaw.
 *
 * Seeds TWO run-unique orgs (A and B) with their own DB-minted API keys, creates
 * governance resources in org A over real HTTP, then proves org B's key cannot
 * read, mutate, enumerate, approve, or consume any of them. This is the
 * behavioral pin for the org-isolation invariant the repositories enforce with
 * `WHERE org_id = $1` (see docs/architecture/trust-and-failure-model.md).
 *
 * Usage:
 *   node scripts/cross-org-smoke.mjs [baseUrl]      # default http://localhost:3000
 *
 * Requirements:
 *   - DATABASE_URL pointing at the SAME database the target server uses
 *     (.env.local locally; the job env in CI).
 *   - The server must resolve DB-minted keys: Neon HTTP path on hosted, the
 *     internal resolve-key route on self-host Postgres (both are the default).
 *
 * Isolation: both orgs, their keys, and every row they create are run-unique
 * and deleted at the end (dependency-order sweep over every table that has an
 * org_id column, discovered from information_schema).
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { createSqlFromEnv } from './_db.mjs';

// --- env (same contract as policy-smoke.mjs) ---
// .env.local wins over inherited machine env locally; CI has no .env.local and
// uses the job env. Machine-level DASHCLAW_* vars can point at prod — drop them.
const inheritedEnv = { ...process.env };
for (const k of Object.keys(process.env)) {
  if (k.startsWith('DASHCLAW_')) delete process.env[k];
}
try {
  const envFile = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8');
  for (const line of envFile.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch {
  console.log('note: no .env.local — using the inherited environment (CI mode)');
  process.env.DATABASE_URL = process.env.DATABASE_URL || inheritedEnv.DATABASE_URL;
}

const BASE = process.argv[2] || 'http://localhost:3000';
const RUN = Date.now().toString(36);
const results = [];

function check(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${pass ? '' : ` — ${detail}`}`);
}

function keyed(key) {
  return async (method, path, body) => {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { 'x-api-key': key, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let json = null;
    try { json = await res.json(); } catch { /* some endpoints return empty */ }
    return { status: res.status, json };
  };
}

async function main() {
  console.log(`cross-org-smoke run ${RUN} against ${BASE}\n`);

  const sql = createSqlFromEnv();
  const orgA = `org_iso_a_${RUN}`;
  const orgB = `org_iso_b_${RUN}`;
  const keyA = `oc_live_iso_a_${RUN}_${randomBytes(12).toString('hex')}`;
  const keyB = `oc_live_iso_b_${RUN}_${randomBytes(12).toString('hex')}`;

  async function seedOrg(orgId, key) {
    const keyHash = createHash('sha256').update(key).digest('hex');
    await sql`
      INSERT INTO organizations (id, name, slug, plan)
      VALUES (${orgId}, ${orgId}, ${orgId}, 'pro')
    `;
    await sql`
      INSERT INTO api_keys (id, org_id, key_hash, key_prefix, label, role)
      VALUES (${'key_' + keyHash.slice(0, 16)}, ${orgId}, ${keyHash}, ${key.slice(0, 16)}, 'cross-org-smoke', 'admin')
    `;
  }

  async function cleanup() {
    // Every table carrying org_id, discovered live — the sweep stays complete
    // as new governance tables appear. api_keys is covered by the sweep;
    // organizations goes last (FK parent).
    try {
      const tables = await sql`
        SELECT table_name FROM information_schema.columns
        WHERE table_schema = 'public' AND column_name = 'org_id'
      `;
      for (const { table_name } of tables) {
        try {
          await sql.query(
            `DELETE FROM "${table_name}" WHERE org_id IN ($1, $2)`,
            [orgA, orgB],
          );
        } catch (err) {
          console.warn(`cleanup: could not sweep ${table_name}: ${err.message}`);
        }
      }
      await sql`DELETE FROM organizations WHERE id IN (${orgA}, ${orgB})`;
    } catch (err) {
      console.warn(`cleanup failed (run-unique orgs ${orgA}/${orgB} may remain): ${err.message}`);
    }
    if (typeof sql.end === 'function') await sql.end({ timeout: 5 });
  }

  try {
    await seedOrg(orgA, keyA);
    await seedOrg(orgB, keyB);

    const A = keyed(keyA);
    const B = keyed(keyB);
    const agentA = `iso-a-agent-${RUN}`;

    // --- sanity: both keys authenticate at all -----------------------------
    {
      const a = await A('POST', '/api/actions', { agent_id: agentA, action_type: `iso.sanity.${RUN}`, declared_goal: `auth sanity ${RUN}` });
      const b = await B('POST', '/api/actions', { agent_id: `iso-b-agent-${RUN}`, action_type: `iso.sanity.${RUN}`, declared_goal: `auth sanity ${RUN}` });
      if (a.status === 401 || b.status === 401) {
        console.error(`FATAL: seeded DB keys rejected (A=${a.status}, B=${b.status}). ` +
          'Does the server share this DATABASE_URL, and is the operator key set in the server env (self-host key resolution)?');
        process.exitCode = 1;
        return;
      }
      const authOk = (s) => s === 200 || s === 201 || s === 202;
      check('sanity: org A key authenticates (actions)', authOk(a.status), `status=${a.status}`);
      check('sanity: org B key authenticates (actions)', authOk(b.status), `status=${b.status}`);
    }

    // --- actions ------------------------------------------------------------
    const created = await A('POST', '/api/actions', {
      agent_id: agentA, action_type: `iso.build.${RUN}`, declared_goal: `cross-org isolation probe ${RUN}`,
    });
    const actionId = created.json?.action_id || created.json?.action?.action_id;
    check('actions: org A creates an action', Boolean(actionId), `status=${created.status} body=${JSON.stringify(created.json)}`);

    {
      const control = await A('GET', `/api/actions/${actionId}`);
      check('actions: org A reads its own action (control)', control.status === 200, `status=${control.status}`);
      const read = await B('GET', `/api/actions/${actionId}`);
      check('actions: org B cannot read org A action by id', read.status === 404, `status=${read.status} body=${JSON.stringify(read.json)}`);
      const patch = await B('PATCH', `/api/actions/${actionId}`, { status: 'completed', outcome: 'success' });
      check('actions: org B cannot mutate org A action', patch.status === 404, `status=${patch.status}`);
      const list = await B('GET', '/api/actions?limit=200');
      const leaked = (list.json?.actions || []).some((a) => a.action_id === actionId);
      check('actions: org B list does not enumerate org A action', list.status === 200 && !leaked, `status=${list.status} leaked=${leaked}`);
      const still = await A('GET', `/api/actions/${actionId}`);
      check('actions: org A action unchanged after org B mutation attempt', still.status === 200 && still.json?.action?.status !== 'completed', `status=${still.json?.action?.status}`);
    }

    // --- assumptions ----------------------------------------------------------
    {
      const made = await A('POST', '/api/assumptions', { action_id: actionId, assumption: `iso assumption ${RUN}` });
      const assumptionId = made.json?.assumption_id || made.json?.assumption?.assumption_id;
      check('assumptions: org A records an assumption', Boolean(assumptionId), `status=${made.status}`);
      const read = await B('GET', `/api/assumptions/${assumptionId}`);
      check('assumptions: org B cannot read org A assumption', read.status === 404, `status=${read.status}`);
      const patch = await B('PATCH', `/api/assumptions/${assumptionId}`, { validated: true });
      check('assumptions: org B cannot mutate org A assumption', patch.status === 404, `status=${patch.status}`);
    }

    // --- messages (incl. cross-org sender impersonation) ----------------------
    {
      const made = await A('POST', '/api/messages', { from_agent_id: agentA, body: `iso message ${RUN}` });
      const messageId = made.json?.message_id || made.json?.message?.id;
      check('messages: org A posts a message', Boolean(messageId), `status=${made.status}`);
      const list = await B('GET', '/api/messages?limit=200');
      const leaked = (list.json?.messages || []).some((m) => m.id === messageId);
      check('messages: org B list does not enumerate org A message', !leaked, `leaked=${leaked}`);
      const forged = await B('POST', '/api/messages', { from_agent_id: agentA, body: `forged as org A agent ${RUN}` });
      check('messages: org B cannot send as an org A agent', forged.status === 403, `status=${forged.status}`);
    }

    // --- guard decisions -----------------------------------------------------------
    {
      const evaluated = await A('POST', '/api/guard', {
        action_type: `iso.guarded.${RUN}`, declared_goal: `guarded probe ${RUN}`, agent_id: agentA,
      });
      check('guard: org A evaluation succeeds', evaluated.status === 200, `status=${evaluated.status}`);
      const list = await B('GET', `/api/guard/decisions?agent_id=${agentA}&limit=200`);
      const rows = list.json?.decisions || [];
      check('guard: org B cannot enumerate org A guard decisions', list.status === 200 && rows.length === 0, `status=${list.status} rows=${rows.length}`);
    }

    // --- policies ---------------------------------------------------------------
    {
      const made = await A('POST', '/api/policies', {
        name: `cross-org-smoke:${RUN}`, policy_type: 'block_action_type',
        rules: { action_types: [`iso.blocked.${RUN}`] }, active: true, agent_ids: [agentA],
      });
      const policyId = made.json?.policy?.id || made.json?.id;
      check('policies: org A creates a policy', Boolean(policyId), `status=${made.status}`);
      const del = await B('DELETE', `/api/policies?id=${policyId}`);
      check('policies: org B cannot delete org A policy', del.status === 404, `status=${del.status}`);
      const list = await B('GET', '/api/policies');
      const leaked = (list.json?.policies || []).some((p) => p.id === policyId);
      check('policies: org B list does not enumerate org A policy', !leaked, `leaked=${leaked}`);
      const still = await A('GET', '/api/policies');
      const survives = (still.json?.policies || []).some((p) => p.id === policyId);
      check('policies: org A policy survives org B delete attempt', survives, 'policy missing from org A list');
    }

    // --- approvals (cross-org approval forgery) -----------------------------------
    {
      const forged = await B('POST', `/api/approvals/${actionId}`, { decision: 'allow', reasoning: 'cross-org forgery attempt' });
      check('approvals: org B cannot approve org A action', forged.status === 404, `status=${forged.status}`);
    }

    // ------------------------------------------------------------------ summary ---
    const failed = results.filter((r) => !r.pass);
    console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
    if (failed.length > 0) {
      console.error('\nFAILED CHECKS (cross-org isolation violation or probe drift):');
      for (const f of failed) console.error(`  - ${f.name} — ${f.detail}`);
      process.exitCode = 1;
    }
  } finally {
    await cleanup();
  }
}

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

await main();
