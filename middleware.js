import { NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { neon } from '@neondatabase/serverless';
import { resolveTrialSession, hasTrialSessionCookie, TRIAL_SESSION_COOKIE } from './app/lib/sessionViewer.mjs';
import { isSelfHostModeEnabled } from './app/lib/selfHost';
import { addSecurityHeaders } from './app/lib/security-headers';
import { actionCeilingExceeded, entitlementsForPlan } from './app/lib/entitlements';
import { getGovernedActionsThisPeriod } from './app/lib/repositories/usage.repository';
import {
  getCorsHeaders,
  withCors,
  forwardWithHeaders,
  getClientIp,
  checkRateLimit,
  getDashclawMode,
  getLocalAdminSession,
} from './middleware.shared.js';
import { handleDemoEntry, resolveDemoState, handleDemoApi } from './middleware.demo.js';

/**
 * Authentication middleware for DashClaw
 *
 * SECURITY: Protects API routes with API key authentication.
 * Resolves API keys to org_id via SHA-256 hash lookup.
 * Set DASHCLAW_API_KEY environment variable in production.
 */

// Routes that are always public (health checks, setup, auth)
const PUBLIC_ROUTES = [
  '/api/health',
  '/api/echo',  // constant-response echo target (registry demo seed + webhook tests); never reads the body

  '/api/setup/status',
  '/api/setup/proof',
  '/api/setup/ping',
  '/api/setup/migrate',
  // Self-host DB-key resolution bridge (see app/api/internal/resolve-key). The
  // middleware itself calls this on the internal hop; the route self-guards with
  // the operator key + a self-host/non-Neon gate, so it is safe as a public path
  // (it 401s without the operator key and 404s on hosted/Neon).
  '/api/internal/resolve-key',
  '/api/auth',
  // Session probe: returns only the caller's own cookie-derived state
  // (role/authType from their own JWT; {authenticated:false} for anonymous —
  // never org data). Public so unauthenticated pages (marketing, /login) can
  // gate client fetches on it without every visitor's console logging a 401.
  '/api/session/effective',
  '/api/cron',
  '/api/telegram/webhook',  // auth: x-telegram-bot-api-secret-token + chat-id allowlist (in route)
  '/api/webhooks/stripe',   // auth: stripe-signature verified over the raw body in the route (v5.14 checkout)
  '/api/discord/interactions',  // auth: Ed25519 signature + user_id allowlist (in route)
  // Public read-only content endpoints
  '/api/docs/raw',
  // Integrity re-verification surfaces — must be reachable without an API key so
  // an external party can independently verify a receipt/bundle against the
  // instance's published public key.
  '/api/integrity/jwks',
  '/api/integrity/verify',
  '/api/oauth',  // OAuth AS endpoints self-authenticate (authorize checks session; token verifies PKCE; register is DCR-open)
  // Only the static-markdown /raw endpoints are public (the "Copy ... Prompt"
  // buttons on the public /self-host page fetch them unauthenticated). A bare
  // '/api/prompts' prefix here previously exposed the entire prompts API —
  // templates (incl. POST/PATCH/DELETE), versions, render, runs, stats — with
  // no API key. Those are now default-deny.
  '/api/prompts/server-setup/raw',
  '/api/prompts/agent-connect/raw',
  '/api/prompts/sdk-coverage/raw',
  '/api/marketing',  // anonymous funnel telemetry. Route validates allowlisted events, rate limit + 2 MB body cap still apply.
  '/practical-systems',
  '/replay',
];

// Hosted-trial public surface. These requests must be reachable without
// an API key (anonymous visitors / GH Actions), and each route self-protects:
//   POST /api/hosted/workspaces — 404 unless DASHCLAW_HOSTED; Cloudflare
//        Turnstile verified (fails closed in production); per-IP daily cap.
//   GET  /api/hosted/capacity   — 404 unless DASHCLAW_HOSTED; aggregate
//        counts only (drives the "trials are full" state).
//   POST /api/hosted/cleanup    — 403 unless x-cleanup-secret or
//        Bearer CRON_SECRET matches (timing-safe; GH Actions daily job).
//   GET  /api/hosted/funnel     — 404 unless DASHCLAW_HOSTED; aggregate
//        trial-activation funnel, no org identifiers (v4.6 funnel truth).
// Exact-path + method matches only: /api/hosted/workspaces/:id (admin
// inspect/delete) intentionally stays behind authenticateProtectedApi, and
// x-org-role spoofing is impossible here because public forwards use the
// stripped header set (x-cleanup-secret is deliberately preserved).
function isHostedPublicRequest(pathname, method) {
  if (pathname === '/api/hosted/capacity') return method === 'GET';
  if (pathname === '/api/hosted/workspaces') return method === 'POST';
  if (pathname === '/api/hosted/cleanup') return method === 'POST';
  if (pathname === '/api/hosted/funnel') return method === 'GET';
  return false;
}

// v7.3 self-governance proof surface. Same posture as the hosted public
// routes: reachable without an API key, GET + exact path only, and the route
// self-guards — 404 unless DASHCLAW_SELF_GOVERNANCE_PUBLIC. Aggregate-only
// payload (no org identifiers, no free-text columns); exposure boundary in
// docs/superpowers/specs/2026-07-05-self-governance-proof-v73.md.
function isSelfGovernancePublicRequest(pathname, method) {
  return pathname === '/api/self-governance' && method === 'GET';
}

// v5.1 "a way back in": trial session minted by POST /api/hosted/workspaces.
// resolveTrialSession verifies ONLY the trial cookie (it gates on
// DASHCLAW_HOSTED=true internally, so on non-hosted instances it always
// returns null). We call it only after getToken + the local-admin lookup
// have both returned null, so re-running the full viewer chain here would be
// wasted edge crypto.
async function getTrialSession(request) {
  return resolveTrialSession(request.headers.get('cookie') || '', process.env);
}

// Use for every error rejection from middleware so the per-response headers
// are always applied. Bare `NextResponse.json()` returns leak the gap of
// missing X-Frame-Options / X-Content-Type-Options / X-XSS-Protection / HSTS
// on every 4xx/5xx the auth path emits. Accepts ResponseInit so callers can
// pass status + extra headers (e.g. Retry-After).
function securedJson(request, payload, init = {}) {
  const response = NextResponse.json(payload, init);
  addSecurityHeaders(response, request);
  // Apply the same CORS headers the success/public exit paths set. Without
  // this, a configured cross-origin browser client can complete the preflight
  // and read 2xx bodies but a 401/403/429/413/503 is blocked as a CORS error,
  // so the client cannot read the real status or message. getCorsHeaders only
  // emits Access-Control-Allow-Origin when ALLOWED_ORIGIN matches, so this does
  // not widen the allow-list; it only closes the success-vs-error asymmetry.
  withCors(request, response);
  return response;
}

// SECURITY: Timing-safe string comparison to prevent timing attacks.
// Normalizes both inputs to the same length to avoid leaking length info.
function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const encoder = new TextEncoder();
  const aBuf = encoder.encode(a);
  const bBuf = encoder.encode(b);

  // Use the longer length so we always do the same amount of work
  const maxLen = Math.max(aBuf.length, bBuf.length);
  let result = aBuf.length ^ bBuf.length; // non-zero if lengths differ

  for (let i = 0; i < maxLen; i++) {
    result |= (aBuf[i] || 0) ^ (bBuf[i] || 0);
  }
  return result === 0;
}

// SECURITY: Hash API key using Web Crypto API (Edge-compatible)
async function hashApiKey(key) {
  const encoder = new TextEncoder();
  const data = encoder.encode(key);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Shared bound for the TTL caches below (same shape as pruneApiKeyCache /
// pruneRateLimitMap): drop what has already expired, then evict oldest-first
// until the Map is back under its cap. Every cache in this file is keyed by
// something a caller can vary per request, so an uncapped one is a memory leak
// under probing, not just under load.
function pruneTtlCache(cache, now, ttl, maxEntries) {
  if (cache.size <= maxEntries) return;

  for (const [k, v] of cache.entries()) {
    if (!v || now - v.timestamp >= ttl) cache.delete(k);
  }

  if (cache.size > maxEntries) {
    let toDelete = cache.size - maxEntries;
    for (const key of cache.keys()) {
      cache.delete(key);
      toDelete--;
      if (toDelete <= 0) break;
    }
  }
}

// In-memory cache for org existence verification (1-hour TTL — orgs rarely change)
const orgExistsCache = new Map();
const ORG_EXISTS_CACHE_TTL = 60 * 60 * 1000;
const ORG_EXISTS_CACHE_MAX_ENTRIES = 10000;

// Self-host with local Postgres: Neon HTTP driver can't reach TCP-only Postgres.
// Fail open for the default org since migrations already seeded it.
// SECURITY: Require both self_host mode AND explicit postgres driver to prevent
// accidental fail-open on Neon-backed deployments that forgot to set DASHCLAW_MODE.
function shouldAssumeOrgExistsOffline(orgId) {
  const mode = getDashclawMode();
  const driver = (process.env.DASHCLAW_DB_DRIVER || '').toLowerCase();
  const isLocalPostgres = mode === 'self_host' && (driver === 'postgres' || driver === 'pg');
  return isLocalPostgres && orgId === 'org_default';
}

// Self-host Postgres: migrations already created the org — trust the bootstrap.
// Combined Lief (RyanTJoy commit 49c8ae3) + Elpolini (elpolini commit dbf5463) fix.
function isTrustedSelfHostBootstrap() {
  const dbUrl = process.env.DATABASE_URL || '';
  const isNeon = dbUrl.includes('.neon.tech') || dbUrl.includes('neon.tech');
  return !isNeon && isSelfHostModeEnabled();
}

async function verifyOrgExists(orgId) {
  const now = Date.now();
  pruneTtlCache(orgExistsCache, now, ORG_EXISTS_CACHE_TTL, ORG_EXISTS_CACHE_MAX_ENTRIES);
  const cached = orgExistsCache.get(orgId);
  if (cached && now - cached.timestamp < ORG_EXISTS_CACHE_TTL) {
    return cached.exists;
  }

  if (isTrustedSelfHostBootstrap()) {
    orgExistsCache.set(orgId, { timestamp: now, exists: true });
    return true;
  }

  try {
    const sql = neon(process.env.DATABASE_URL);
    const rows = await sql`SELECT 1 FROM organizations WHERE id = ${orgId} LIMIT 1`;
    const exists = rows.length > 0;
    orgExistsCache.set(orgId, { timestamp: now, exists });
    return exists;
  } catch (err) {
    console.error('[MIDDLEWARE] Failed to verify org existence:', err.message);
    if (shouldAssumeOrgExistsOffline(orgId)) {
      console.warn('[MIDDLEWARE] Self-host mode (local Postgres): assuming org_default exists (Neon HTTP driver unavailable).');
      orgExistsCache.set(orgId, { timestamp: now, exists: true });
      return true;
    }
    // SECURITY: Fail closed for non-default orgs, non-self-host deployments, or Neon driver.
    return false;
  }
}

// Hosted-trial org facts for trial-session requests (v5.1). Deliberately a
// SHORT TTL (60s, vs 1h for orgExistsCache): a cleanup-deleted or expired
// trial org must invalidate its outstanding sessions quickly.
//
// CRITICAL distinction — a DB lookup FAILURE is NOT the same as "org gone":
// this function THROWS on a transient DB error and returns null only when the
// query positively succeeds and the org is absent or non-trial. Callers must
// keep the two apart, because on the page path "org gone" clears the
// re-entry cookie while "DB blip" must preserve it (else one momentary Neon
// error permanently orphans a live trial — the exact failure this feature
// exists to prevent). Only definitive results are cached; a throw caches
// nothing, so a retry re-queries.
const trialOrgCache = new Map();
const TRIAL_ORG_CACHE_TTL = 60 * 1000;
const TRIAL_ORG_CACHE_MAX_ENTRIES = 10000;

async function resolveTrialOrg(orgId) {
  const now = Date.now();
  pruneTtlCache(trialOrgCache, now, TRIAL_ORG_CACHE_TTL, TRIAL_ORG_CACHE_MAX_ENTRIES);
  const cached = trialOrgCache.get(orgId);
  if (cached && now - cached.timestamp < TRIAL_ORG_CACHE_TTL) {
    return cached.result;
  }

  // No try/catch: a DB error propagates so the caller can distinguish it from
  // a definitive "not a trial org". Do not add one here.
  const sql = neon(process.env.DATABASE_URL);
  const rows = await sql`
    SELECT hosted_mode, claimed_at, trial_ends_at, trial_action_cap, trial_actions_used
    FROM organizations
    WHERE id = ${orgId}
    LIMIT 1
  `;
  const row = rows[0];
  // v5.13: a claimed org is owned — anonymous trial cookies stop resolving
  // (NextAuth sessions are the only way in). Definitive, so it caches; the
  // 60s TTL bounds how long an outstanding cookie survives a claim.
  const result = row && row.hosted_mode && !row.claimed_at
    ? {
        orgId,
        hostedMode: true,
        trialEndsAt: row.trial_ends_at,
        trialActionCap: row.trial_action_cap,
        trialActionsUsed: row.trial_actions_used,
      }
    : null;
  trialOrgCache.set(orgId, { timestamp: now, result });
  // v5.3: org-grain trial visit stamp (first/last seen — a timestamp, not
  // page-view analytics). Fire-and-forget AFTER the positive resolve so a
  // failed stamp never blocks a request or disturbs the transient-vs-gone
  // contract above. Runs only on a cache-miss positive resolution, so the
  // 60s cache doubles as the write throttle.
  if (result) {
    sql`
      UPDATE organizations
      SET trial_first_seen_at = COALESCE(trial_first_seen_at, NOW()),
          trial_last_seen_at = NOW()
      WHERE id = ${orgId} AND hosted_mode = TRUE
    `.catch(() => {});
  }
  return result;
}

// In-memory cache for API key -> org resolution.
//
// The POSITIVE TTL is deliberately SECONDS, not minutes. Revoking a leaked key
// has to stop it everywhere, and invalidateApiKeyCache() below can only reach
// the Map in ITS OWN process — middleware and the /api/keys DELETE handler
// routinely run on different edge/serverless instances, so on every other warm
// instance this TTL is the only thing that expires the principal. It used to be
// 5 minutes, which meant an operator who had just revoked a key got a success
// response while the key kept serving full org read/write. 10s bounds that at
// human scale and still keeps the hot path at <=1 key query per key per 10s per
// instance. Do not "optimize" it back to minutes.
const apiKeyCache = new Map();
const API_KEY_CACHE_TTL = 10 * 1000;
// A negative answer (no such key) carries no revocation risk and damps
// credential probing, so it keeps the original longer life.
const API_KEY_NEGATIVE_CACHE_TTL = 5 * 60 * 1000;
const API_KEY_CACHE_MAX_ENTRIES = 10000;

function apiKeyCacheTtl(entry) {
  return entry && entry.result ? API_KEY_CACHE_TTL : API_KEY_NEGATIVE_CACHE_TTL;
}

function pruneApiKeyCache(now) {
  if (apiKeyCache.size <= API_KEY_CACHE_MAX_ENTRIES) return;

  // Drop expired entries first.
  for (const [k, v] of apiKeyCache.entries()) {
    if (!v || now - v.timestamp >= apiKeyCacheTtl(v)) {
      apiKeyCache.delete(k);
    }
  }

  // If still too large, evict oldest entries (insertion order).
  if (apiKeyCache.size > API_KEY_CACHE_MAX_ENTRIES) {
    let toDelete = apiKeyCache.size - API_KEY_CACHE_MAX_ENTRIES;
    for (const key of apiKeyCache.keys()) {
      apiKeyCache.delete(key);
      toDelete--;
      if (toDelete <= 0) break;
    }
  }
}

/**
 * Drop a resolved API key from this instance's cache so a revoke takes effect
 * immediately here, instead of after the TTL. Mirrors
 * invalidateGuardPolicyCache / invalidateGuardSettingsCache in
 * app/lib/guard/caches.ts. Call it from the key-revoke path with the key's
 * SHA-256 hash; no argument clears everything.
 *
 * This is the FAST path, not the guarantee — see API_KEY_CACHE_TTL above for
 * why the TTL is what actually holds cross-instance.
 *
 * DELIBERATELY NOT called from DELETE /api/keys (2026-08-11). Reaching it from
 * a route means importing this module — the middleware entrypoint, ~85KB with
 * its own `config` export — into that route's bundle, and it would still only
 * clear the Map in whichever instance happened to serve the DELETE. The TTL
 * already bounds every instance at 10s, so the import buys ~10s on one of them
 * for real bundle and runtime risk. If the key cache ever moves into
 * app/lib/ (the pattern guard/caches.ts already follows), wire it then.
 */
export function invalidateApiKeyCache(keyHash) {
  if (keyHash) apiKeyCache.delete(keyHash);
  else apiKeyCache.clear();
}

/**
 * Current size and cap of every TTL cache in this file.
 * Exported for unit tests only (__tests__/unit/middleware-auth-precedence.test.js
 * pins that none of them grows without bound) — do not call in production code.
 * @internal
 */
export function __cacheStatsForTesting() {
  return {
    apiKey: { size: apiKeyCache.size, max: API_KEY_CACHE_MAX_ENTRIES },
    orgExists: { size: orgExistsCache.size, max: ORG_EXISTS_CACHE_MAX_ENTRIES },
    trialOrg: { size: trialOrgCache.size, max: TRIAL_ORG_CACHE_MAX_ENTRIES },
  };
}

// Self-host on TCP-only Postgres: the edge-runtime middleware can't open a TCP
// socket, so it delegates key resolution to an internal Node route (which uses
// the runtime-aware TCP driver). Returns the resolved principal or null;
// THROWS on a transient failure so the caller can fail closed without caching.
//
// SECURITY: this fetch carries the operator key, so its base URL must NEVER be
// built from the raw incoming Host header — a spoofed Host would exfiltrate the
// key to an attacker-controlled origin. Trust order: explicit env override →
// loopback request host → loopback on the server's own PORT → request host that
// matches ALLOWED_ORIGIN/NEXTAUTH_URL. Anything else throws (fail closed).
function internalResolveBaseUrl(request) {
  const explicit = process.env.DASHCLAW_INTERNAL_BASE_URL;
  if (explicit) return explicit.replace(/\/$/, '');
  const reqUrl = request?.nextUrl || new URL(request.url);
  const hostname = String(reqUrl.hostname || '').toLowerCase();
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]') {
    return reqUrl.origin;
  }
  if (process.env.PORT) return `http://127.0.0.1:${process.env.PORT}`;
  const allowedHosts = [process.env.ALLOWED_ORIGIN, process.env.NEXTAUTH_URL]
    .filter(Boolean)
    .map((u) => { try { return new URL(u).host.toLowerCase(); } catch { return null; } })
    .filter(Boolean);
  if (allowedHosts.includes(String(reqUrl.host || '').toLowerCase())) return reqUrl.origin;
  throw new Error('internal resolve-key: untrusted Host header and no DASHCLAW_INTERNAL_BASE_URL/PORT configured');
}

async function resolveApiKeyViaInternalRoute(keyHash, request) {
  const operatorKey = process.env.DASHCLAW_API_KEY || '';
  const res = await fetch(`${internalResolveBaseUrl(request)}/api/internal/resolve-key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-internal-auth': operatorKey },
    body: JSON.stringify({ keyHash }),
  });
  if (!res.ok) {
    // The route's 500 body carries the underlying Postgres error code (if any)
    // so the schema-vs-connection distinction survives the internal hop.
    const data = await res.json().catch(() => ({}));
    throw new AuthLookupUnavailableError(
      classifyAuthLookupFailure({ code: data?.code }),
      new Error(`internal resolve-key ${res.status}`)
    );
  }
  const data = await res.json().catch(() => ({}));
  return data?.resolved ?? null;
}

// ── Auth-lookup failure honesty ─────────────────────────────────────────────
// A credential-lookup FAILURE is NOT the same as "key invalid" (the same
// principle resolveTrialOrg documents above for trial orgs). If the schema is
// stale or the database is unreachable, the key was never checked — answering
// 401 "Invalid API key" sends a brand-new operator debugging the wrong thing
// (their key) instead of the real one (their instance). Classified failures
// surface as 503 with the same SCHEMA_NOT_INITIALIZED / DB_CONNECTION_FAILED
// shape the operator-key path and app/lib/apiErrors.ts already use.
// Fail-closed is preserved: a 503 still denies the request; the only path to
// an authenticated forward is a positive DB answer.
class AuthLookupUnavailableError extends Error {
  constructor(kind, cause) {
    super(`auth lookup unavailable (${kind}): ${cause?.message || cause}`);
    this.name = 'AuthLookupUnavailableError';
    this.kind = kind; // 'schema' | 'connection' | 'unknown'
  }
}

// Mirrors app/lib/apiErrors.ts (42P01 → schema, 08xxx → connection); the edge
// middleware keeps its own copy rather than importing the TS module.
function classifyAuthLookupFailure(err) {
  const code = String(err?.code || err?.sourceError?.code || '');
  if (code === '42P01' || code === '42703') return 'schema'; // undefined_table / undefined_column
  if (code.startsWith('08') || code === '57P03') return 'connection';
  if (['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'EAI_AGAIN'].includes(code)) return 'connection';
  // The Neon HTTP driver surfaces network failure as a fetch TypeError.
  if (err instanceof TypeError && /fetch/i.test(err?.message || '')) return 'connection';
  return 'unknown';
}

const AUTH_UNAVAILABLE_BODIES = {
  schema: {
    error: 'Could not verify the API key: the database schema is missing or behind the code (the key itself was not checked). Run migrations — npm run db:migrate locally, or POST to /api/setup/migrate — then retry.',
    code: 'SCHEMA_NOT_INITIALIZED',
  },
  connection: {
    error: 'Could not verify the API key: the database is unreachable (the key itself was not checked). Check DATABASE_URL and that the database is up, then retry.',
    code: 'DB_CONNECTION_FAILED',
  },
  unknown: {
    error: 'Could not verify the API key: the credential lookup failed (the key itself was not checked). Check the server logs and /setup, then retry.',
    code: 'AUTH_LOOKUP_FAILED',
  },
};

function authLookupUnavailableResponse(request, kind) {
  const shape = AUTH_UNAVAILABLE_BODIES[kind] || AUTH_UNAVAILABLE_BODIES.unknown;
  const body = { ...shape, setup_url: '/setup' };
  if (body.code === 'SCHEMA_NOT_INITIALIZED') body.migrate_url = '/api/setup/migrate';
  return securedJson(request, body, { status: 503 });
}

async function resolveApiKey(keyHash, request) {
  const now = Date.now();
  pruneApiKeyCache(now);
  const cached = apiKeyCache.get(keyHash);
  if (cached && now - cached.timestamp < apiKeyCacheTtl(cached)) {
    return cached.result;
  }

  // Self-host (non-Neon) resolves through the internal Node route; hosted/Neon
  // keeps the inline HTTP-driver path below, byte-identical. Same gate as the
  // route itself enforces (non-Neon URL AND self_host mode).
  if (isTrustedSelfHostBootstrap()) {
    try {
      const result = await resolveApiKeyViaInternalRoute(keyHash, request);
      apiKeyCache.set(keyHash, { timestamp: now, result });
      return result;
    } catch (err) {
      console.error('[AUTH] Self-host API key resolution failed:', err.message);
      // Fail closed, but do NOT cache — a later request retries. Throw
      // (classified) so the caller answers 503 "verification unavailable",
      // never 401 "key invalid": the key was not checked.
      throw err instanceof AuthLookupUnavailableError
        ? err
        : new AuthLookupUnavailableError(classifyAuthLookupFailure(err), err);
    }
  }

  try {
    const sql = neon(process.env.DATABASE_URL);
    const rows = await sql`
      SELECT ak.id, ak.org_id, ak.role, ak.revoked_at,
             o.hosted_mode, o.trial_ends_at, o.trial_action_cap, o.trial_actions_used, o.plan
      FROM api_keys ak
      LEFT JOIN organizations o ON o.id = ak.org_id
      WHERE ak.key_hash = ${keyHash}
      LIMIT 1
    `;

    if (rows.length === 0) {
      apiKeyCache.set(keyHash, { timestamp: now, result: null });
      return null;
    }

    const row = rows[0];
    if (row.revoked_at) {
      apiKeyCache.set(keyHash, { timestamp: now, result: null });
      return null;
    }

    const result = {
      keyId: row.id,
      orgId: row.org_id,
      role: row.role,
      hostedMode: row.hosted_mode === true,
      trialEndsAt: row.trial_ends_at,
      trialActionCap: row.trial_action_cap,
      trialActionsUsed: row.trial_actions_used,
      plan: row.plan,
    };
    apiKeyCache.set(keyHash, { timestamp: now, result });

    // Update last_used_at (fire and forget); first_used_at set once (v5.3 —
    // a first use is by definition a cache miss, so the stamp is exact).
    sql`UPDATE api_keys SET last_used_at = CURRENT_TIMESTAMP, first_used_at = COALESCE(first_used_at, CURRENT_TIMESTAMP) WHERE key_hash = ${keyHash}`.catch(() => {});

    return result;
  } catch (err) {
    console.error('[AUTH] API key lookup failed:', err.message);
    // The lookup failed — the key was neither validated nor rejected. Throw
    // (classified) so handleDatabaseKey answers 503, not a misleading 401.
    // Nothing is cached, so a later request retries. (On self-host with
    // TCP-only Postgres the Neon HTTP driver always lands here; the 503's
    // DB_CONNECTION_FAILED body points at the instance, not the key.)
    throw new AuthLookupUnavailableError(classifyAuthLookupFailure(err), err);
  }
}

// In-memory cache mirrors resolveApiKey (5-min TTL).
const oauthTokenCache = new Map();
const OAUTH_TOKEN_CACHE_TTL = 5 * 60 * 1000;
const OAUTH_TOKEN_CACHE_MAX_ENTRIES = 10000;

// Bound cache growth under adversarial token probing (mirrors pruneApiKeyCache).
function pruneOAuthTokenCache(now) {
  if (oauthTokenCache.size <= OAUTH_TOKEN_CACHE_MAX_ENTRIES) return;
  for (const [k, v] of oauthTokenCache.entries()) {
    if (!v || now - v.timestamp >= OAUTH_TOKEN_CACHE_TTL) oauthTokenCache.delete(k);
  }
  if (oauthTokenCache.size > OAUTH_TOKEN_CACHE_MAX_ENTRIES) {
    let toDelete = oauthTokenCache.size - OAUTH_TOKEN_CACHE_MAX_ENTRIES;
    for (const key of oauthTokenCache.keys()) {
      oauthTokenCache.delete(key);
      toDelete--;
      if (toDelete <= 0) break;
    }
  }
}

async function resolveOAuthToken(tokenHash) {
  const now = Date.now();
  pruneOAuthTokenCache(now);
  const cached = oauthTokenCache.get(tokenHash);
  if (cached && now - cached.timestamp < OAUTH_TOKEN_CACHE_TTL) return cached.result;
  try {
    const sql = neon(process.env.DATABASE_URL);
    const rows = await sql`
      SELECT org_id, expires_at, revoked_at
      FROM oauth_access_tokens
      WHERE token_hash = ${tokenHash}
      LIMIT 1
    `;
    let result = null;
    if (rows.length > 0) {
      const r = rows[0];
      const live = !r.revoked_at && new Date(r.expires_at).getTime() > now;
      if (live) {
        result = { orgId: r.org_id, role: 'member' };
        sql`UPDATE oauth_access_tokens SET last_used_at = NOW() WHERE token_hash = ${tokenHash}`.catch(() => {});
      }
    }
    oauthTokenCache.set(tokenHash, { timestamp: now, result });
    return result;
  } catch (err) {
    console.error('[AUTH] OAuth token lookup failed:', err.message);
    // Same contract as resolveApiKey: a lookup failure is not "token invalid".
    // Throw (classified) so handleBearerAuth answers 503; nothing is cached.
    throw new AuthLookupUnavailableError(classifyAuthLookupFailure(err), err);
  }
}

function mcpAuthChallenge(request) {
  const host = request.headers.get('host');
  const proto = request.headers.get('x-forwarded-proto') || 'https';
  const base = process.env.DASHCLAW_URL ? process.env.DASHCLAW_URL.replace(/\/$/, '') : `${proto}://${host}`;
  return securedJson(request, { error: 'authorization_required' }, {
    status: 401,
    headers: { 'WWW-Authenticate': `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource"` },
  });
}

function enforceHostedTrial(auth) {
  if (!auth || !auth.hostedMode) return null;
  if (auth.trialEndsAt && new Date(auth.trialEndsAt).getTime() < Date.now()) {
    return {
      status: 403,
      body: { error: 'trial expired', trial_ends_at: auth.trialEndsAt },
    };
  }
  // Note: actionsUsed may be up to 5min stale due to apiKeyCache; acceptable for Plan 1
  if (auth.trialActionCap != null && auth.trialActionsUsed >= auth.trialActionCap) {
    return {
      status: 403,
      body: {
        error: 'trial action cap reached',
        trial_action_cap: auth.trialActionCap,
        trial_actions_used: auth.trialActionsUsed,
      },
    };
  }
  return null;
}

// Monthly governed-action ceiling (hosted paid tier — G4, v5.12 metering +
// docs/decisions/2026-08-09-hosted-paid-tier.md). Mirrors enforceHostedTrial's
// shape/status, but scoped narrowly: only the two routes that actually create
// a governed action (the createActionRecord funnel) trip it, not every
// request. Free hosted orgs never trip this — they're governed by the
// lifetime trial_action_cap (enforceHostedTrial) instead;
// entitlements.actionCeilingExceeded already returns false for a plan with
// no monthly ceiling, so this needs no separate free-plan branch.
function isGovernedActionCreationRequest(pathname, method, url) {
  if (method !== 'POST') return false;
  if (pathname === '/api/actions') return true;
  if (pathname === '/api/guard') return url.searchParams.get('record') === 'true';
  return false;
}

async function enforceActionCeiling(auth, request, pathname) {
  if (!auth || !auth.hostedMode) return null;
  const url = request.nextUrl || new URL(request.url);
  if (!isGovernedActionCreationRequest(pathname, request.method, url)) return null;

  let governedActions;
  try {
    governedActions = await getGovernedActionsThisPeriod(neon(process.env.DATABASE_URL), auth.orgId);
  } catch (err) {
    // Metering is best-effort (see usage.repository.ts header) — a read
    // failure here must not block a real governed action. Fail open.
    console.error('[MIDDLEWARE] Failed to read usage rollup for ceiling check:', err.message);
    return null;
  }

  if (!actionCeilingExceeded(auth.plan, governedActions)) return null;
  return {
    status: 403,
    body: {
      error: 'monthly action ceiling reached',
      code: 'ACTION_CEILING_REACHED',
      monthly_action_ceiling: entitlementsForPlan(auth.plan).monthlyActionCeiling,
      governed_actions: governedActions,
    },
  };
}

// ── Public .well-known aliases ──────────────────────────────────────────────
// Public JWKS + OAuth metadata discovery aliases (RFC 8414 / 9728).
// /.well-known/jwks.json rewrites (next.config.js) to /api/integrity/jwks and
// the oauth-* paths rewrite to /api/oauth/metadata/*, but the rewrite resolves
// below the matcher, so these aliases would otherwise skip the rate limiter
// and security headers that the canonical /api paths get. Apply them here,
// then pass through (public, no auth).
const WELL_KNOWN_PUBLIC_ALIASES = [
  '/.well-known/jwks.json',
  '/.well-known/oauth-authorization-server',
  '/.well-known/oauth-protected-resource',
];

async function handleWellKnownAlias(request, pathname) {
  if (!WELL_KNOWN_PUBLIC_ALIASES.includes(pathname)) return null;
  const ip = getClientIp(request);
  if (!(await checkRateLimit(`${ip}:${pathname}`))) {
    return securedJson(request, { error: 'Rate limit exceeded. Please slow down.' }, { status: 429, headers: { 'Retry-After': '60' } });
  }
  return forwardWithHeaders(request);
}

// ── Page routes (non-API): NextAuth session gating ──────────────────────────

// Forward org context to the page's server component via request headers,
// so `headers().get('x-org-id')` returns the authenticated org instead of
// falling back to 'org_default'. Strip any inbound values first to prevent
// spoofing — only this middleware should set these.
function buildPageOrgHeaders(request, session) {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.delete('x-org-id');
  requestHeaders.delete('x-org-role');
  requestHeaders.delete('x-user-id');
  requestHeaders.set('x-org-id', session.orgId || 'org_default');
  requestHeaders.set('x-org-role', session.role || 'member');
  requestHeaders.set('x-user-id', session.userId || (session.sub === 'local-admin' ? 'usr_local_admin' : session.sub || ''));
  return requestHeaders;
}

// Landing page and the setup flow are always public.
function isPublicPagePath(pathname) {
  // /connect is matched only for the ?leave=trial cookie-clear handler in
  // handlePageRequest; as a page it stays fully public.
  return pathname === '/' || pathname === '/connect' || pathname === '/setup' || pathname.startsWith('/setup/');
}

// v5.1: a trial cookie was presented but is unusable (expired JWT, bad
// signature, or the org was cleaned up). Clear it and land on an honest
// "trial ended" state with the mint path visible — never a dead /login,
// which (without an OAuth provider configured) has nothing a stranger can
// click.
function trialExpiredRedirect(request) {
  const response = NextResponse.redirect(new URL('/connect?trial=expired', request.url));
  response.cookies.delete(TRIAL_SESSION_COOKIE);
  return response;
}

// Trial-session page access (v5.1). Returns one of:
//   { session }          — cookie valid AND its org is a live hosted trial
//   { expired: true }    — cookie present but DEFINITIVELY unusable (bad/
//                          expired JWT, or the org was cleaned up): the
//                          caller clears the cookie and routes to the honest
//                          trial-ended page
//   { expired: false }   — no trial cookie, OR a transient DB error while
//                          resolving the org: the caller must NOT clear the
//                          cookie (a still-valid session must survive a Neon
//                          blip and work on retry) — it just falls through to
//                          /login for this one request.
// On non-hosted instances getTrialSession is mechanically inert, so a forged
// trial cookie falls through to /login like any anonymous request.
async function authenticateTrialPage(request) {
  const cookieHeader = request.headers.get('cookie') || '';
  if (!hasTrialSessionCookie(cookieHeader)) {
    return { session: null, expired: false };
  }
  const trialSession = await getTrialSession(request);
  if (trialSession) {
    try {
      const org = await resolveTrialOrg(trialSession.orgId);
      if (org) return { session: trialSession, expired: false };
      // Query succeeded, org is absent/non-trial → genuinely gone.
    } catch (err) {
      // Transient DB failure — the JWT is still valid; preserve the cookie
      // and deny only this request so a retry gets back in.
      console.error('[AUTH] Trial page org lookup failed (transient, cookie preserved):', err.message);
      return { session: null, expired: false };
    }
  }
  // Cookie present but the JWT is bad/expired, OR the org is definitively
  // gone. Only an actual hosted instance routes to the trial-ended page;
  // elsewhere a trial cookie is just an unknown cookie.
  return { session: null, expired: process.env.DASHCLAW_HOSTED === 'true' };
}

async function handlePageRequest(request, pathname, clearStaleDemoCookie) {
  // v5.13: explicit trial sign-out from the /connect workspace card. Clears
  // only the trial cookie and lands back on plain /connect. Same-origin
  // navigations only (the card's confirm flow) so a cross-site link can't
  // silently log a visitor out of an unclaimed trial — for those, the cookie
  // is the only credential. Lives here because the middleware already owns
  // the rest of the trial-cookie lifecycle (expiry clear, claim clear).
  if (
    pathname === '/connect' &&
    request.nextUrl.searchParams.get('leave') === 'trial' &&
    request.headers.get('sec-fetch-site') === 'same-origin' &&
    hasTrialSessionCookie(request.headers.get('cookie') || '')
  ) {
    const response = NextResponse.redirect(new URL('/connect', request.url));
    response.cookies.delete(TRIAL_SESSION_COOKIE);
    return response;
  }

  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });

  // /login — redirect to the hero surface if already logged in
  if (pathname === '/login') {
    if (token) return NextResponse.redirect(new URL('/approvals', request.url));
    const trial = await authenticateTrialPage(request);
    if (trial.session) return NextResponse.redirect(new URL('/approvals', request.url));
    // A visitor who lands on /login carrying a DEFINITIVELY-dead trial cookie
    // gets the same honest trial-ended routing as every protected page —
    // otherwise the behavior is inconsistent by entry point, and on hosted
    // /login has no working sign-in to offer them.
    if (trial.expired) return trialExpiredRedirect(request);
    return NextResponse.next();
  }

  if (isPublicPagePath(pathname)) {
    return NextResponse.next();
  }

  // All other matched page routes — require session
  let session = token;
  if (!session) {
    session = await getLocalAdminSession(request);
  }
  if (!session) {
    const trial = await authenticateTrialPage(request);
    if (trial.session) {
      session = trial.session;
    } else if (trial.expired) {
      return trialExpiredRedirect(request);
    } else {
      return NextResponse.redirect(new URL('/login', request.url));
    }
  }

  const response = NextResponse.next({ request: { headers: buildPageOrgHeaders(request, session) } });
  // Best-effort: an authenticated visitor still carrying the stale dashclaw_demo
  // cookie (kicked the tires, then signed in) gets it cleared here, on the first
  // page request. API requests already bypass demo via the principal check, so
  // clearing it on any page navigation is enough to make the whole session clean.
  if (clearStaleDemoCookie) {
    response.cookies.delete('dashclaw_demo');
  }
  return response;
}

// ── Real /api/* flow: rate limit, body cap, public routes, authentication ──

// SECURITY: Always strip externally-provided org context headers for API routes.
// Only middleware should inject these after authenticating the request.
// NOTE: x-cleanup-secret is intentionally NOT stripped — it is a
// caller-authenticating header that the hosted/cleanup route handler
// must see to validate against HOSTED_CLEANUP_SECRET. Stripping it would
// break the GH-Actions cleanup flow.
function stripUntrustedApiHeaders(request) {
  const h = new Headers(request.headers);
  h.delete('x-org-id');
  h.delete('x-org-role');
  h.delete('x-user-id');
  h.delete('x-client-ip');
  return h;
}

// SECURITY: Reject oversized request bodies to prevent DoS.
// Applies to all write methods (POST, PUT, PATCH) on API routes.
//
// The default 2 MB cap is enough for every governance API.
const DEFAULT_MAX_BODY_BYTES = 2 * 1024 * 1024;

function enforceBodySizeCap(request) {
  const maxBodyBytes = DEFAULT_MAX_BODY_BYTES;
  const writeMethod = ['POST', 'PUT', 'PATCH'].includes(request.method);
  if (!writeMethod) return null;
  const contentLength = parseInt(request.headers.get('content-length') || '0', 10);
  if (contentLength > maxBodyBytes) {
    return securedJson(request,
      { error: 'Request body too large', maxBytes: maxBodyBytes },
      { status: 413 }
    );
  }
  return null;
}

function forwardPublicApi(request, strippedApiRequestHeaders, ip) {
  const publicHeaders = new Headers(strippedApiRequestHeaders);
  publicHeaders.set('x-client-ip', ip);
  // Public routes must still get the per-response security headers (X-Frame-Options,
  // X-Content-Type-Options, X-XSS-Protection, prod HSTS). The earlier extraction
  // missed this exit path, so /api/health, /api/setup/*, /api/auth, /api/cron,
  // /api/docs/raw, /api/prompts, and /api/marketing were serving without them.
  return forwardWithHeaders(request, publicHeaders);
}

// Mirrors looksLikeJwt in app/lib/jwks-verifier.ts. Deliberately a copy, not an
// import: that module reaches app/lib/url-safety.ts, which imports node:dns —
// unavailable in the edge runtime this middleware compiles to.
function looksLikeJwt(token) {
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [header = '', payload = '', signature = ''] = parts;
  const base64url = /^[A-Za-z0-9_-]*$/;
  return header.length > 0 && payload.length > 0
    && base64url.test(header) && base64url.test(payload) && base64url.test(signature);
}

// OAuth Bearer path (Claude custom connectors). Additive — x-api-key still works.
// Returns null when no bearer token is present.
async function handleBearerAuth(request, pathname, requestHeaders) {
  const authz = request.headers.get('authorization') || '';
  const bearer = authz.slice(0, 7).toLowerCase() === 'bearer ' ? authz.slice(7).trim() : '';
  if (!bearer) return null;

  // The Authorization header carries two different things: an OAuth CREDENTIAL
  // (the AS mints opaque `oat_` tokens) and an agent IDENTITY claim (a JWT —
  // DashClawClient.authToken). Both SDKs send `x-api-key` AND the identity JWT
  // on every request once authToken is configured (sdk/dashclaw.js
  // `_authHeaders`), so resolving the JWT against oauth_access_tokens, missing,
  // and 401ing broke EVERY request for an operator who followed the documented
  // Phase-2 setup — the valid key on the same request was never examined.
  // A JWT is never an oauth_access_tokens row, so skip the lookup entirely and
  // let the x-api-key / session path decide. Only an opaque bearer is a
  // credential, and one that resolves to nothing still fails below.
  if (looksLikeJwt(bearer)) return null;

  const tokenHash = await hashApiKey(bearer); // Web Crypto SHA-256 hex (matches hashToken)
  let oauth;
  try {
    oauth = await resolveOAuthToken(tokenHash);
  } catch (err) {
    // Infra failure: the token was never checked. A 503 is honest; the /api/mcp
    // OAuth challenge would be wrong here (a new token wouldn't help).
    const kind = err instanceof AuthLookupUnavailableError ? err.kind : 'unknown';
    console.error(`[AUTH] Bearer verification unavailable (${kind}) for ${pathname}`);
    return authLookupUnavailableResponse(request, kind);
  }
  if (oauth) {
    requestHeaders.set('x-org-id', oauth.orgId);
    requestHeaders.set('x-org-role', oauth.role);
    // Authorization passes through (not stripped) so the /api/mcp proxy can
    // forward it to its own internal callbacks.
    return forwardWithHeaders(request, requestHeaders);
  }
  // Bad/expired bearer: challenge on /api/mcp so Claude re-runs discovery.
  if (pathname === '/api/mcp') return mcpAuthChallenge(request);
  return securedJson(request, { error: 'Unauthorized - invalid token' }, { status: 401 });
}

// If no API key is configured:
// - dev/local: allow with org_default (convenience)
// - production: block (prevents accidentally exposing your dashboard data)
function handleNoConfiguredKey(request, requestHeaders) {
  // SECURITY: Fail closed if not strictly in development mode
  if (process.env.NODE_ENV !== 'development') {
    console.warn('[SECURITY] DASHCLAW_API_KEY not set - blocking API access.');
    return securedJson(request,
      { error: 'Server misconfigured: set DASHCLAW_API_KEY to protect /api/* endpoints.' },
      { status: 503 }
    );
  }
  // Dev mode: allow through with default org. Use the canonical
  // helper instead of hand-rolling — keeps every exit path on a
  // single source of truth so future header additions land here too.
  // (HSTS won't apply in dev because addSecurityHeaders gates it on
  // NODE_ENV=production; that's fine — dev runs over plain HTTP.)
  requestHeaders.set('x-org-id', 'org_default');
  requestHeaders.set('x-org-role', 'admin');
  // Dev-only path (NODE_ENV=development, no key configured) — attribute the
  // implicit principal so approvals/audit rows never carry an empty actor.
  requestHeaders.set('x-user-id', 'dev');
  return forwardWithHeaders(request, requestHeaders);
}

// No key provided — check if this is a same-origin dashboard request.
async function handleSessionAuth(request, pathname, requestHeaders) {
  // Claude connector discovery: an unauthenticated /api/mcp must answer with
  // 401 + WWW-Authenticate so the client starts the OAuth flow.
  if (pathname === '/api/mcp') return mcpAuthChallenge(request);

  const secFetchSite = request.headers.get('sec-fetch-site');

  // SECURITY: Only trust Sec-Fetch-Site for same-origin detection.
  const isSameOrigin = secFetchSite === 'same-origin';
  if (!isSameOrigin) {
    console.warn('[SECURITY] Missing API key on cross-origin API request.');
    return securedJson(request,
      { error: 'Unauthorized - Invalid or missing API key' },
      { status: 401 }
    );
  }

  // Resolve org from NextAuth session token
  let sessionToken = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });

  if (!sessionToken) {
    sessionToken = await getLocalAdminSession(request);
  }

  if (!sessionToken) {
    // v5.1: same-origin dashboard fetches from a trial session. The session
    // grants VISIBILITY — reads stay open so the dashboard remains legible
    // even at the action cap — while writes get exactly the trial envelope
    // the key path enforces (expiry + cap via enforceHostedTrial). Cheap
    // presence probe first so the no-cookie majority (logged-out browsers,
    // health checks) skip the trial verify entirely.
    let trialOrg = null;
    let trialSession = null;
    if (hasTrialSessionCookie(request.headers.get('cookie') || '')) {
      trialSession = await getTrialSession(request);
      if (trialSession) {
        try {
          trialOrg = await resolveTrialOrg(trialSession.orgId);
        } catch {
          // Transient DB error: 401 this fetch (the client retries). Unlike
          // the page path there is no cookie to preserve here.
          trialOrg = null;
        }
      }
    }
    if (!trialOrg) {
      return securedJson(request, { error: 'Unauthorized - Session required' }, { status: 401 });
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      const trialBlock = enforceHostedTrial(trialOrg);
      if (trialBlock) {
        return securedJson(request, trialBlock.body, { status: trialBlock.status });
      }
    }
    sessionToken = trialSession;
  }

  setSessionPrincipalHeaders(requestHeaders, sessionToken);
  // Use the canonical helper so HSTS in prod, the /replay/ frame-ancestors
  // exception, and any future header policy live in one place. The
  // inline triple-set was missing HSTS for same-origin dashboard calls.
  return forwardWithHeaders(request, requestHeaders);
}

function setSessionPrincipalHeaders(requestHeaders, sessionToken) {
  const orgId = sessionToken.orgId || 'org_default';
  const role = sessionToken.role || 'member';
  const userId = sessionToken.userId || (sessionToken.sub === 'local-admin' ? 'usr_local_admin' : '');

  requestHeaders.set('x-org-id', orgId);
  requestHeaders.set('x-org-role', role);
  requestHeaders.set('x-user-id', userId);
}

// Fast path: DASHCLAW_API_KEY matches → configured org (default: org_default)
async function handleOperatorKey(request, requestHeaders) {
  const configuredOrgId = process.env.DASHCLAW_API_KEY_ORG || 'org_default';

  // Validate that the configured org actually exists in the database (cached).
  const orgExists = await verifyOrgExists(configuredOrgId);
  if (!orgExists) {
    console.error('[SECURITY] DASHCLAW_API_KEY_ORG is set to a value that does not exist in the organizations table. Run migrations or create the org.');
    // SECURITY: Do not leak the configured org ID to the client or logs.
    return securedJson(request,
      {
        error: 'Database not initialized. Redeploy to trigger auto-migration, or POST to /api/setup/migrate.',
        code: 'SCHEMA_NOT_INITIALIZED',
        setup_url: '/setup',
        migrate_url: '/api/setup/migrate',
      },
      { status: 503 }
    );
  }

  requestHeaders.set('x-org-id', configuredOrgId);
  // Fast-path DASHCLAW_API_KEY is the bootstrap / self-host operator key
  // and is always admin by design — readonly scoping requires the slow-path
  // api_keys lookup below. (A 'readonly' gate previously lived here but
  // tested the header we had just set to 'admin', so it was dead code.)
  requestHeaders.set('x-org-role', 'admin');
  // Attribute the principal: approvals (and audit logs) must never record an
  // empty actor. The approve routes reject an empty x-user-id outright, so
  // without this the single-admin self-host operator could not approve at all.
  requestHeaders.set('x-user-id', 'operator');

  return forwardWithHeaders(request, requestHeaders);
}

// Slow path: hash the key and look up in api_keys table
async function handleDatabaseKey(request, pathname, requestHeaders, apiKey) {
  const keyHash = await hashApiKey(apiKey);
  let resolved;
  try {
    resolved = await resolveApiKey(keyHash, request);
  } catch (err) {
    // Infra failure (stale schema, DB unreachable): the key was never checked.
    // Deny with an honest 503 naming the fix, not a misleading 401.
    const kind = err instanceof AuthLookupUnavailableError ? err.kind : 'unknown';
    console.error(`[AUTH] API key verification unavailable (${kind}) for ${pathname}`);
    return authLookupUnavailableResponse(request, kind);
  }

  if (!resolved) {
    console.warn(`[SECURITY] Unauthorized API access attempt: ${pathname} from ${getClientIp(request)}`);
    return securedJson(request,
      { error: 'Unauthorized - Invalid or missing API key' },
      { status: 401 }
    );
  }

  requestHeaders.set('x-org-id', resolved.orgId);
  requestHeaders.set('x-org-role', resolved.role);
  // Attribute the principal to the key row (key_<uuid>). A stale cache entry
  // from before this field existed simply omits the header; the approve
  // routes then reject with APPROVER_IDENTITY_REQUIRED until the 5-min
  // cache entry rolls over — fail closed, never a blank approved_by.
  if (resolved.keyId) requestHeaders.set('x-user-id', String(resolved.keyId));

  const trialBlock = enforceHostedTrial(resolved);
  if (trialBlock) {
    return securedJson(request, trialBlock.body, { status: trialBlock.status });
  }

  const ceilingBlock = await enforceActionCeiling(resolved, request, pathname);
  if (ceilingBlock) {
    return securedJson(request, ceilingBlock.body, { status: ceilingBlock.status });
  }

  // SECURITY: Enforce readonly semantics for API keys.
  if (request.method !== 'GET' && request.method !== 'HEAD' && resolved.role === 'readonly') {
    return securedJson(request, { error: 'Forbidden - readonly API key' }, { status: 403 });
  }

  return forwardWithHeaders(request, requestHeaders);
}

// SECURITY: Default-deny for /api/* except explicit PUBLIC_ROUTES.
// This prevents new endpoints from silently becoming unauthenticated.
async function authenticateProtectedApi(request, pathname, strippedApiRequestHeaders, ip) {
  // SECURITY: Only accept API key via header (not query params - those leak in logs/URLs)
  const apiKey = request.headers.get('x-api-key');

  // Get expected API key from environment
  const expectedKey = process.env.DASHCLAW_API_KEY;

  // SECURITY: Start from stripped headers (prevent injection).
  const requestHeaders = new Headers(strippedApiRequestHeaders);
  // SECURITY: Provide a trusted client IP header for audit logging (never trust inbound x-forwarded-for directly).
  requestHeaders.set('x-client-ip', ip);

  const bearerResult = await handleBearerAuth(request, pathname, requestHeaders);
  if (bearerResult) return bearerResult;

  if (!expectedKey) return handleNoConfiguredKey(request, requestHeaders);

  if (!apiKey) return handleSessionAuth(request, pathname, requestHeaders);

  if (timingSafeEqual(apiKey, expectedKey)) return handleOperatorKey(request, requestHeaders);

  return handleDatabaseKey(request, pathname, requestHeaders, apiKey);
}

async function handleApiRequest(request, pathname) {
  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return new NextResponse(null, { status: 204, headers: getCorsHeaders(request) });
  }

  const strippedApiRequestHeaders = stripUntrustedApiHeaders(request);
  const ip = getClientIp(request);

  // SECURITY: Apply rate limiting to all API routes, including PUBLIC_ROUTES.
  // PUBLIC_ROUTES are unauthenticated but still should not be abusable for DoS/brute force.
  // Rate-limit key includes pathname to prevent single-endpoint DoS while allowing
  // broader access to other routes. Contributed by Elpolini (elpolini/DashClaw commit dbf5463).
  const rateLimitKey = `${ip}:${pathname}`;
  if (!(await checkRateLimit(rateLimitKey))) {
    console.warn(`[SECURITY] Rate limit exceeded for ${ip}: ${pathname}`);
    return securedJson(request,
      { error: 'Rate limit exceeded. Please slow down.' },
      { status: 429, headers: { 'Retry-After': '60' } }
    );
  }

  const oversizedBody = enforceBodySizeCap(request);
  if (oversizedBody) return oversizedBody;

  // Allow public routes without auth. Boundary-aware: an entry matches itself
  // and its subpaths only — bare startsWith let any future sibling sharing a
  // public prefix (/api/cron -> /api/cron-report) ship unauthenticated, the
  // same foot-gun that previously exposed the whole /api/prompts surface.
  if (PUBLIC_ROUTES.some(route => pathname === route || pathname.startsWith(route + '/')) ||
      isHostedPublicRequest(pathname, request.method) ||
      isSelfGovernancePublicRequest(pathname, request.method)) {
    return forwardPublicApi(request, strippedApiRequestHeaders, ip);
  }

  return authenticateProtectedApi(request, pathname, strippedApiRequestHeaders, ip);
}

export async function middleware(request) {
  const { pathname } = request.nextUrl;

  const wellKnown = await handleWellKnownAlias(request, pathname);
  if (wellKnown) return wellKnown;

  if (pathname === '/demo') {
    return handleDemoEntry(request);
  }

  const { serveDemoSandbox, clearStaleDemoCookie } = await resolveDemoState(request);
  if (serveDemoSandbox) {
    if (pathname.startsWith('/api/')) {
      return handleDemoApi(request, pathname);
    }
    // Demo pages are public: skip NextAuth session enforcement.
    return NextResponse.next();
  }

  // Page routes (non-API): check NextAuth session
  if (!pathname.startsWith('/api/')) {
    return handlePageRequest(request, pathname, clearStaleDemoCookie);
  }

  return handleApiRequest(request, pathname);
}

export const config = {
  matcher: [
    '/',
    '/api/:path*',
    '/.well-known/jwks.json',
    '/.well-known/oauth-authorization-server',
    '/.well-known/oauth-protected-resource',
    '/demo',
    '/approvals',
    '/approvals/:path*',
    '/widget',
    '/approve',
    '/approve/:path*',
    '/decisions',
    '/decisions/:path*',
    '/assumptions',
    '/assumptions/:path*',
    '/integrations',
    '/integrations/:path*',
    '/workflows/:path*',
    '/pair',
    '/pair/:path*',
    '/pairings',
    '/pairings/:path*',
    '/bug-hunter',
    '/bug-hunter/:path*',
    '/setup',
    '/setup/:path*',
    '/api-keys',
    '/api-keys/:path*',
    '/webhooks',
    '/webhooks/:path*',
    '/policies',
    '/policies/:path*',
    '/routing',
    '/routing/:path*',
    '/feedback',
    '/feedback/:path*',
    '/api/feedback/:path*',
    '/api/prompts/:path*',
    '/login',
    '/connect',
  ],
};
