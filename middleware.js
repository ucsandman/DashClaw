import { NextResponse } from 'next/server';
import { getToken } from 'next-auth/jwt';
import { neon } from '@neondatabase/serverless';
import { getDemoFixtures } from './app/lib/demo/demoFixtures.js';
import {
  demoListActions, demoCreateAction, demoAgents, demoAgentDetail, demoActionDetail, demoAssumptions,
  demoLearning, demoLearningRecommendations, demoLearningRecommendationMetrics,
  demoTokens, demoPolicies, demoPolicySimulate, demoPolicyProof, demoPolicyTest, demoGuard, demoGuardPost, demoMessages, demoMessageThreads,
  demoMessageDocs, demoContent, demoTeam, demoTeamInvites, demoActivity,
  demoWebhooks, demoWebhookDeliveries, demoWorkflows, demoSchedules,
  demoDigest, demoContextPoints, demoContextThreads, demoContextThreadDetail,
  demoHandoffs, demoSnippets, demoPreferences, demoSwarmGraph, demoAgentConnections, demoActionTrace,
  demoDecisionMetrics,
  demoSessions, demoIdentities, demoKnowledgeCollections, demoApiKeys, demoSecrets,
  demoModelStrategies, demoReputationLeaderboard, demoPosture, demoPostureFindings, demoSpend,
  demoBehaviorRecorder, demoBehaviorSamples, demoBehaviorSuggestions
} from './app/lib/demo/demoMiddleware.js';
import { getViewerContextFromCookieHeader } from './app/lib/sessionViewer.mjs';
import { isSelfHostModeEnabled } from './app/lib/selfHost.js';
import { addSecurityHeaders } from './app/lib/security-headers.js';

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
  '/api/setup/status',
  '/api/setup/proof',
  '/api/setup/ping',
  '/api/setup/migrate',
  '/api/auth',
  '/api/cron',
  '/api/telegram/webhook',  // auth: x-telegram-bot-api-secret-token + chat-id allowlist (in route)
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

async function getLocalAdminSession(request) {
  const viewer = await getViewerContextFromCookieHeader(
    request.headers.get('cookie') || '',
    process.env
  );
  return viewer.authType === 'local' ? viewer.session : null;
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

async function resolveApiKey(keyHash) {
  const now = Date.now();
  pruneApiKeyCache(now);
  const cached = apiKeyCache.get(keyHash);
  if (cached && now - cached.timestamp < API_KEY_CACHE_TTL) {
    return cached.result;
  }

  try {
    const sql = neon(process.env.DATABASE_URL);
    const rows = await sql`
      SELECT ak.org_id, ak.role, ak.revoked_at,
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
      orgId: row.org_id,
      role: row.role,
      hostedMode: row.hosted_mode === true,
      trialEndsAt: row.trial_ends_at,
      trialActionCap: row.trial_action_cap,
      trialActionsUsed: row.trial_actions_used,
    };
    apiKeyCache.set(keyHash, { timestamp: now, result });

    // Update last_used_at (fire and forget)
    sql`UPDATE api_keys SET last_used_at = CURRENT_TIMESTAMP WHERE key_hash = ${keyHash}`.catch(() => {});

    return result;
  } catch (err) {
    console.error('[AUTH] API key lookup failed:', err.message);
    // Self-host with local Postgres: Neon HTTP driver can't reach TCP-only Postgres.
    // The fast-path (DASHCLAW_API_KEY exact match) handles the primary key.
    // For secondary keys, fail open is not safe — return null.
    return null;
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
    return null;
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

// /demo is always a public entrypoint. Keep it off auth-gated dashboard
// routes so first-time evaluators land on the interactive marketing demo.
function handleDemoEntry(request) {
  const leave = request.nextUrl.searchParams.get('leave') === '1';
  const response = NextResponse.redirect(new URL('/#live-demo', request.url));

  if (leave) {
    response.cookies.delete('dashclaw_demo');
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
const DEMO_PASSTHROUGH_PREFIXES = ['/api/auth', '/api/docs/raw'];
const DEMO_PASSTHROUGH_EXACT = ['/api/prompts/server-setup/raw', '/api/prompts/agent-connect/raw'];

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

// Tail-anchored agent-detail pattern, kept exactly as the original cascade
// expressed it. NOTE: this matches /api/agents/connections too (the literal id
// "connections"), shadowing the exact entry further down the table — that is
// long-standing demo behavior and is pinned by middleware.test.js.
function isDemoAgentDetailPath(pathname, segments) {
  return segments[segments.length - 3] === 'api' && segments[segments.length - 2] === 'agents';
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

function handleDemoAgentDetailRoute({ request, fixtures, segments }) {
  const agentId = segments[segments.length - 1];
  const detail = demoAgentDetail(fixtures, agentId);
  if (!detail) return demoJson(request, { error: 'Agent not found' }, 404);
  return demoJson(request, detail);
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

function handleDemoLoops({ request, fixtures, url }) {
  const sp = url.searchParams;
  const agentId = sp.get('agent_id') || undefined;
  const limit = Math.min(parseInt(sp.get('limit') || '50', 10), 200);
  const offset = parseInt(sp.get('offset') || '0', 10);
  let loops = fixtures.loops.slice();
  if (agentId) loops = loops.filter(l => l.agent_id === agentId);
  const total = loops.length;
  const paged = loops.slice(offset, offset + limit);
  const stats = {
    open_count: String(loops.length),
    resolved_count: '0',
    critical_open: String(loops.filter(l => l.priority === 'critical').length),
    high_open: String(loops.filter(l => l.priority === 'high').length),
  };
  return demoJson(request, { loops: paged, total, stats, lastUpdated: new Date().toISOString() });
}

function handleDemoActionCosts({ request, url }) {
  // Demo-mode stub so /mission-control and /analytics render without the
  // catch-all /api/actions/[actionId] handler below swallowing this path
  // and returning 404.
  return demoJson(request, {
    period: url.searchParams.get('period') || '30d',
    total_cost_usd: 0,
    total_tokens: 0,
    total_actions: 0,
    by_model: [],
    by_agent: [],
    by_day: [],
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

function handleDemoComplianceMap({ request, fixtures, url }) {
  const framework = url.searchParams.get('framework') || 'fw_soc2';
  const mapped = fixtures.complianceMap[framework];
  if (!mapped) return demoJson(request, { error: `Unknown framework: ${framework}` }, 404);
  return demoJson(request, mapped);
}

function handleDemoComplianceGaps({ request, fixtures, url }) {
  const framework = url.searchParams.get('framework') || 'fw_soc2';
  const gaps = fixtures.complianceGaps[framework];
  if (!gaps) return demoJson(request, { error: `Unknown framework: ${framework}` }, 404);
  return demoJson(request, gaps);
}

function buildDemoComplianceReport({ request, fixtures }) {
  const lines = [
    '# Compliance Report',
    '',
    `**Generated:** ${new Date().toISOString()}`,
    '',
    '## Framework Coverage',
    '',
  ];
  for (const fw of fixtures.complianceFrameworks) {
    const m = fixtures.complianceMap[fw.id];
    lines.push(`### ${fw.name}`);
    lines.push(`- Covered: ${m.coverage.covered}/${m.coverage.total}`);
    lines.push(`- Partial: ${m.coverage.partial}`);
    lines.push(`- Gaps: ${m.coverage.gaps}`);
    lines.push('');
  }
  lines.push('---', '*Generated by DashClaw Compliance Engine*');
  const report = lines.join('\n');
  const response = new Response(report, {
    status: 200,
    headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
  });
  addSecurityHeaders(response, request);
  withCors(request, response);
  return response;
}

function handleDemoComplianceExports({ request }) {
  if (request.method === 'POST') {
    return demoJson(request, { id: 'ce_demo_new' }, 201);
  }
  return demoJson(request, { exports: [
    { id: 'ce_demo_001', name: 'Q4 SOC 2 Audit Package', frameworks: '["soc2","iso27001"]', format: 'markdown', window_days: 90, status: 'completed', file_size_bytes: 24680, requested_by: 'user', started_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(), completed_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000 + 8500).toISOString(), created_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString() },
    { id: 'ce_demo_002', name: 'NIST AI RMF Review', frameworks: '["nist-ai-rmf"]', format: 'markdown', window_days: 30, status: 'completed', file_size_bytes: 12340, requested_by: 'user', started_at: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(), completed_at: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000 + 5200).toISOString(), created_at: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString() },
    { id: 'ce_demo_003', name: 'Weekly Compliance Snapshot', frameworks: '["soc2"]', format: 'markdown', window_days: 7, status: 'completed', file_size_bytes: 8920, requested_by: 'scheduled', started_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(), completed_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000 + 3100).toISOString(), created_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString() },
  ] });
}

function handleDemoComplianceExportDetail({ request, pathname }) {
  return demoJson(request, { id: pathname.split('/').pop(), name: 'Demo Export', status: 'completed', report_content: '# SOC 2 Compliance Report -- Agent Operations\n\n**Project:** org-demo  \n**Generated:** ' + new Date().toISOString() + '  \n**Risk Level:** LOW\n\n## Executive Summary\n\n| Metric | Value |\n|---|---|\n| Framework | SOC 2 |\n| Total Controls | 12 |\n| Covered | 9 |\n| Partial | 2 |\n| Gaps | 1 |\n| **Coverage** | **83%** |\n\n## Enforcement Evidence\n\n**Window:** 30 days  \n**Total Guard Decisions:** 847  \n**Blocked:** 23  \n**Action Records:** 1,204' });
}

function handleDemoComplianceSchedules({ request }) {
  if (request.method === 'POST') return demoJson(request, { id: 'csch_demo_new' }, 201);
  return demoJson(request, { schedules: [
    { id: 'csch_demo_001', name: 'Weekly SOC 2 Snapshot', frameworks: '["soc2"]', format: 'markdown', window_days: 7, cron_expression: '0 9 * * 1', enabled: true, last_run_at: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(), created_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString() },
    { id: 'csch_demo_002', name: 'Monthly Full Audit', frameworks: '["soc2","iso27001","nist-ai-rmf"]', format: 'markdown', window_days: 30, cron_expression: '0 9 1 * *', enabled: true, last_run_at: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString(), created_at: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString() },
  ] });
}

function demoComplianceTrendsPayload() {
  return { trends: [
    { framework: 'soc2', coverage_percentage: 83, covered: 9, partial: 2, gaps: 1, risk_level: 'LOW', created_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString() },
    { framework: 'soc2', coverage_percentage: 79, covered: 8, partial: 3, gaps: 1, risk_level: 'MEDIUM', created_at: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString() },
    { framework: 'soc2', coverage_percentage: 75, covered: 8, partial: 2, gaps: 2, risk_level: 'MEDIUM', created_at: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString() },
    { framework: 'iso27001', coverage_percentage: 71, covered: 7, partial: 3, gaps: 4, risk_level: 'MEDIUM', created_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString() },
    { framework: 'iso27001', coverage_percentage: 64, covered: 6, partial: 3, gaps: 5, risk_level: 'HIGH', created_at: new Date(Date.now() - 9 * 24 * 60 * 60 * 1000).toISOString() },
  ] };
}

function handleDemoPromptTemplateDetail({ request, fixtures, pathname }) {
  const id = pathname.split('/').pop();
  const tmpl = fixtures.promptTemplates.find(t => t.id === id);
  return tmpl ? demoJson(request, tmpl) : demoJson(request, { error: 'Not found' }, 404);
}

function handleDemoPromptVersions({ request, fixtures, pathname }) {
  const templateId = pathname.split('/')[4];
  const versions = fixtures.promptVersions[templateId] || [];
  return demoJson(request, { versions });
}

function demoPromptRenderPayload() {
  return { rendered: 'Analyze the following agent decision and rate quality 1-10.\n\nAgent: ClawdBot\nAction: deploy\nGoal: Deploy latest build\nOutcome: Success\n\nCriteria:\n- Goal alignment\n- Risk awareness\n- Efficiency\n\nProvide a structured assessment.', version_id: 'pv_demo_001_3', template_id: 'pt_demo_001', version: 3, parameters: ['agent_name', 'action_type', 'declared_goal', 'outcome'] };
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

function handleDemoDriftAlerts({ request, fixtures }) {
  if (request.method === 'POST') {
    return demoJson(request, { baselines_computed: 5, alerts_generated: 2, results: [], alerts: [] }, 201);
  }
  return demoJson(request, { alerts: fixtures.driftAlerts, total: fixtures.driftAlerts.length });
}

function demoDriftMetricsPayload() {
  return { metrics: [
    { id: 'risk_score', label: 'Risk Score' },
    { id: 'confidence', label: 'Confidence' },
    { id: 'duration_ms', label: 'Duration (ms)' },
    { id: 'cost_estimate', label: 'Cost Estimate' },
    { id: 'tokens_total', label: 'Total Tokens' },
    { id: 'learning_score', label: 'Learning Score' },
  ] };
}

function handleDemoLearningVelocity({ request, fixtures }) {
  if (request.method === 'POST') return demoJson(request, { agents_computed: 3, results: [] }, 201);
  return demoJson(request, { velocity: fixtures.learningVelocity });
}

function handleDemoLearningCurves({ request, fixtures }) {
  if (request.method === 'POST') return demoJson(request, { curves_computed: 18, results: [] }, 201);
  return demoJson(request, { curves: fixtures.learningCurves });
}

function demoLearningMaturityPayload() {
  return { levels: [
    { level: 'novice', min_episodes: 0, min_success_rate: 0, min_avg_score: 0 },
    { level: 'developing', min_episodes: 10, min_success_rate: 0.4, min_avg_score: 40 },
    { level: 'competent', min_episodes: 50, min_success_rate: 0.6, min_avg_score: 55 },
    { level: 'proficient', min_episodes: 150, min_success_rate: 0.75, min_avg_score: 65 },
    { level: 'expert', min_episodes: 500, min_success_rate: 0.85, min_avg_score: 75 },
    { level: 'master', min_episodes: 1000, min_success_rate: 0.92, min_avg_score: 85 },
  ] };
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
  // Agents + actions
  ['/api/agents', demoFixtureRoute(demoAgents)],
  [isDemoAgentDetailPath, handleDemoAgentDetailRoute],
  ['/api/actions', handleDemoActionsRoute],
  [(pathname) => pathname === '/api/actions/signals' || pathname === '/api/signals', handleDemoSignals],
  ['/api/actions/loops', handleDemoLoops],
  [(pathname) => pathname === '/api/actions/assumptions' || pathname === '/api/assumptions', demoFixtureUrlRoute(demoAssumptions)],
  ['/api/actions/stats', demoFixtureRoute(demoDecisionMetrics)],
  ['/api/actions/costs', handleDemoActionCosts],
  [(pathname, segments) => segmentsMatch(segments, ['api', 'actions', '*', 'trace']), handleDemoActionTrace],
  [(pathname, segments) => segmentsMatch(segments, ['api', 'actions', '*']), handleDemoActionDetail],
  // Dashboard widgets
  ['/api/goals', ({ request, fixtures }) => demoJson(request, { goals: fixtures.goals, stats: { totalGoals: fixtures.goals.length }, lastUpdated: new Date().toISOString() })],
  ['/api/learning', demoFixtureUrlRoute(demoLearning)],
  ['/api/learning/recommendations', demoFixtureUrlRoute(demoLearningRecommendations)],
  ['/api/learning/recommendations/metrics', demoFixtureUrlRoute(demoLearningRecommendationMetrics)],
  ['/api/relationships', handleDemoRelationships],
  ['/api/calendar', ({ request, fixtures }) => demoJson(request, { events: fixtures.events, lastUpdated: new Date().toISOString(), count: fixtures.events.length })],
  ['/api/inspiration', ({ request, fixtures }) => demoJson(request, { ideas: fixtures.ideas, stats: { totalIdeas: fixtures.ideas.length }, lastUpdated: new Date().toISOString() })],
  ['/api/settings', ({ request, fixtures }) => demoJson(request, { settings: fixtures.settings })],
  ['/api/policies', demoFixtureRoute(demoPolicies)],
  ['/api/policies/proof', handleDemoPoliciesProof],
  // ── Routing demo endpoints ──
  ['/api/routing/health', demoFixturePropRoute('routingHealth')],
  ['/api/routing/stats', demoFixturePropRoute('routingStats')],
  ['/api/routing/agents', ({ request, fixtures }) => demoJson(request, { agents: fixtures.routingAgents })],
  ['/api/routing/tasks', ({ request, fixtures }) => demoJson(request, { tasks: fixtures.routingTasks })],
  // ── Compliance demo endpoints ──
  ['/api/compliance/frameworks', ({ request, fixtures }) => demoJson(request, { frameworks: fixtures.complianceFrameworks })],
  ['/api/compliance/map', handleDemoComplianceMap],
  ['/api/compliance/gaps', handleDemoComplianceGaps],
  ['/api/compliance/evidence', demoFixturePropRoute('complianceEvidence')],
  ['/api/compliance/report', buildDemoComplianceReport],
  // -- Evaluations demo endpoints --
  ['/api/evaluations', ({ request, fixtures }) => demoJson(request, { scores: fixtures.evalScores, total: fixtures.evalScores.length })],
  ['/api/evaluations/scorers', ({ request, fixtures }) => demoJson(request, { scorers: fixtures.evalScorers, llm_available: false })],
  ['/api/evaluations/runs', ({ request, fixtures }) => demoJson(request, { runs: fixtures.evalRuns })],
  ['/api/evaluations/stats', demoFixturePropRoute('evalStats')],
  ['/api/settings/llm-status', ({ request }) => demoJson(request, { available: false, provider: null, model: null })],
  // -- Compliance Export demo endpoints --
  ['/api/compliance/exports', handleDemoComplianceExports],
  [(pathname) => /^\/api\/compliance\/exports\/[^/]+$/.test(pathname), handleDemoComplianceExportDetail],
  ['/api/compliance/schedules', handleDemoComplianceSchedules],
  ['/api/compliance/trends', demoPayloadRoute(demoComplianceTrendsPayload)],
  // -- Prompt Management demo endpoints --
  ['/api/prompts/templates', ({ request, fixtures }) => demoJson(request, { templates: fixtures.promptTemplates })],
  [(pathname) => /^\/api\/prompts\/templates\/[^/]+$/.test(pathname), handleDemoPromptTemplateDetail],
  [(pathname) => /^\/api\/prompts\/templates\/[^/]+\/versions$/.test(pathname), handleDemoPromptVersions],
  ['/api/prompts/render', demoPayloadRoute(demoPromptRenderPayload)],
  ['/api/prompts/runs', ({ request, fixtures }) => demoJson(request, { runs: fixtures.promptRuns })],
  ['/api/prompts/stats', demoFixturePropRoute('promptStats')],
  // -- Feedback demo endpoints --
  ['/api/feedback', handleDemoFeedback],
  [(pathname) => /^\/api\/feedback\/stats$/.test(pathname), demoFixturePropRoute('feedbackStats')],
  [(pathname) => /^\/api\/feedback\/[^/]+$/.test(pathname), handleDemoFeedbackDetail],
  // -- Drift Detection demo endpoints --
  ['/api/drift/alerts', handleDemoDriftAlerts],
  [(pathname) => /^\/api\/drift\/alerts\/[^/]+$/.test(pathname), ({ request, fixtures }) => demoJson(request, { ...fixtures.driftAlerts[0], acknowledged: true })],
  ['/api/drift/stats', demoFixturePropRoute('driftStats')],
  ['/api/drift/snapshots', ({ request, fixtures }) => demoJson(request, { snapshots: fixtures.driftSnapshots })],
  ['/api/drift/metrics', demoPayloadRoute(demoDriftMetricsPayload)],
  // -- Learning Analytics demo endpoints --
  ['/api/learning/analytics/summary', demoFixturePropRoute('learningAnalyticsSummary')],
  ['/api/learning/analytics/velocity', handleDemoLearningVelocity],
  ['/api/learning/analytics/curves', handleDemoLearningCurves],
  ['/api/learning/analytics/maturity', demoPayloadRoute(demoLearningMaturityPayload)],
  // -- Scoring demo endpoints --
  ['/api/scoring/profiles', ({ request, fixtures }) => demoJson(request, { profiles: fixtures.scoringProfiles })],
  ['/api/scoring/risk-templates', ({ request, fixtures }) => demoJson(request, { templates: fixtures.riskTemplates })],
  ['/api/scoring/score', ({ request }) => demoJson(request, { scores: [] })],
  // Guard + messaging + team + activity
  ['/api/guard', handleDemoGuardRoute],
  ['/api/messages', demoFixtureUrlRoute(demoMessages)],
  ['/api/messages/threads', demoFixtureUrlRoute(demoMessageThreads)],
  ['/api/messages/docs', demoFixtureUrlRoute(demoMessageDocs)],
  ['/api/content', demoFixtureUrlRoute(demoContent)],
  // NOTE: unreachable in practice — isDemoAgentDetailPath above also matches
  // /api/agents/connections and wins. Kept to mirror the original cascade.
  ['/api/agents/connections', demoFixtureUrlRoute(demoAgentConnections)],
  ['/api/team', demoFixtureRoute(demoTeam)],
  ['/api/team/invite', demoFixtureRoute(demoTeamInvites)],
  ['/api/activity', demoFixtureUrlRoute(demoActivity)],
  ['/api/webhooks', demoFixtureRoute(demoWebhooks)],
  [(pathname, segments) => segmentsMatch(segments, ['api', 'webhooks', '*', 'deliveries']), handleDemoWebhookDeliveries],
  ['/api/workflows', demoFixtureUrlRoute(demoWorkflows)],
  ['/api/schedules', demoFixtureRoute(demoSchedules)],
  ['/api/digest', demoFixtureUrlRoute(demoDigest)],
  ['/api/context/points', demoFixtureUrlRoute(demoContextPoints)],
  ['/api/context/threads', demoFixtureUrlRoute(demoContextThreads)],
  [(pathname, segments) => segmentsMatch(segments, ['api', 'context', 'threads', '*']), handleDemoContextThreadDetail],
  ['/api/handoffs', demoFixtureUrlRoute(demoHandoffs)],
  ['/api/snippets', demoFixtureUrlRoute(demoSnippets)],
  ['/api/preferences', handleDemoPreferences],
  ['/api/memory', ({ request, fixtures }) => demoJson(request, { ...fixtures.memory, lastUpdated: new Date().toISOString() })],
  ['/api/tokens', demoFixtureRoute(demoTokens)],
  ['/api/usage', demoFixturePropRoute('usage')],
  ['/api/swarm/graph', demoFixtureUrlRoute(demoSwarmGraph)],
  ['/api/security/status', demoFixturePropRoute('securityStatus')],
  ['/api/pairings', handleDemoPairings],
  [(pathname, segments) => segmentsMatch(segments, ['api', 'pairings', '*']), handleDemoPairingDetail],
  // -- Sitewide-interactions-v2 gap pages: deterministic, read-only fixtures --
  ['/api/sessions', demoFixtureUrlRoute(demoSessions)],
  ['/api/identities', demoFixtureRoute(demoIdentities)],
  ['/api/knowledge/collections', demoPayloadRoute(demoKnowledgeCollections)],
  ['/api/keys', demoPayloadRoute(demoApiKeys)],
  ['/api/secrets', demoPayloadRoute(demoSecrets)],
  ['/api/model-strategies', demoPayloadRoute(demoModelStrategies)],
  ['/api/reputation/leaderboard', demoFixtureRoute(demoReputationLeaderboard)],
  ['/api/posture', demoPayloadRoute(demoPosture)],
  ['/api/posture/findings', demoPayloadRoute(demoPostureFindings)],
  ['/api/finops/spend', demoPayloadRoute(demoSpend)],
  ['/api/behavior/recorder', demoPayloadRoute(demoBehaviorRecorder)],
  ['/api/behavior/samples', demoFixtureUrlRoute(demoBehaviorSamples)],
  ['/api/behavior/suggestions', demoFixtureRoute(demoBehaviorSuggestions)],
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

// Policy test/simulate runs are read-like (no mutation) — allow through demo write-block.
function handleDemoPolicySimulations(request, pathname, method) {
  if (method !== 'POST') return null;
  if (pathname === '/api/policies/test') {
    return demoJson(request, demoPolicyTest(getDemoFixtures()));
  }
  if (pathname === '/api/policies/simulate') {
    return demoJson(request, demoPolicySimulate(getDemoFixtures(), {}));
  }
  return null;
}

// Early demo-mode gates that run before the route table, in cascade order:
// marketing passthrough → read-like policy simulations → the write block
// (only guard/actions/assumptions simulations are exempt) → static passthrough.
async function runDemoPreDispatch(request, pathname, method, isRead) {
  // Marketing funnel telemetry is reachable in demo mode too — the
  // marketing site IS the demo deployment. Pass through to the real
  // handler; it validates allowlisted event names and writes to Redis.
  if (pathname.startsWith('/api/marketing/')) {
    return forwardWithHeaders(request);
  }

  const policySimulation = handleDemoPolicySimulations(request, pathname, method);
  if (policySimulation) return policySimulation;

  if (!isRead && !isDemoSimulationRequest(pathname, method)) {
    return demoJson(request, { error: 'Demo mode: write APIs are disabled.' }, 403);
  }

  if (isDemoPassthroughPath(pathname)) {
    return forwardWithHeaders(request);
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
  return pathname === '/' || pathname === '/setup' || pathname.startsWith('/setup/');
}

async function handlePageRequest(request, pathname, clearStaleDemoCookie) {
  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });

  // /login — redirect to dashboard if already logged in
  if (pathname === '/login') {
    if (token) return NextResponse.redirect(new URL('/mission-control', request.url));
    return NextResponse.next();
  }

  if (isPublicPagePath(pathname)) {
    return NextResponse.next();
  }

  // All other matched page routes — require session
  let session = token;
  if (!session) {
    session = await getLocalAdminSession(request);
    if (!session) {
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
// The default 2 MB cap is enough for every governance API. Code-session
// JSONL backfill is the one exception: real Claude Code transcripts compress
// ~2x (less repetitive than typical JSON since they include tool outputs and
// code), so a 10 MB raw file ends up ~3 MB gzipped + base64. Raise the cap
// for that endpoint to just under Vercel's 4.5 MB edge limit so legitimately
// big sessions can still come through. Anything bigger requires chunked POST.
const DEFAULT_MAX_BODY_BYTES = 2 * 1024 * 1024;
const INGEST_MAX_BODY_BYTES = 4_400_000; // 4.4 MB, sits just under Vercel's 4.5 MB ceiling

function enforceBodySizeCap(request, pathname) {
  const isLargeIngestRoute = pathname === '/api/code-sessions/ingest-jsonl';
  const maxBodyBytes = isLargeIngestRoute ? INGEST_MAX_BODY_BYTES : DEFAULT_MAX_BODY_BYTES;
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
  const oauth = await resolveOAuthToken(tokenHash);
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
    const localSession = await getLocalAdminSession(request);
    if (!localSession) {
      return securedJson(request, { error: 'Unauthorized - Session required' }, { status: 401 });
    }
    sessionToken = localSession;
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

  return forwardWithHeaders(request, requestHeaders);
}

// Slow path: hash the key and look up in api_keys table
async function handleDatabaseKey(request, pathname, requestHeaders, apiKey) {
  const keyHash = await hashApiKey(apiKey);
  const resolved = await resolveApiKey(keyHash);

  if (!resolved) {
    console.warn(`[SECURITY] Unauthorized API access attempt: ${pathname} from ${getClientIp(request)}`);
    return securedJson(request,
      { error: 'Unauthorized - Invalid or missing API key' },
      { status: 401 }
    );
  }

  requestHeaders.set('x-org-id', resolved.orgId);
  requestHeaders.set('x-org-role', resolved.role);

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

  const oversizedBody = enforceBodySizeCap(request, pathname);
  if (oversizedBody) return oversizedBody;

  // Allow public routes without auth
  if (PUBLIC_ROUTES.some(route => pathname.startsWith(route))) {
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
    '/dashboard',
    '/dashboard/:path*',
    '/mission-control',
    '/mission-control/:path*',
    '/swarm',
    '/swarm/:path*',
    '/approvals',
    '/approvals/:path*',
    '/approve',
    '/approve/:path*',
    '/widget',
    '/widget/:path*',
    '/actions',
    '/actions/:path*',
    '/decisions',
    '/decisions/:path*',
    '/analytics',
    '/analytics/:path*',
    '/assumptions',
    '/assumptions/:path*',
    '/scoring',
    '/scoring/:path*',
    '/policy-coach',
    '/policy-coach/:path*',
    '/labs',
    '/labs/:path*',
    '/learning',
    '/learning/:path*',
    '/integrations',
    '/integrations/:path*',
    '/workflows',
    '/workflows/:path*',
    '/pair',
    '/pair/:path*',
    '/pairings',
    '/pairings/:path*',
    '/bug-hunter',
    '/bug-hunter/:path*',
    '/security',
    '/security/:path*',
    '/code-sessions',
    '/code-sessions/:path*',
    '/setup',
    '/setup/:path*',
    '/api-keys',
    '/api-keys/:path*',
    '/team',
    '/team/:path*',
    '/usage',
    '/usage/:path*',
    '/activity',
    '/activity/:path*',
    '/webhooks',
    '/webhooks/:path*',
    '/messages',
    '/messages/:path*',
    '/policies',
    '/policies/:path*',
    '/routing',
    '/routing/:path*',
    '/compliance',
    '/compliance/:path*',
    '/drift',
    '/drift/:path*',
    '/learning/analytics',
    '/learning/analytics/:path*',
    '/api/learning/analytics/:path*',
    '/api/drift/:path*',
    '/api/compliance/exports/:path*',
    '/api/compliance/schedules/:path*',
    '/api/compliance/trends',
    '/api/scoring/:path*',
    '/evaluations',
    '/evaluations/:path*',
    '/api/evaluations/:path*',
    '/feedback',
    '/feedback/:path*',
    '/api/feedback/:path*',
    '/prompts',
    '/prompts/:path*',
    '/api/prompts/:path*',
    '/api/settings/llm-status',
    '/invite/:path*',
    '/login',
  ],
};
