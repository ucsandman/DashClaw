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
 * covers mint → key-works → first-action only.
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

  console.log(`[drill] hosted-buyer money path against ${baseUrl}${sabotage ? ' (--sabotage armed)' : ''}`);

  // Globals filled in as the run progresses; later tasks extend these.
  let workspaceId = null;
  let orgId = null;
  let apiKey = null;
  let trialCookie = null;
  let claimed = false;

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

    return finish();
  } finally {
    await runTeardowns();
  }
}

main().then(() => {
  if (process.exitCode === undefined) process.exitCode = 1;
});
