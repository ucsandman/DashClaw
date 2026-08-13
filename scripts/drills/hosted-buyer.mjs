#!/usr/bin/env node
/**
 * hosted-buyer drill — the money path against a running hosted-mode
 * instance, scripted: mint a trial → key works → first governed action →
 * claim → checkout → synthetic Stripe webhook plan-flip → entitlements →
 * portal → cancel → export → teardown. A drill failure is a broken ship:
 * fix on the spot, log it in the maintainer log.
 *
 * Spec: PS docs/plans/2026-08-13-dashclaw-hosted-launch-implementation-plans.md
 * (Plan A). This file is built incrementally, task by task; this stage
 * covers mint → key-works → first-action → claim.
 *
 * The claim step cannot do the real Google OAuth redirect, so — same
 * substitution as claim-flow.mjs — it seeds the `users` row the signIn
 * callback would have created and forges a NextAuth session JWT with
 * next-auth/jwt + NEXTAUTH_SECRET. Everything else rides live HTTP.
 *
 * Usage:
 *   node scripts/drills/hosted-buyer.mjs
 *     [--base-url http://localhost:3000]   (or HOSTED_DRILL_BASE_URL)
 *     [--sabotage]                          (L1 make-it-fail switch: flips
 *                                            the seat-cap expected status
 *                                            from 409 to 200 — wired here,
 *                                            consumed by a later step)
 *
 * Env (all required):
 *   HOSTED_DRILL_TOKEN     mint bypass held by the operator
 *   DATABASE_URL           must be the target instance's database
 *   NEXTAUTH_SECRET        must match the target instance
 *   STRIPE_WEBHOOK_SECRET  must match the target instance
 *   STRIPE_SECRET_KEY      Stripe test-mode secret key
 *
 * Exit code: 0 all steps green; 1 otherwise.
 */

import '../_load-env.mjs';
import { createSqlFromEnv } from '../_db.mjs';
import { encode } from 'next-auth/jwt';
import crypto from 'node:crypto';

const REQUIRED = ['HOSTED_DRILL_TOKEN', 'DATABASE_URL', 'NEXTAUTH_SECRET',
  'STRIPE_WEBHOOK_SECRET', 'STRIPE_SECRET_KEY'];
const missing = REQUIRED.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`DRILL_VERDICT FAIL missing env: ${missing.join(', ')}`);
  process.exit(1);
}

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

function parseArgs(argv) {
  const args = {
    baseUrl: process.env.HOSTED_DRILL_BASE_URL || 'http://127.0.0.1:3000',
    sabotage: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--base-url') args.baseUrl = argv[++i];
    else if (a.startsWith('--base-url=')) args.baseUrl = a.slice('--base-url='.length);
    else if (a === '--sabotage') args.sabotage = true;
  }
  args.baseUrl = (args.baseUrl || '').replace(/\/$/, '');
  return args;
}

const steps = [];
function record(id, ok, detail) {
  steps.push({ id, ok, detail });
  console.log(`DRILL_STEP ${id} ${ok ? 'PASS' : 'FAIL'} ${detail}`);
  return ok;
}

// step(id, fn): fn throws to fail. Catches, records, and lets the caller
// decide whether a failure is fatal (most steps downstream depend on
// earlier state, so main() checks the return and bails via finish()).
async function step(id, fn) {
  try {
    const detail = await fn();
    return record(id, true, detail ?? '');
  } catch (err) {
    return record(id, false, err?.message || String(err));
  }
}

async function jsonFetch(url, init = {}, timeoutMs = 30_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // sec-fetch-site: the middleware only honors cookie sessions on
    // same-origin dashboard fetches; a browser sends this automatically.
    const headers = { 'sec-fetch-site': 'same-origin', ...(init.headers || {}) };
    const res = await fetch(url, { ...init, headers, signal: controller.signal, redirect: 'manual' });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* callers use .text for non-JSON */ }
    return { status: res.status, json, text, headers: res.headers };
  } finally {
    clearTimeout(timer);
  }
}

function cookieFromSetCookie(headers, name) {
  const all = headers.getSetCookie ? headers.getSetCookie() : [headers.get('set-cookie')].filter(Boolean);
  for (const line of all) {
    if (line && line.startsWith(`${name}=`)) return line.split(';')[0];
  }
  return null;
}

function finish() {
  const failed = steps.filter((s) => !s.ok);
  console.log(`DRILL_VERDICT ${failed.length === 0 ? 'PASS' : 'FAIL'} ${steps.length - failed.length}/${steps.length} steps green${failed.length ? ` — first failure: ${failed[0].id}` : ''}`);
  process.exitCode = failed.length === 0 ? 0 : 1;
}

// Teardown registry: labeled async cleanups, run in reverse order (last
// registered, first run) inside a `finally`. Each is wrapped so one failure
// doesn't stop the rest — teardown is best-effort and must never flip a
// PASS to a FAIL; a failure prints a warning with manual-cleanup context.
const teardowns = [];
function registerTeardown(label, fn) {
  teardowns.push({ label, fn });
}
async function runTeardowns() {
  for (let i = teardowns.length - 1; i >= 0; i -= 1) {
    const { label, fn } = teardowns[i];
    try {
      const detail = await fn();
      console.log(`DRILL_TEARDOWN ${label} ok${detail ? ` (${detail})` : ''}`);
    } catch (err) {
      console.error(`DRILL_TEARDOWN ${label} FAILED (manual cleanup may be required): ${err?.message || err}`);
    }
  }
}

async function main() {
  const args = parseArgs(process.argv);
  const baseUrl = args.baseUrl;
  const sabotage = args.sabotage;
  const drillToken = process.env.HOSTED_DRILL_TOKEN;
  const hostedAdminKey = process.env.HOSTED_ADMIN_API_KEY || '';

  const sql = createSqlFromEnv();
  const runId = crypto.randomBytes(4).toString('hex');

  console.log(`[drill] hosted-buyer money path against ${baseUrl}${sabotage ? ' (--sabotage armed)' : ''}`);

  // Globals filled in as the run progresses; later tasks extend these.
  let workspaceId = null;
  let orgId = null;
  let apiKey = null;
  let trialCookie = null;
  let claimed = false;
  let userId = null;
  let personalOrgId = null;

  // Re-minted after claim, bound to the trial org, so billing routes
  // resolve deterministically instead of waiting out the middleware's 60s
  // org-facts cache (claim-flow.mjs precedent).
  async function mintSessionCookie(boundOrgId) {
    const jwt = await encode({
      token: {
        sub: userId, userId, orgId: boundOrgId, role: 'admin', plan: 'free',
        orgRefreshedAt: Date.now(),
      },
      secret: process.env.NEXTAUTH_SECRET,
    });
    const name = baseUrl.startsWith('https')
      ? '__Secure-next-auth.session-token' : 'next-auth.session-token';
    return `${name}=${jwt}`;
  }
  let sessionCookieValue = null;
  function sessionCookie() {
    return sessionCookieValue;
  }

  // Un-claim (the claim guard refuses to delete an owned org) + generic
  // FK-child sweep + delete, mirroring claim-flow.mjs's teardown.
  async function purgeOrg(id) {
    await sql`UPDATE organizations SET claimed_at = NULL, claimed_by_user_id = NULL WHERE id = ${id}`;
    const children = await sql`
      SELECT DISTINCT tc.table_name AS table_name, kcu.column_name AS column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON kcu.constraint_name = tc.constraint_name AND kcu.constraint_schema = tc.table_schema
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name AND ccu.constraint_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND ccu.table_name = 'organizations'
        AND tc.table_name <> 'organizations'
    `;
    const safe = (s) => typeof s === 'string' && /^[a-z0-9_]+$/i.test(s);
    let pending = children.filter((c) => safe(c.table_name) && safe(c.column_name));
    for (let pass = 0; pass < 5 && pending.length > 0; pass += 1) {
      const failed = [];
      for (const child of pending) {
        try {
          await sql.query(`DELETE FROM "${child.table_name}" WHERE "${child.column_name}" = $1`, [id]);
        } catch { failed.push(child); }
      }
      if (failed.length === pending.length) break;
      pending = failed;
    }
    await sql`DELETE FROM organizations WHERE id = ${id}`;
  }

  try {
    // 1. Mint — the trial door (drill-labeled, same as hosted-stranger.mjs).
    const ok1 = await step('mint', async () => {
      const mint = await jsonFetch(`${baseUrl}/api/hosted/workspaces`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-hosted-drill-token': drillToken },
        body: JSON.stringify({}),
      });
      const minted = mint.status === 200 && Boolean(mint.json?.api_key) && Boolean(mint.json?.workspace_id);
      if (!minted) throw new Error(`HTTP ${mint.status}: ${mint.text.slice(0, 200)}`);
      apiKey = mint.json.api_key;
      workspaceId = mint.json.workspace_id;
      orgId = workspaceId;
      // Register cleanup for the minted workspace BEFORE any further
      // assertion in this step can throw — a workspace that exists on the
      // server must never depend on a later check succeeding to get torn
      // down.
      registerTeardown('trial-workspace (unclaimed-path fallback)', async () => {
        // Only meaningful if the run never reached claim (a later task
        // replaces this teardown for the claimed case).
        if (claimed) return 'skipped: org was claimed, see claimed-org teardown';
        if (!hostedAdminKey) return 'skipped: no HOSTED_ADMIN_API_KEY (trial will auto-expire)';
        const del = await jsonFetch(`${baseUrl}/api/hosted/workspaces/${workspaceId}`, {
          method: 'DELETE',
          headers: { 'x-api-key': hostedAdminKey },
        });
        if (del.status !== 200) throw new Error(`DELETE -> ${del.status}`);
        return `workspace ${workspaceId} deleted`;
      });
      trialCookie = cookieFromSetCookie(mint.headers, 'dashclaw-trial-session');
      if (!trialCookie) throw new Error('mint succeeded but no dashclaw-trial-session cookie in set-cookie');
      return `workspace ${workspaceId} (key prefix ${mint.json.key_prefix})`;
    });
    if (!ok1) return finish();

    // 2. The key works.
    await step('key-works', async () => {
      const health = await jsonFetch(`${baseUrl}/api/health`, { headers: { 'x-api-key': apiKey } });
      if (health.status !== 200) throw new Error(`GET /api/health -> ${health.status}`);
      return `GET /api/health -> ${health.status}`;
    });

    // 3. First governed action — the activation event the funnel measures.
    await step('first-action', async () => {
      const action = await jsonFetch(`${baseUrl}/api/actions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
        body: JSON.stringify({
          agent_id: 'smoke-drill-buyer',
          action_type: 'smoke.drill',
          declared_goal: 'hosted-buyer drill: first governed action',
        }),
      });
      if (action.status !== 200 && action.status !== 201) {
        throw new Error(`POST /api/actions -> ${action.status}`);
      }
      return `POST /api/actions -> ${action.status}`;
    });

    // 4. Seed the authenticated user + abandoned personal org the signIn
    //    callback would have created (claim-flow.mjs precedent).
    userId = `usr_drill_${runId}`;
    personalOrgId = `org_drill_${runId}`;
    await step('seed-user', async () => {
      const past = new Date(Date.now() + 7 * 86_400_000).toISOString();
      await sql`
        INSERT INTO organizations (id, name, slug, plan, hosted_mode, trial_ends_at, trial_action_cap, trial_actions_used)
        VALUES (${personalOrgId}, ${'Drill Buyer\'s workspace'}, ${`ws-drill-${runId}`}, 'free', TRUE, ${past}, 10, 0)
      `;
      // Registered as soon as the org row exists — before the user insert —
      // so a failure in that next statement still gets this row cleaned up.
      // On a successful claim the claim route itself discards this personal
      // org (claim-flow.mjs's "abandoned_org_discarded"), so this becomes a
      // harmless no-op by the time it runs.
      registerTeardown('seeded personal org + user', async () => {
        await sql`DELETE FROM users WHERE id = ${userId}`;
        await purgeOrg(personalOrgId);
        return `personalOrg=${personalOrgId} user=${userId}`;
      });
      await sql`
        INSERT INTO users (id, org_id, email, name, provider, provider_account_id, role)
        VALUES (${userId}, ${personalOrgId}, ${`drill-buyer-${runId}@example.com`}, ${'Drill Buyer'}, 'google', ${`drill-buyer-${runId}`}, 'admin')
      `;
      return `user=${userId} personalOrg=${personalOrgId}`;
    });

    // Forge a session bound to the personal org first (mirrors the real
    // pre-claim state), then re-mint bound to the trial org after claim.
    sessionCookieValue = await mintSessionCookie(personalOrgId);

    // 5. Claim preview.
    await step('claim-preview', async () => {
      const both = `${trialCookie}; ${sessionCookie()}`;
      const preview = await jsonFetch(`${baseUrl}/api/hosted/claim`, { headers: { cookie: both } });
      if (preview.status !== 200 || preview.json?.claimable !== true) {
        throw new Error(`status=${preview.status} claimable=${preview.json?.claimable}`);
      }
      return `status=${preview.status} claimable=${preview.json?.claimable}`;
    });

    // 6. Claim.
    const claimOk = await step('claim', async () => {
      const both = `${trialCookie}; ${sessionCookie()}`;
      const res = await jsonFetch(`${baseUrl}/api/hosted/claim`, { method: 'POST', headers: { cookie: both } });
      if (res.status !== 200 || res.json?.claimed !== true) {
        throw new Error(`status=${res.status} claimed=${res.json?.claimed}`);
      }
      claimed = true;
      return `status=${res.status} claimed=${res.json?.claimed}`;
    });
    if (claimOk) {
      // The claim POST rebinds server-side state; the old cookie still says
      // personalOrgId. Re-mint bound to the trial org so billing routes
      // resolve the right org deterministically.
      sessionCookieValue = await mintSessionCookie(orgId);

      // Claimed-trial-org teardown. Registered AFTER the seeded-personal-org
      // teardown above, so in reverse-order execution this runs FIRST: the
      // FK-sweep on orgId catches the user row too (claim rebinds
      // users.org_id from personalOrgId to orgId — claim-flow.mjs's
      // "user_rebound"), which makes the seeded-personal-org teardown's own
      // `DELETE FROM users` and org purge harmless no-ops by the time they
      // run. The unclaimed-path fallback registered at mint no-ops here too
      // (guarded on `claimed`).
      registerTeardown('claimed-trial-org', async () => {
        await purgeOrg(orgId);
        return `org=${orgId}`;
      });
    }

    // 7. Database truth after claim.
    await step('claim-db-truth', async () => {
      const rows = await sql`
        SELECT claimed_at, claimed_by_user_id, trial_ends_at
        FROM organizations WHERE id = ${orgId}
      `;
      const o = rows[0] || {};
      const ok = Boolean(o.claimed_at) && o.claimed_by_user_id === userId && o.trial_ends_at === null;
      if (!ok) {
        throw new Error(`claimed_at=${o.claimed_at ? 'set' : 'null'} by=${o.claimed_by_user_id} expiry=${o.trial_ends_at}`);
      }
      return `claimed_at=set by=${o.claimed_by_user_id} trial_ends_at=null`;
    });

    return finish();
  } finally {
    await runTeardowns();
  }
}

main().then(() => {
  if (process.exitCode === undefined) process.exitCode = 1;
});
