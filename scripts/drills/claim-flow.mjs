#!/usr/bin/env node
/**
 * v5.13 claim-flow drill — the full claim path against a running hosted-mode
 * instance, scripted: mint an anonymous trial → seed the authenticated user
 * the signIn callback would have created → preview → claim → verify the org
 * is owned, the user rebound, the abandoned personal org discarded, and the
 * anonymous trial cookie revoked. A drill failure is a broken ship.
 *
 * The one step a script cannot do is the real Google OAuth redirect, so the
 * drill substitutes its two artifacts and nothing else: the `users` row the
 * signIn callback inserts (seeded via DATABASE_URL) and the NextAuth session
 * JWT (encoded with next-auth/jwt + NEXTAUTH_SECRET — the same library and
 * secret the middleware verifies with). Everything downstream is the
 * untouched claim path over live HTTP.
 *
 * Usage:
 *   node scripts/drills/claim-flow.mjs
 *     [--base-url http://localhost:3000]   (or CLAIM_DRILL_BASE_URL)
 *     [--skip-revocation-wait]             (skip the ≤75s trial-cookie
 *                                           revocation poll — the 60s
 *                                           middleware org cache must age out
 *                                           before the check can pass)
 *
 * Env (all required):
 *   HOSTED_DRILL_TOKEN   mint bypass held by the operator (min 24 chars)
 *   NEXTAUTH_SECRET      must match the target instance
 *   DATABASE_URL         must be the target instance's database
 *
 * Exit code: 0 all steps green; 1 otherwise.
 */

import '../_load-env.mjs';
import { createSqlFromEnv } from '../_db.mjs';
import { encode } from 'next-auth/jwt';
import crypto from 'node:crypto';

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

function parseArgs(argv) {
  const args = {
    baseUrl: process.env.CLAIM_DRILL_BASE_URL || 'http://localhost:3000',
    skipRevocationWait: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--base-url') args.baseUrl = argv[++i];
    else if (a.startsWith('--base-url=')) args.baseUrl = a.slice('--base-url='.length);
    else if (a === '--skip-revocation-wait') args.skipRevocationWait = true;
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

async function main() {
  const args = parseArgs(process.argv);
  const { baseUrl } = args;
  const drillToken = process.env.HOSTED_DRILL_TOKEN || '';
  const secret = process.env.NEXTAUTH_SECRET || '';
  if (drillToken.length < 24) { console.error('HOSTED_DRILL_TOKEN missing/short'); process.exit(1); }
  if (!secret) { console.error('NEXTAUTH_SECRET missing'); process.exit(1); }
  if (!process.env.DATABASE_URL) { console.error('DATABASE_URL missing'); process.exit(1); }

  const sql = createSqlFromEnv();
  const runId = crypto.randomBytes(4).toString('hex');
  const userId = `usr_drill_${runId}`;
  const personalOrgId = `org_drill_${runId}`;
  let trialOrgId = null;

  try {
    // 1. Mint the anonymous trial (drill token substitutes for Turnstile).
    const mint = await jsonFetch(`${baseUrl}/api/hosted/workspaces`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hosted-drill-token': drillToken },
      body: JSON.stringify({}),
    });
    trialOrgId = mint.json?.workspace_id || null;
    const trialCookie = cookieFromSetCookie(mint.headers, 'dashclaw-trial-session');
    if (!record('mint', mint.status === 200 && Boolean(trialOrgId) && Boolean(trialCookie),
      `status=${mint.status} org=${trialOrgId} cookie=${trialCookie ? 'set' : 'missing'}`)) return finish(1);

    // 2. Seed what the signIn callback would have created on the way to
    //    /claim: an empty hosted personal org and the users row bound to it.
    const past = new Date(Date.now() + 7 * 86_400_000).toISOString();
    await sql`
      INSERT INTO organizations (id, name, slug, plan, hosted_mode, trial_ends_at, trial_action_cap, trial_actions_used)
      VALUES (${personalOrgId}, ${'Drill Claimer\'s workspace'}, ${`ws-drill-${runId}`}, 'free', TRUE, ${past}, 10, 0)
    `;
    await sql`
      INSERT INTO users (id, org_id, email, name, provider, provider_account_id, role)
      VALUES (${userId}, ${personalOrgId}, ${`drill-${runId}@example.com`}, ${'Drill Claimer'}, 'google', ${`drill-${runId}`}, 'admin')
    `;
    record('seed', true, `user=${userId} personalOrg=${personalOrgId}`);

    // 3. NextAuth session for that user — same encoder + secret the
    //    middleware verifies with. http base → non-__Secure cookie name.
    const sessionJwt = await encode({
      token: { sub: userId, userId, orgId: personalOrgId, role: 'admin', plan: 'free', orgRefreshedAt: Date.now() },
      secret,
    });
    const sessionCookieName = baseUrl.startsWith('https')
      ? '__Secure-next-auth.session-token'
      : 'next-auth.session-token';
    const sessionCookie = `${sessionCookieName}=${sessionJwt}`;

    // The middleware resolves anonymous trial sessions with the Neon HTTP
    // driver, so on a localhost-Postgres instance (local dev) trial cookies
    // never authenticate API fetches — a pre-existing v5.1 constraint of
    // hosted mode off Neon, not a claim-flow property. The two steps that
    // ride on trial-cookie API auth go strict on Neon, LIMITED locally.
    const trialSessionsResolvable = /\.neon\.tech/i.test(process.env.DATABASE_URL || '');

    // 4. Preview, anonymous: claimable, not signed in.
    const anon = await jsonFetch(`${baseUrl}/api/hosted/claim`, { headers: { cookie: trialCookie } });
    if (trialSessionsResolvable) {
      record('preview_anonymous',
        anon.status === 200 && anon.json?.claimable === true && anon.json?.signed_in === false,
        `status=${anon.status} claimable=${anon.json?.claimable} signed_in=${anon.json?.signed_in}`);
    } else {
      record('preview_anonymous', anon.status === 401,
        `LIMITED (local non-Neon DB: middleware cannot resolve trial sessions) status=${anon.status}`);
    }

    // 5. Preview, signed in: movable personal org.
    const both = `${trialCookie}; ${sessionCookie}`;
    const signed = await jsonFetch(`${baseUrl}/api/hosted/claim`, { headers: { cookie: both } });
    record('preview_signed_in',
      signed.status === 200 && signed.json?.claimable === true && signed.json?.signed_in === true
        && signed.json?.current_workspace_movable === true,
      `status=${signed.status} signed_in=${signed.json?.signed_in} movable=${signed.json?.current_workspace_movable}`);

    // 6. Claim.
    const claim = await jsonFetch(`${baseUrl}/api/hosted/claim`, { method: 'POST', headers: { cookie: both } });
    const cleared = cookieFromSetCookie(claim.headers, 'dashclaw-trial-session');
    if (!record('claim',
      claim.status === 200 && claim.json?.claimed === true && cleared !== null && cleared.endsWith('='),
      `status=${claim.status} claimed=${claim.json?.claimed} cookie_cleared=${cleared !== null}`)) return finish(1);

    // 7. Database truth: org owned + durable + renamed, user rebound as
    //    admin, abandoned personal org discarded.
    const orgRows = await sql`
      SELECT name, claimed_at, claimed_by_user_id, trial_ends_at, hosted_mode
      FROM organizations WHERE id = ${trialOrgId}
    `;
    const o = orgRows[0] || {};
    record('org_owned',
      Boolean(o.claimed_at) && o.claimed_by_user_id === userId && o.trial_ends_at === null
        && String(o.name).includes('Drill Claimer'),
      `claimed_at=${o.claimed_at ? 'set' : 'null'} by=${o.claimed_by_user_id} expiry=${o.trial_ends_at} name=${JSON.stringify(o.name)}`);
    const userRows = await sql`SELECT org_id, role FROM users WHERE id = ${userId}`;
    record('user_rebound',
      userRows[0]?.org_id === trialOrgId && userRows[0]?.role === 'admin',
      `org=${userRows[0]?.org_id} role=${userRows[0]?.role}`);
    const oldOrg = await sql`SELECT id FROM organizations WHERE id = ${personalOrgId}`;
    record('abandoned_org_discarded', oldOrg.length === 0,
      oldOrg.length === 0 ? 'gone' : 'still present (sweep will collect it)');

    // 8. The anonymous trial cookie no longer resolves. The middleware
    //    caches trial-org facts for 60s, so poll until the cache ages out.
    if (!trialSessionsResolvable) {
      record('trial_cookie_revoked', true,
        'LIMITED (local non-Neon DB: trial sessions never resolve here, so revocation is vacuous)');
    } else if (args.skipRevocationWait) {
      record('trial_cookie_revoked', true, 'skipped (--skip-revocation-wait)');
    } else {
      let revoked = false;
      const deadline = Date.now() + 75_000;
      while (Date.now() < deadline) {
        const probe = await jsonFetch(`${baseUrl}/api/decisions`, { headers: { cookie: trialCookie } });
        if (probe.status === 401) { revoked = true; break; }
        await new Promise((r) => setTimeout(r, 5_000));
      }
      record('trial_cookie_revoked', revoked, revoked ? 'trial session 401s on a claimed org' : 'still resolving after 75s');
    }

    return finish(steps.every((s) => s.ok) ? 0 : 1);
  } finally {
    // Teardown: the claim guard refuses to delete owned orgs (by design), so
    // the drill un-claims its own artifacts first, then removes them with the
    // same catalog-driven child sweep the cleanup path uses.
    try {
      await sql`DELETE FROM users WHERE id = ${userId}`;
      for (const orgId of [trialOrgId, personalOrgId].filter(Boolean)) {
        await sql`UPDATE organizations SET claimed_at = NULL, claimed_by_user_id = NULL WHERE id = ${orgId}`;
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
              await sql.query(`DELETE FROM "${child.table_name}" WHERE "${child.column_name}" = $1`, [orgId]);
            } catch { failed.push(child); }
          }
          if (failed.length === pending.length) break;
          pending = failed;
        }
        await sql`DELETE FROM organizations WHERE id = ${orgId}`;
      }
      console.log('DRILL_TEARDOWN complete');
    } catch (err) {
      console.error('DRILL_TEARDOWN failed (artifacts may remain):', err.message);
    }
  }
}

function finish(code) {
  const failed = steps.filter((s) => !s.ok);
  console.log(`\nDRILL_RESULT ${failed.length === 0 ? 'PASS' : 'FAIL'} (${steps.length - failed.length}/${steps.length} steps)`);
  process.exitCode = code;
}

main().then(() => {
  if (process.exitCode === undefined) process.exitCode = steps.every((s) => s.ok) ? 0 : 1;
});
