import { NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { neon } from '@neondatabase/serverless';
import { getDemoFixtures } from './app/lib/demo/demoFixtures';
import {
  demoAgents,
  demoListActions, demoCreateAction, demoActionDetail, demoAssumptions,
  demoTokens, demoPolicies, demoPolicySummary, demoContract, demoReview, demoPolicySimulate, demoPolicyProof, demoPolicyTest, demoGuard, demoGuardPost,
  demoCalibrationController, demoDoctor,
  demoPlans, demoPlanDetail, demoActionArtifacts,
  demoTuningProposals, demoTighteningProposals, demoLooseningProposals, demoCalibrationProposals,
  demoContent, demoActivity,
  demoWebhooks, demoWebhookDeliveries, demoSchedules,
  demoDigest, demoContextPoints, demoContextThreads, demoContextThreadDetail,
  demoSnippets, demoPreferences, demoActionTrace,
  demoDecisionMetrics,
  demoSessions, demoSessionDetail, demoSessionEvents, demoSessionActions,
  demoIdentities, demoApiKeys,
  demoUsage,
  demoTeam,
} from './app/lib/demo/demoMiddleware';
import { getViewerContextFromCookieHeader, resolveTrialSession, hasTrialSessionCookie, TRIAL_SESSION_COOKIE } from './app/lib/sessionViewer.mjs';
import { isSelfHostModeEnabled } from './app/lib/selfHost';
import { addSecurityHeaders } from './app/lib/security-headers';

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

async function getLocalAdminSession(request) {
  const viewer = await getViewerContextFromCookieHeader(
    request.headers.get('cookie') || '',
    process.env
  );
  return viewer.authType === 'local' ? viewer.session : null;
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

function getDashclawMode() {
  return process.env.DASHCLAW_MODE || 'self_host';
}

function isDemoCookieSet(request) {
  return request.cookies.get('dashclaw_demo')?.value === '1';
}

function withCors(request, response) {
  for (const [k, v] of Object.entries(getCorsHeaders(request))) response.headers.set(k, v);
  return response;
}

function demoJson(request, payload, status = 200) {
  const response = NextResponse.json(payload, { status });
  addSecurityHeaders(response, request);
  withCors(request, response);
  return response;
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

// Canonical success/passthrough exit: forward the request (optionally with
// rewritten request headers) and apply the per-response security + CORS
// headers every authenticated/public exit path must carry.
function forwardWithHeaders(request, requestHeaders = null) {
  const response = requestHeaders
    ? NextResponse.next({ request: { headers: requestHeaders } })
    : NextResponse.next();
  addSecurityHeaders(response, request);
  withCors(request, response);
  return response;
}

function parseUrl(request) {
  return new URL(request.url);
}

function getPathSegments(pathname) {
  return pathname.split('/').filter(Boolean);
}

// Get client IP for rate limiting.
// SECURITY: In self-host deployments, x-forwarded-for may be attacker-controlled unless you trust your proxy.
// SECURITY: Only trust proxy headers (x-forwarded-for, x-real-ip) when TRUST_PROXY is enabled.
function isTrustProxyEnabled() {
  return ['1', 'true', 'yes', 'on'].includes(String(process.env.TRUST_PROXY || process.env.VERCEL || '').toLowerCase());
}

function getForwardedIp(request) {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
}

function getClientIp(request) {
  const forwardedIp = getForwardedIp(request);
  let ip = (isTrustProxyEnabled() ? (forwardedIp || request.headers.get('x-real-ip')) : null) ||
           request.ip ||
           'unknown';
  if (ip === 'unknown' && process.env.NODE_ENV === 'development') {
    ip = forwardedIp || '127.0.0.1';
  }
  return ip;
}


// SECURITY: In-memory rate limiting is local to the instance.
// For production multi-region deployments, use Redis or Upstash.
const rateLimitMap = new Map();
const RATE_LIMIT_DISABLED = (() => {
  const wants = ['1', 'true', 'yes', 'on'].includes(
    String(process.env.DASHCLAW_DISABLE_RATE_LIMIT || '').toLowerCase()
  );
  // SECURITY: Never allow rate limiting to be disabled in production.
  if (wants && process.env.NODE_ENV === 'production') {
    console.warn('[SECURITY] DASHCLAW_DISABLE_RATE_LIMIT is set but ignored in production.');
    return false;
  }
  return wants;
})();
const RATE_LIMIT_WINDOW = (() => {
  const v = parseInt(String(process.env.DASHCLAW_RATE_LIMIT_WINDOW_MS || ''), 10);
  return Number.isFinite(v) && v > 0 ? v : (60 * 1000); // 1 minute
})();
const RATE_LIMIT_MAX = (() => {
  const def = process.env.NODE_ENV === 'development' ? 1000 : 100;
  const v = parseInt(String(process.env.DASHCLAW_RATE_LIMIT_MAX || ''), 10);
  return Number.isFinite(v) && v > 0 ? v : def;
})(); // requests per window
const RATE_LIMIT_MAX_ENTRIES = 50000;

// Bound memory growth (best-effort).
function pruneRateLimitMap() {
  if (rateLimitMap.size <= RATE_LIMIT_MAX_ENTRIES) return;
  let toDelete = rateLimitMap.size - RATE_LIMIT_MAX_ENTRIES;
  for (const key of rateLimitMap.keys()) {
    rateLimitMap.delete(key);
    toDelete--;
    if (toDelete <= 0) break;
  }
}

function checkRateLimitLocal(ip) {
  const now = Date.now();
  const record = rateLimitMap.get(ip);

  if (!record || now - record.timestamp > RATE_LIMIT_WINDOW) {
    rateLimitMap.set(ip, { timestamp: now, count: 1 });
    pruneRateLimitMap();
    return true;
  }

  if (record.count >= RATE_LIMIT_MAX) {
    return false;
  }

  record.count++;
  return true;
}

async function checkRateLimitDistributed(ip) {
  const baseUrl = process.env.UPSTASH_REDIS_REST_URL || '';
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || '';
  if (!baseUrl || !token) return null;

  const key = `dashclaw:rl:${ip}`;
  const urlBase = baseUrl.replace(/\/+$/, '');

  const call = async (path) => {
    const res = await fetch(`${urlBase}/${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`upstash ${res.status}`);
    const data = await res.json().catch(() => ({}));
    return data?.result;
  };

  // Atomic-ish limiter: INCR then PEXPIRE on first hit.
  const n = await call(`INCR/${encodeURIComponent(key)}`);
  if (n === 1) {
    await call(`PEXPIRE/${encodeURIComponent(key)}/${RATE_LIMIT_WINDOW}`);
  }
  return typeof n === 'number' ? (n <= RATE_LIMIT_MAX) : null;
}

async function checkRateLimit(ip) {
  if (RATE_LIMIT_DISABLED) return true;
  try {
    const distributed = await checkRateLimitDistributed(ip);
    if (distributed !== null) return distributed;
  } catch (e) {
    // Fail open to local limiter if Upstash is misconfigured/unreachable.
    console.warn('[SECURITY] Distributed rate limit unavailable; falling back to local limiter.');
  }
  return checkRateLimitLocal(ip);
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

// In-memory cache for org existence verification (1-hour TTL — orgs rarely change)
const orgExistsCache = new Map();
const ORG_EXISTS_CACHE_TTL = 60 * 60 * 1000;

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

async function resolveTrialOrg(orgId) {
  const now = Date.now();
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

// In-memory cache for API key -> org resolution (5-min TTL)
const apiKeyCache = new Map();
const API_KEY_CACHE_TTL = 5 * 60 * 1000;
const API_KEY_CACHE_MAX_ENTRIES = 10000;

function pruneApiKeyCache(now) {
  if (apiKeyCache.size <= API_KEY_CACHE_MAX_ENTRIES) return;

  // Drop expired entries first.
  for (const [k, v] of apiKeyCache.entries()) {
    if (!v || now - v.timestamp >= API_KEY_CACHE_TTL) {
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
  if (cached && now - cached.timestamp < API_KEY_CACHE_TTL) {
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
             o.hosted_mode, o.trial_ends_at, o.trial_action_cap, o.trial_actions_used
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

// SECURITY: CORS - restrict to deployment origin
function getCorsHeaders(request) {
  const origin = request.headers.get('origin');
  const allowedOrigin = process.env.ALLOWED_ORIGIN || '';

  const headers = {
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-api-key',
    'Access-Control-Max-Age': '86400',
  };

  // In dev mode (no ALLOWED_ORIGIN set), allow the requesting origin
  // In production, only allow the configured origin
  if (allowedOrigin && origin === allowedOrigin) {
    headers['Access-Control-Allow-Origin'] = allowedOrigin;
  } else if (!allowedOrigin && process.env.NODE_ENV === 'development') {
    headers['Access-Control-Allow-Origin'] = origin || '*';
  }
  // In production with no match, no Access-Control-Allow-Origin header is set (blocks CORS)

  return headers;
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

// /demo is always a public entrypoint. Plain /demo lands first-time evaluators
// on the interactive marketing demo (no cookie, no auth-gated routes).
// /demo?sandbox=1 is the explicit "enter the demo dashboard" path (the navbar/
// footer demo CTAs): it mints the non-secret dashclaw_demo cookie and
// forwards into /decisions, where reads are served from deterministic
// fixtures and writes are blocked. /demo?leave=1 exits the sandbox.
function handleDemoEntry(request) {
  const leave = request.nextUrl.searchParams.get('leave') === '1';
  const sandbox = !leave && request.nextUrl.searchParams.get('sandbox') === '1';
  const target = sandbox ? '/decisions' : '/#live-demo';
  const response = NextResponse.redirect(new URL(target, request.url));

  if (leave) {
    response.cookies.delete('dashclaw_demo');
  } else if (sandbox) {
    response.cookies.set('dashclaw_demo', '1', {
      path: '/',
      maxAge: 60 * 60 * 24, // 24h
      sameSite: 'lax',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
    });
  }

  addSecurityHeaders(response, request);
  return response;
}

// Demo sandbox mode:
// - Serve the REAL dashboard UI.
// - Back /api/* reads with deterministic fixtures.
// - Block all writes (no secrets, no mutations).
// Demo sandbox: cookie or explicit DASHCLAW_MODE=demo. Cookie only provides fixture data, never real data.
// SECURITY: Only honor demo cookie when DASHCLAW_MODE=demo or on dashclaw.io to prevent self-host bypass
// Cookie-driven demo is only honored on marketing hosts and never overrides an
// explicit DASHCLAW_MODE=demo (that path forces demo for everyone, below).
function isCookieDemoRequest(request, mode) {
  // A hosted-trial instance is a REAL runtime, never a marketing sandbox —
  // even though it lives under *.dashclaw.io. Without this guard, a visitor
  // who clicked Live Demo (which mints dashclaw_demo on whatever host
  // they're on) gets every write on hosted.dashclaw.io demo-blocked,
  // including the trial mint itself.
  if (process.env.DASHCLAW_HOSTED === 'true') return false;
  const demoCookie = isDemoCookieSet(request);
  const host = request.headers.get('host') || '';
  const normalizedHost = host.split(':')[0].toLowerCase();
  const isMarketingHost =
    normalizedHost === 'dashclaw.io' || normalizedHost.endsWith('.dashclaw.io');
  return demoCookie && isMarketingHost && mode !== 'demo';
}

async function resolveDemoState(request) {
  const mode = getDashclawMode();
  const cookieDemo = isCookieDemoRequest(request, mode);
  // THE FIX (Instant Hosted Trial): a visitor who kicked the tires anonymously
  // (got the dashclaw_demo cookie via /demo) and then signed in now has a real
  // trial workspace. Resolve the auth principal LAZILY — only on the narrow
  // cookie-demo path — so normal requests pay nothing. An authenticated
  // principal (NextAuth token OR local-admin session) bypasses the demo and
  // falls through to the real runtime. This covers BOTH page and API requests.
  let demoBypassPrincipal = null;
  if (cookieDemo) {
    const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET }).catch(() => null);
    demoBypassPrincipal = token || (await getLocalAdminSession(request));
  }
  const clearStaleDemoCookie = Boolean(cookieDemo && demoBypassPrincipal);
  const serveDemoSandbox = mode === 'demo' || (cookieDemo && !demoBypassPrincipal);
  return { clearStaleDemoCookie, serveDemoSandbox };
}

// ── Demo sandbox: /api/* dispatch ───────────────────────────────────────────

// Allow simulated actions, assumptions, and guard checks in demo mode.
function isDemoSimulationRequest(pathname, method) {
  const simulationPath =
    pathname === '/api/guard' ||
    pathname === '/api/actions' ||
    pathname === '/api/assumptions' ||
    pathname.startsWith('/api/actions/');
  return simulationPath && (method === 'POST' || method === 'PATCH');
}

// Allow NextAuth internals and raw markdown passthrough (these do not write data).
// /api/prompts/{server-setup,agent-connect}/raw serve static markdown for the
// "Copy ... Prompt" buttons on /self-host and should work identically in demo.
// /api/hosted passes through so the instant-trial flow can run on the demo-mode
// marketing host: every hosted route self-guards with isHostedMode() (404 when
// DASHCLAW_HOSTED is unset), so this is inert until the operator flips that env.
// Without it, demo mode 403s /api/hosted/capacity and the trial CTA never renders.
// /api/session/effective returns ONLY the caller's own cookie-derived state
// ({authenticated:false} for an anonymous demo visitor — never org data), so
// it is safe to forward in demo mode. Without it the demo dispatch 403s the
// probe useEffectiveRole fires on every page, and every sandbox page logs a
// console error.
const DEMO_PASSTHROUGH_PREFIXES = ['/api/auth', '/api/docs/raw', '/api/hosted'];
const DEMO_PASSTHROUGH_EXACT = ['/api/prompts/server-setup/raw', '/api/prompts/agent-connect/raw', '/api/session/effective'];

function isDemoPassthroughPath(pathname) {
  return DEMO_PASSTHROUGH_PREFIXES.some(prefix => pathname.startsWith(prefix)) ||
    DEMO_PASSTHROUGH_EXACT.includes(pathname);
}

// SSE is allowed to keep UI stable. We attach demo org headers for getOrgId().
function forwardDemoStream(request) {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-org-id', 'org_demo');
  requestHeaders.set('x-org-role', 'admin');
  return forwardWithHeaders(request, requestHeaders);
}

// Exact-length segment pattern match; '*' matches any single segment.
function segmentsMatch(segments, pattern) {
  if (segments.length !== pattern.length) return false;
  return pattern.every((part, i) => part === '*' || segments[i] === part);
}

function demoHealthPayload() {
  return {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: 'demo',
    // todo-001: surface demo mode so the Python hook can warn the operator
    // when DASHCLAW_BASE_URL is misrouted to a sandbox instance. The real
    // /api/health route also returns this; we mirror it here because the
    // demo-mode middleware short-circuits before that handler runs.
    mode: 'demo',
    checks: { demo: { status: 'healthy' } },
  };
}

async function handleDemoActionsRoute({ request, fixtures, url, method }) {
  if (method === 'POST') {
    // For demo simulations, we try to use the real body if provided
    let body = {};
    try {
      const text = await request.text();
      body = text ? JSON.parse(text) : {};
    } catch (e) {
      // fallback to empty
    }
    return demoJson(request, demoCreateAction(fixtures, body), 201);
  }
  return demoJson(request, demoListActions(fixtures, url));
}

function handleDemoSignals({ request, fixtures, url }) {
  const agentId = url.searchParams.get('agent_id');
  const signals = agentId ? fixtures.signals.filter(s => s.agent_id === agentId) : fixtures.signals;
  return demoJson(request, {
    signals,
    counts: {
      red: signals.filter(s => s.severity === 'red').length,
      amber: signals.filter(s => s.severity === 'amber').length,
      total: signals.length,
    },
    lastUpdated: new Date().toISOString(),
  });
}

// Pulse widget snapshot (/widget). Pending rows get a synthetic held-6m
// timestamp so the demo shows the brand "owed" ring rather than an ancient
// fixture reading as days overdue. Presence is honestly `unknown` — the demo
// host has no desktop-presence store, and unknown never fakes live.
function handleDemoWidgetPulse({ request, fixtures }) {
  const now = Date.now();
  const pendingRows = (fixtures.actions || [])
    .filter((a) => a.status === 'pending_approval')
    .slice(0, 5)
    .map((a) => ({
      actionId: a.action_id || null,
      actionType: a.action_type || null,
      agentName: a.agent_name || a.agent_id || null,
      riskScore: Number(a.risk_score) || 0,
      timestampStart: new Date(now - 6 * 60 * 1000).toISOString(),
      declaredGoal: null,
    }));
  const signals = fixtures.signals || [];
  const top = signals.find((s) => s.severity === 'red') || signals[0] || null;
  return demoJson(request, {
    asOf: new Date(now).toISOString(),
    windowMinutes: 60,
    pending: { count: pendingRows.length, rows: pendingRows },
    signals: {
      red: signals.filter((s) => s.severity === 'red').length,
      amber: signals.filter((s) => s.severity === 'amber').length,
      top: top ? { severity: top.severity, kind: top.type || 'signal', label: top.label || '' } : null,
    },
    agents: { activeCount: 3, lastActiveAt: new Date(now - 2 * 60 * 1000).toISOString() },
    lastActionAt: new Date(now - 2 * 60 * 1000).toISOString(),
    recentActionCount: 12,
    queriesDegraded: [],
    presence: { verdict: 'unknown', frameAgeSeconds: null },
  });
}

function handleDemoActionTrace({ request, fixtures, segments }) {
  const actionId = segments[2];
  const trace = demoActionTrace(fixtures, actionId);
  if (!trace) return demoJson(request, { error: 'Action not found' }, 404);
  return demoJson(request, trace);
}

function handleDemoActionDetail({ request, fixtures, segments }) {
  const actionId = segments[2];
  const detail = demoActionDetail(fixtures, actionId);
  if (!detail) return demoJson(request, { error: 'Action not found' }, 404);
  return demoJson(request, detail);
}

function handleDemoRelationships({ request, fixtures }) {
  const contacts = fixtures.contacts;
  const today = new Date().toISOString().slice(0, 10);
  const followUpsDue = contacts.filter(c => c.followUpDate && c.followUpDate <= today).length;
  const stats = {
    total: contacts.length,
    hot: contacts.filter(c => c.temperature === 'HOT').length,
    warm: contacts.filter(c => c.temperature === 'WARM').length,
    cold: contacts.filter(c => c.temperature === 'COLD').length,
    followUpsDue,
  };
  return demoJson(request, { contacts, interactions: [], stats, lastUpdated: new Date().toISOString() });
}

function handleDemoPoliciesProof({ request, fixtures, url }) {
  const fmt = url.searchParams.get('format');
  if (fmt === 'json') {
    return demoJson(request, { report: fixtures.policyProofReport });
  }
  // Markdown format — wrap in JSON object for client to parse
  return demoJson(request, { report: fixtures.policyProofReport });
}

function handleDemoFeedback({ request, fixtures, url }) {
  if (request.method === 'GET') {
    let entries = fixtures.feedbackEntries;
    const sentiment = url.searchParams.get('sentiment');
    const resolved = url.searchParams.get('resolved');
    if (sentiment) entries = entries.filter(e => e.sentiment === sentiment);
    if (resolved === 'false') entries = entries.filter(e => !e.resolved);
    if (resolved === 'true') entries = entries.filter(e => e.resolved);
    return demoJson(request, { feedback: entries, total: entries.length });
  }
  return demoJson(request, { id: 'fb_demo_new', sentiment: 'neutral', tags: [] }, 201);
}

function handleDemoFeedbackDetail({ request, fixtures, pathname }) {
  const id = pathname.split('/').pop();
  const fb = fixtures.feedbackEntries.find(e => e.id === id);
  return fb ? demoJson(request, fb) : demoJson(request, { error: 'Not found' }, 404);
}

async function handleDemoGuardRoute({ request, fixtures, url, method }) {
  if (method === 'POST') {
    try {
      const bodyText = await request.text();
      const body = bodyText ? JSON.parse(bodyText) : {};
      const result = demoGuardPost(fixtures, body);
      return demoJson(request, result, 200);
    } catch (e) {
      console.error('[DEMO GUARD ERROR]', e);
      return demoJson(request, { error: `Invalid request body: ${e.message}` }, 400);
    }
  }
  return demoJson(request, demoGuard(fixtures, url));
}

// Demo org kill switch: module-scope state so the org HALT
// control is fully clickable in the demo (halting "blocks" nothing real;
// state resets on cold start). GET mirrors /api/halt's { halt } shape.
let demoHaltState = { halted: false, actor: null, reason: null, at: null };
async function handleDemoHaltRoute({ request, method }) {
  if (method === 'POST') {
    try {
      const bodyText = await request.text();
      const body = bodyText ? JSON.parse(bodyText) : {};
      if (typeof body.halted !== 'boolean') {
        return demoJson(request, { error: 'halted must be a boolean' }, 400);
      }
      demoHaltState = {
        halted: body.halted,
        actor: 'demo-operator',
        reason: typeof body.reason === 'string' ? body.reason.slice(0, 1000) : null,
        at: new Date().toISOString(),
      };
      return demoJson(request, { ok: true, halt: demoHaltState });
    } catch (e) {
      return demoJson(request, { error: `Invalid request body: ${e.message}` }, 400);
    }
  }
  return demoJson(request, { halt: demoHaltState });
}

function handleDemoWebhookDeliveries({ request, fixtures, segments }) {
  const webhookId = segments[2];
  return demoJson(request, demoWebhookDeliveries(fixtures, webhookId));
}

function handleDemoContextThreadDetail({ request, fixtures, segments }) {
  const threadId = segments[3];
  const detail = demoContextThreadDetail(fixtures, threadId);
  if (!detail) return demoJson(request, { error: 'Thread not found' }, 404);
  return demoJson(request, detail);
}

function handleDemoPreferences({ request, fixtures, url }) {
  const payload = demoPreferences(fixtures, url);
  const status = payload?.error ? 400 : 200;
  return demoJson(request, payload, status);
}

function handleDemoPairings({ request, fixtures, url }) {
  const status = url.searchParams.get('status') || 'pending';
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 200);
  // fixtures.pairings may be undefined — pairings aren't seeded in the
  // demo fixture yet. Fall back to empty list instead of crashing.
  const all = Array.isArray(fixtures.pairings) ? fixtures.pairings : [];
  const pairings = all.filter(p => p.status === status).slice(0, limit);
  return demoJson(request, { pairings });
}

// Session detail trio — fixture ids come from the same builder as the demo
// sessions LIST, so /sessions/<row id> always resolves. Unknown ids 404 like
// the real routes.
function handleDemoSessionDetail({ request, fixtures, segments }) {
  const detail = demoSessionDetail(fixtures, segments[2]);
  if (!detail) return demoJson(request, { error: 'Session not found' }, 404);
  return demoJson(request, detail);
}

function handleDemoSessionEvents({ request, fixtures, segments }) {
  const payload = demoSessionEvents(fixtures, segments[2]);
  if (!payload) return demoJson(request, { error: 'Session not found' }, 404);
  return demoJson(request, payload);
}

function handleDemoSessionActions({ request, fixtures, url, segments }) {
  const payload = demoSessionActions(fixtures, segments[2], url);
  if (!payload) return demoJson(request, { error: 'Session not found' }, 404);
  return demoJson(request, payload);
}

function handleDemoPairingDetail({ request, fixtures, segments }) {
  const pairingId = segments[2];
  const all = Array.isArray(fixtures.pairings) ? fixtures.pairings : [];
  const pairing = all.find(p => p.id === pairingId) || null;
  if (!pairing) return demoJson(request, { error: 'Pairing not found' }, 404);
  return demoJson(request, { pairing });
}

// Table-entry factories: most demo routes are "call a fixture mapper, wrap it
// in demoJson". These keep the table to one expression per route instead of
// repeating the demoJson plumbing for every entry.
const demoFixtureRoute = (fn) => ({ request, fixtures }) => demoJson(request, fn(fixtures));
const demoFixtureUrlRoute = (fn) => ({ request, fixtures, url }) => demoJson(request, fn(fixtures, url));
const demoPayloadRoute = (fn) => ({ request }) => demoJson(request, fn());
const demoFixturePropRoute = (key) => ({ request, fixtures }) => demoJson(request, fixtures[key]);

// Ordered demo route table. Each entry is [matcher, handler]; a string matcher
// is an exact pathname, a function matcher receives (pathname, segments).
// ORDER IS LOAD-BEARING: it reproduces the original if-cascade top-to-bottom,
// including its shadowing quirks (see isDemoAgentDetailPath). Do not sort.
const DEMO_API_ROUTES = [
  // Health
  ['/api/health', demoPayloadRoute(demoHealthPayload)],
  ['/api/agents', demoFixtureRoute(demoAgents)],
  ['/api/actions', handleDemoActionsRoute],
  [(pathname) => pathname === '/api/actions/signals' || pathname === '/api/signals', handleDemoSignals],
  [(pathname) => pathname === '/api/actions/assumptions' || pathname === '/api/assumptions', demoFixtureUrlRoute(demoAssumptions)],
  ['/api/actions/stats', demoFixtureRoute(demoDecisionMetrics)],
  [(pathname, segments) => segmentsMatch(segments, ['api', 'actions', '*', 'trace']), handleDemoActionTrace],
  // Containment Verdicts (v5.6.0): the card's lazy diff load and its
  // promote/discard POST. The verdict answers an honest demo 403 (static
  // fixtures cannot transition; symmetric with the plans entries).
  [(pathname, segments) => segmentsMatch(segments, ['api', 'actions', '*', 'artifacts']), ({ request, segments }) => demoJson(request, demoActionArtifacts(segments[2]))],
  [(pathname, segments) => segmentsMatch(segments, ['api', 'actions', '*', 'containment']), ({ request }) =>
    demoJson(request, { error: 'Demo mode: containment verdicts are disabled. Connect an instance to promote or discard real contained work.' }, 403)],
  [(pathname, segments) => segmentsMatch(segments, ['api', 'actions', '*']), handleDemoActionDetail],
  // Dashboard widgets
  ['/api/goals', ({ request, fixtures }) => demoJson(request, { goals: fixtures.goals, stats: { totalGoals: fixtures.goals.length }, lastUpdated: new Date().toISOString() })],
  ['/api/relationships', handleDemoRelationships],
  ['/api/calendar', ({ request, fixtures }) => demoJson(request, { events: fixtures.events, lastUpdated: new Date().toISOString(), count: fixtures.events.length })],
  ['/api/inspiration', ({ request, fixtures }) => demoJson(request, { ideas: fixtures.ideas, stats: { totalIdeas: fixtures.ideas.length }, lastUpdated: new Date().toISOString() })],
  ['/api/settings', ({ request, fixtures }) => demoJson(request, { settings: fixtures.settings })],
  ['/api/policies', demoFixtureRoute(demoPolicies)],
  ['/api/policies/summary', demoFixtureRoute(demoPolicySummary)],
  ['/api/policies/contract', ({ request }) => demoJson(request, demoContract())],
  ['/api/policies/review', ({ request }) => demoJson(request, demoReview())],
  ['/api/policies/proof', handleDemoPoliciesProof],
  // Triage-inbox proposal queues: empty-but-COMPLETE payloads (see the
  // builders' doc comment — a missing field wedges the inbox on skeletons).
  ['/api/policies/proposals', demoPayloadRoute(demoTuningProposals)],
  ['/api/policies/tightening', demoPayloadRoute(demoTighteningProposals)],
  ['/api/policies/loosening', demoPayloadRoute(demoLooseningProposals)],
  ['/api/calibration/proposals', demoPayloadRoute(demoCalibrationProposals)],
  ['/api/calibration/controller', demoFixtureRoute(demoCalibrationController)],
  ['/api/doctor', demoPayloadRoute(demoDoctor)],
  ['/api/widget/pulse', handleDemoWidgetPulse],
  // Preflight plans (v5.4.0): the /approvals plans card fetches
  // ?status=<s>&limit=N then a detail per plan — without these entries the
  // demo showed no plans at all. Verdict POSTs answer an honest demo 403
  // (stateless fixtures can't transition status).
  ['/api/plans', ({ request, fixtures }) => {
    // Method guard mirrors the detail entry below (the pre-dispatch write
    // block also covers this; the symmetry is deliberate, not redundant
    // by accident — 2026-07-29 security review, LOW).
    if (request.method !== 'GET') {
      return demoJson(request, { error: 'Demo mode: plan submission is disabled. Connect an instance to submit real plans.' }, 403);
    }
    const status = new URL(request.url).searchParams.get('status');
    const plans = demoPlans(fixtures).filter((p) => !status || p.status === status);
    return demoJson(request, { plans });
  }],
  [(pathname, segments) => segmentsMatch(segments, ['api', 'plans', '*']), ({ request, fixtures, segments }) => {
    if (request.method !== 'GET') {
      return demoJson(request, { error: 'Demo mode: plan verdicts are disabled. Connect an instance to review real plans.' }, 403);
    }
    const detail = demoPlanDetail(fixtures, segments[2]);
    return detail ? demoJson(request, detail) : demoJson(request, { error: 'Plan not found' }, 404);
  }],
  // ── Routing demo endpoints ──
  ['/api/routing/health', demoFixturePropRoute('routingHealth')],
  ['/api/routing/stats', demoFixturePropRoute('routingStats')],
  ['/api/routing/agents', ({ request, fixtures }) => demoJson(request, { agents: fixtures.routingAgents })],
  ['/api/routing/tasks', ({ request, fixtures }) => demoJson(request, { tasks: fixtures.routingTasks })],
  // -- Feedback demo endpoints --
  ['/api/feedback', handleDemoFeedback],
  [(pathname) => /^\/api\/feedback\/stats$/.test(pathname), demoFixturePropRoute('feedbackStats')],
  [(pathname) => /^\/api\/feedback\/[^/]+$/.test(pathname), handleDemoFeedbackDetail],
  // Guard + messaging + team + activity
  ['/api/guard', handleDemoGuardRoute],
  ['/api/halt', handleDemoHaltRoute],
  ['/api/content', demoFixtureUrlRoute(demoContent)],
  ['/api/activity', demoFixtureUrlRoute(demoActivity)],
  ['/api/webhooks', demoFixtureRoute(demoWebhooks)],
  [(pathname, segments) => segmentsMatch(segments, ['api', 'webhooks', '*', 'deliveries']), handleDemoWebhookDeliveries],
  ['/api/schedules', demoFixtureRoute(demoSchedules)],
  ['/api/usage', demoFixtureRoute(demoUsage)],
  ['/api/team/invites', demoFixtureRoute(demoTeam)],
  ['/api/digest', demoFixtureUrlRoute(demoDigest)],
  ['/api/context/points', demoFixtureUrlRoute(demoContextPoints)],
  ['/api/context/threads', demoFixtureUrlRoute(demoContextThreads)],
  [(pathname, segments) => segmentsMatch(segments, ['api', 'context', 'threads', '*']), handleDemoContextThreadDetail],
  ['/api/snippets', demoFixtureUrlRoute(demoSnippets)],
  ['/api/preferences', handleDemoPreferences],
  ['/api/memory', ({ request, fixtures }) => demoJson(request, { ...fixtures.memory, lastUpdated: new Date().toISOString() })],
  ['/api/tokens', demoFixtureRoute(demoTokens)],
  ['/api/security/status', demoFixturePropRoute('securityStatus')],
  ['/api/pairings', handleDemoPairings],
  [(pathname, segments) => segmentsMatch(segments, ['api', 'pairings', '*']), handleDemoPairingDetail],
  // -- Sitewide-interactions-v2 gap pages: deterministic, read-only fixtures --
  ['/api/sessions', demoFixtureUrlRoute(demoSessions)],
  // Detail trio: 4-segment patterns are listed before the 3-segment detail for
  // readability, though segmentsMatch is exact-length so they can't collide.
  [(pathname, segments) => segmentsMatch(segments, ['api', 'sessions', '*', 'events']), handleDemoSessionEvents],
  [(pathname, segments) => segmentsMatch(segments, ['api', 'sessions', '*', 'actions']), handleDemoSessionActions],
  [(pathname, segments) => segmentsMatch(segments, ['api', 'sessions', '*']), handleDemoSessionDetail],
  ['/api/identities', demoFixtureRoute(demoIdentities)],
  ['/api/keys', demoPayloadRoute(demoApiKeys)],
];

async function dispatchDemoApiRoute(ctx) {
  for (const [matcher, handler] of DEMO_API_ROUTES) {
    const matches = typeof matcher === 'string'
      ? ctx.pathname === matcher
      : matcher(ctx.pathname, ctx.segments);
    if (matches) return handler(ctx);
  }
  return demoJson(ctx.request, { error: 'Demo mode: endpoint disabled.' }, 403);
}

// Policy test/simulate runs are read-like (no mutation) — allow through demo
// write-block. modes/import is mocked the same way: demo "applies" a profile
// without mutating anything, so the /policies UI doesn't 403.
function handleDemoPolicySimulations(request, pathname, method) {
  if (method !== 'POST') return null;
  if (pathname === '/api/policies/test') {
    return demoJson(request, demoPolicyTest(getDemoFixtures()));
  }
  if (pathname === '/api/policies/simulate') {
    return demoJson(request, demoPolicySimulate(getDemoFixtures(), {}));
  }
  if (pathname === '/api/policies/review/verdict') {
    return demoJson(request, { ok: true, demo: true });
  }
  if (pathname === '/api/policies/modes/import') {
    return demoJson(request, {
      mode_id: 'demo',
      imported: 6,
      reactivated: 0,
      skipped: 0,
      errors: [],
      policies: [],
      demo: true,
    }, 201);
  }
  return null;
}

// Early demo-mode gates that run before the route table, in cascade order:
// marketing passthrough → static passthrough → read-like policy simulations
// → the write block (only guard/actions/assumptions simulations are exempt).
// Passthrough MUST precede the write block: NextAuth sign-in and the hosted
// mint are POSTs, and a passthrough that only exempts reads is a no-op for
// exactly the endpoints it exists to protect.
async function runDemoPreDispatch(request, pathname, method, isRead) {
  // Marketing funnel telemetry is reachable in demo mode too — the
  // marketing site IS the demo deployment. Pass through to the real
  // handler; it validates allowlisted event names and writes to Redis.
  if (pathname.startsWith('/api/marketing/')) {
    return forwardWithHeaders(request);
  }

  if (isDemoPassthroughPath(pathname)) {
    return forwardWithHeaders(request);
  }

  const policySimulation = handleDemoPolicySimulations(request, pathname, method);
  if (policySimulation) return policySimulation;

  if (!isRead && !isDemoSimulationRequest(pathname, method)) {
    return demoJson(request, { error: 'Demo mode: write APIs are disabled.' }, 403);
  }

  return null;
}

async function handleDemoApi(request, pathname) {
  if (request.method === 'OPTIONS') {
    return new NextResponse(null, { status: 204, headers: getCorsHeaders(request) });
  }

  // SECURITY: Even demo mode should be rate limited.
  const ip = getClientIp(request);
  if (!(await checkRateLimit(ip))) {
    return demoJson(request, { error: 'Rate limit exceeded. Please slow down.' }, 429);
  }

  const method = request.method.toUpperCase();
  const isRead = method === 'GET' || method === 'HEAD';

  const preDispatch = await runDemoPreDispatch(request, pathname, method, isRead);
  if (preDispatch) return preDispatch;

  const ctx = {
    request,
    pathname,
    method,
    fixtures: getDemoFixtures(),
    url: parseUrl(request),
    segments: getPathSegments(pathname),
  };

  if (pathname.startsWith('/api/stream')) {
    return forwardDemoStream(request);
  }

  return dispatchDemoApiRoute(ctx);
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

// OAuth Bearer path (Claude custom connectors). Additive — x-api-key still works.
// Returns null when no bearer token is present.
async function handleBearerAuth(request, pathname, requestHeaders) {
  const authz = request.headers.get('authorization') || '';
  const bearer = authz.slice(0, 7).toLowerCase() === 'bearer ' ? authz.slice(7).trim() : '';
  if (!bearer) return null;

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
