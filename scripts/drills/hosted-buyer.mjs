#!/usr/bin/env node
/**
 * hosted-buyer drill — the money path against a running hosted-mode
 * instance, scripted: mint a trial → key works → first governed action →
 * claim (seed the authenticated user, forge the session, claim, verify DB
 * truth) → checkout → synthetic Stripe webhook (signed) → idempotency
 * replay → plan flip. A drill failure is a broken ship: fix on the spot,
 * log it in the maintainer log.
 *
 * Spec: PS docs/plans/2026-08-13-dashclaw-hosted-launch-implementation-plans.md
 * (Plan A). Full money path: mint/key/action, claim, checkout/webhook/
 * plan-flip (Tasks 1-3), entitlement proof — seat-cap 409 + action-ceiling
 * 403 (Task 4), portal + cancel webhook + free-plan restore (Task 5), and
 * export + final verdict (Task 6).
 *
 * The claim step cannot do the real Google OAuth redirect, so — same
 * substitution as claim-flow.mjs — it seeds the `users` row the signIn
 * callback would have created and forges a NextAuth session JWT with
 * next-auth/jwt + NEXTAUTH_SECRET. Everything else rides live HTTP.
 *
 * Checkout and the webhook use REAL Stripe test-mode API calls (the
 * customer is created by the checkout route itself) plus a SIGNED synthetic
 * webhook event (stripe.webhooks.generateTestHeaderString) so the handler's
 * signature verification runs unmodified — no Stripe CLI, no live
 * subscription is ever created.
 *
 * Usage:
 *   node scripts/drills/hosted-buyer.mjs
 *     [--base-url http://localhost:3000]   (or HOSTED_DRILL_BASE_URL)
 *     [--sabotage]                          (L1 make-it-fail switch: flips
 *                                            the seat-cap expected status
 *                                            from 409 to 200)
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
import Stripe from 'stripe';
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
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const runId = crypto.randomBytes(4).toString('hex');

  console.log(`[drill] hosted-buyer money path against ${baseUrl}${sabotage ? ' (--sabotage armed)' : ''}`);

  // Globals filled in as the run progresses; Task 4-6 steps extend these.
  let workspaceId = null;
  let orgId = null;
  let apiKey = null;
  let trialCookie = null;
  let claimed = false;
  let userId = null;
  let personalOrgId = null;
  let stripeCustomerId = null;
  const subscriptionId = `sub_drill_${runId}`;

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
  // FK-child sweep + delete, mirroring claim-flow.mjs's teardown. Shared by
  // both the personal-org and the claimed-trial-org cleanups so the sweep
  // logic exists once.
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

  async function postSignedWebhook(type, object, eventId) {
    const payload = JSON.stringify({ id: eventId, object: 'event', type, data: { object } });
    const signature = stripe.webhooks.generateTestHeaderString({
      payload, secret: process.env.STRIPE_WEBHOOK_SECRET,
    });
    const res = await fetch(`${baseUrl}/api/webhooks/stripe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'stripe-signature': signature },
      body: payload,
    });
    return { status: res.status, body: await res.json() };
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
        // Only meaningful if the run never reached claim. Once claimed the
        // Task-2 claimed-org teardown supersedes this and this one is a
        // guaranteed no-op 404 (or skipped outright — see below).
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

    // 8. Checkout — starts a real Stripe test-mode Checkout Session; the
    //    route creates the customer before returning.
    const checkoutOk = await step('checkout', async () => {
      const res = await jsonFetch(`${baseUrl}/api/billing/checkout`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: sessionCookie() },
        body: JSON.stringify({ plan: 'indie' }),
      });
      if (res.status !== 200 || !/^https:\/\/checkout\.stripe\.com\//.test(res.json?.url || '')) {
        throw new Error(`status=${res.status} url=${JSON.stringify(res.json?.url)}`);
      }
      const rows = await sql`SELECT stripe_customer_id FROM organizations WHERE id = ${orgId}`;
      stripeCustomerId = rows[0]?.stripe_customer_id || null;
      if (!stripeCustomerId) throw new Error('checkout 200 but organizations.stripe_customer_id is still null');

      registerTeardown('stripe customer', async () => {
        await stripe.customers.del(stripeCustomerId);
        // Verify the delete actually happened rather than trusting a 200.
        try {
          const c = await stripe.customers.retrieve(stripeCustomerId);
          if (!c?.deleted) throw new Error('customer still retrievable and not marked deleted');
        } catch (err) {
          if (err?.code !== 'resource_missing') throw err;
        }
        return `customer ${stripeCustomerId} deleted`;
      });
      return `status=${res.status} customer=${stripeCustomerId}`;
    });
    if (!checkoutOk) return finish();

    // 9. Synthetic completed webhook, signed with the real webhook secret.
    const webhookEventId = `evt_drill_completed_${runId}`;
    const webhookOk = await step('webhook-completed', async () => {
      const { status, body } = await postSignedWebhook('checkout.session.completed', {
        customer: stripeCustomerId,
        subscription: subscriptionId,
        metadata: { org_id: orgId, plan: 'indie' },
      }, webhookEventId);
      if (status !== 200 || body?.received !== true || body?.duplicate === true) {
        throw new Error(`status=${status} received=${body?.received} duplicate=${body?.duplicate}`);
      }
      registerTeardown('stripe_webhook_events rows', async () => {
        const deleted = await sql`
          DELETE FROM stripe_webhook_events WHERE event_id LIKE ${'evt_drill_%' + runId}
          RETURNING event_id
        `;
        return `${deleted.length} row(s) removed`;
      });
      return `status=${status} received=${body?.received} duplicate=${body?.duplicate}`;
    });
    if (!webhookOk) return finish();

    // 10. Replay the identical event — idempotency ledger must short-circuit.
    await step('webhook-idempotent', async () => {
      const { status, body } = await postSignedWebhook('checkout.session.completed', {
        customer: stripeCustomerId,
        subscription: subscriptionId,
        metadata: { org_id: orgId, plan: 'indie' },
      }, webhookEventId);
      if (status !== 200 || body?.duplicate !== true) {
        throw new Error(`status=${status} duplicate=${body?.duplicate}`);
      }
      return `status=${status} duplicate=${body?.duplicate}`;
    });

    // 11. Plan flip — DB write is immediate; poll mirrors claim-flow's
    //     precedent so this step follows the same pattern as the Task-4
    //     behavioral checks that DO wait on middleware's 60s org-facts cache.
    await step('plan-flip', async () => {
      let row = null;
      const deadline = Date.now() + 75_000;
      while (Date.now() < deadline) {
        const rows = await sql`
          SELECT plan, subscription_status, stripe_subscription_id, trial_action_cap
          FROM organizations WHERE id = ${orgId}
        `;
        row = rows[0] || null;
        if (row?.plan === 'indie') break;
        await new Promise((r) => setTimeout(r, 2_000));
      }
      const ok = row?.plan === 'indie' && row?.subscription_status === 'active'
        && row?.stripe_subscription_id === subscriptionId && row?.trial_action_cap === null;
      if (!ok) {
        throw new Error(`plan=${row?.plan} status=${row?.subscription_status} sub=${row?.stripe_subscription_id} cap=${row?.trial_action_cap}`);
      }
      return `plan=${row.plan} status=${row.subscription_status} cap=null`;
    });

    // 12. Seat cap — free/indie both cap at 2 seats (1 admin member + N
    //     pending invites). First invite succeeds (1 member + 0 invites < 2);
    //     second hits the cap. --sabotage flips the SECOND assertion to
    //     expect 200, which the real route never returns once capped — this
    //     is the drill's own make-it-fail switch (L1: prove the check can go
    //     red before trusting it green).
    await step('seat-cap', async () => {
      const first = await jsonFetch(`${baseUrl}/api/team/invites`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: sessionCookie() },
        body: JSON.stringify({ email: `drill-invite-1-${runId}@example.com` }),
      });
      if (first.status !== 201) {
        throw new Error(`first invite -> ${first.status}: ${first.text.slice(0, 200)}`);
      }
      const second = await jsonFetch(`${baseUrl}/api/team/invites`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: sessionCookie() },
        body: JSON.stringify({ email: `drill-invite-2-${runId}@example.com` }),
      });
      const expectedStatus = sabotage ? 200 : 409;
      const ok = sabotage
        ? second.status === expectedStatus
        : second.status === 409 && second.json?.code === 'SEAT_CAP_REACHED' && second.json?.seat_cap === 2;
      if (!ok) {
        throw new Error(`second invite -> ${second.status} code=${second.json?.code} seat_cap=${second.json?.seat_cap}`);
      }
      // seat_invites.org_id REFERENCES organizations(id) — the FK-child
      // sweep in purgeOrg discovers it automatically (confirmed against
      // drizzle/0069_claim_and_invites.sql), so no explicit delete needed
      // here.
      return `first=${first.status} second=${second.status}${sabotage ? ' (--sabotage armed)' : ` code=${second.json?.code}`}`;
    });

    // 13. Seed the action ceiling directly — 50000 governed actions this
    //     period, matching the indie plan's ceiling exactly.
    const period = new Date().toISOString().slice(0, 7); // 'YYYY-MM' UTC
    await step('ceiling-seed', async () => {
      await sql`
        INSERT INTO usage_rollups (org_id, period, governed_actions, blocked_actions)
        VALUES (${orgId}, ${period}, 50000, 0)
        ON CONFLICT (org_id, period) DO UPDATE SET governed_actions = 50000, updated_at = NOW()
      `;
      // Registered here (after the claimed-trial-org purge teardown, which
      // was registered back at the claim step) so in reverse-registration
      // execution order this delete runs BEFORE that FK sweep — double
      // delete is harmless either way since the sweep also matches
      // usage_rollups.org_id.
      registerTeardown('usage_rollups row', async () => {
        const deleted = await sql`
          DELETE FROM usage_rollups WHERE org_id = ${orgId} AND period = ${period} RETURNING org_id
        `;
        return `${deleted.length} row(s) removed`;
      });
      return `org=${orgId} period=${period} governed_actions=50000`;
    });

    // 14. Poll until the ceiling arms — middleware caches org facts for 60s,
    //     so the plan-flip (already visible in DB) needs time to be visible
    //     to the enforcement check. A 2xx during that window is expected and
    //     tolerated; each tolerated call is itself a real governed action, so
    //     the exact governed_actions count is not asserted, only >= 50000
    //     behavior server-side.
    await step('ceiling-403', async () => {
      let last = null;
      const deadline = Date.now() + 75_000;
      while (Date.now() < deadline) {
        const res = await jsonFetch(`${baseUrl}/api/actions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
          body: JSON.stringify({
            agent_id: 'smoke-drill-buyer',
            action_type: 'smoke.drill',
            declared_goal: 'hosted-buyer drill: ceiling probe',
          }),
        });
        last = res;
        if (res.status === 403 && res.json?.code === 'ACTION_CEILING_REACHED') break;
        if (res.status !== 200 && res.status !== 201) {
          throw new Error(`POST /api/actions -> ${res.status}: ${res.text.slice(0, 200)}`);
        }
        await new Promise((r) => setTimeout(r, 5_000));
      }
      const ok = last?.status === 403 && last?.json?.code === 'ACTION_CEILING_REACHED'
        && last?.json?.monthly_action_ceiling === 50000;
      if (!ok) {
        throw new Error(`status=${last?.status} code=${last?.json?.code} ceiling=${last?.json?.monthly_action_ceiling}`);
      }
      return `status=403 code=ACTION_CEILING_REACHED monthly_action_ceiling=${last.json.monthly_action_ceiling}`;
    });

    // 15. Portal — proves the customer link is live; the real cancel arrives
    //     as the webhook Stripe would send after a portal cancel (next step).
    await step('portal', async () => {
      const res = await jsonFetch(`${baseUrl}/api/billing/portal`, { headers: { cookie: sessionCookie() } });
      if (res.status !== 200 || !/^https:\/\/billing\.stripe\.com\//.test(res.json?.url || '')) {
        throw new Error(`status=${res.status} url=${JSON.stringify(res.json?.url)}`);
      }
      return `status=${res.status}`;
    });

    // 16. Synthetic canceled webhook — same signed-event mechanism as the
    //     checkout.session.completed steps above.
    await step('webhook-canceled', async () => {
      const { status, body } = await postSignedWebhook(
        'customer.subscription.deleted', { id: subscriptionId }, `evt_drill_deleted_${runId}`,
      );
      if (status !== 200 || body?.received !== true) {
        throw new Error(`status=${status} received=${body?.received}`);
      }
      return `status=${status} received=${body?.received}`;
    });

    // 17. Free-plan restore — DB write is immediate; poll mirrors plan-flip.
    await step('free-restore', async () => {
      let row = null;
      const deadline = Date.now() + 75_000;
      while (Date.now() < deadline) {
        const rows = await sql`
          SELECT plan, subscription_status, stripe_subscription_id, trial_action_cap
          FROM organizations WHERE id = ${orgId}
        `;
        row = rows[0] || null;
        if (row?.plan === 'free') break;
        await new Promise((r) => setTimeout(r, 2_000));
      }
      const ok = row?.plan === 'free' && row?.subscription_status === 'canceled'
        && row?.stripe_subscription_id === null && row?.trial_action_cap === 10000;
      if (!ok) {
        throw new Error(`plan=${row?.plan} status=${row?.subscription_status} sub=${row?.stripe_subscription_id} cap=${row?.trial_action_cap}`);
      }
      return `plan=${row.plan} status=${row.subscription_status} cap=${row.trial_action_cap}`;
    });

    // 18. Ceiling gone — free has no monthlyActionCeiling even though the
    //     usage_rollups row (from ceiling-seed, still intact — teardown for
    //     it hasn't run yet) still says >= 50000. A success here proves the
    //     403 above was plan-scoped, not sticky to the usage row. A 403
    //     during the poll window is the cache aging out and is tolerated.
    await step('ceiling-gone', async () => {
      let last = null;
      const deadline = Date.now() + 75_000;
      while (Date.now() < deadline) {
        const res = await jsonFetch(`${baseUrl}/api/actions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
          body: JSON.stringify({
            agent_id: 'smoke-drill-buyer',
            action_type: 'smoke.drill',
            declared_goal: 'hosted-buyer drill: post-cancel probe',
          }),
        });
        last = res;
        if (res.status === 200 || res.status === 201) break;
        if (res.status !== 403) {
          throw new Error(`POST /api/actions -> ${res.status}: ${res.text.slice(0, 200)}`);
        }
        await new Promise((r) => setTimeout(r, 5_000));
      }
      const ok = last?.status === 200 || last?.status === 201;
      if (!ok) throw new Error(`status=${last?.status} code=${last?.json?.code}`);
      return `status=${last.status}`;
    });

    // 19. Export — the carry-out bundle, same assertion hosted-stranger uses.
    await step('export', async () => {
      const res = await jsonFetch(`${baseUrl}/api/workspace/export`, { headers: { 'x-api-key': apiKey } });
      const ok = res.status === 200 && res.json && typeof res.json === 'object' && Boolean(res.json.exported_at);
      if (!ok) throw new Error(`GET /api/workspace/export -> ${res.status}: ${res.text.slice(0, 200)}`);
      return `exported_at=${res.json.exported_at} (${res.text.length} bytes)`;
    });

    return finish();
  } finally {
    await runTeardowns();
  }
}

main().then(() => {
  if (process.exitCode === undefined) process.exitCode = 1;
});
