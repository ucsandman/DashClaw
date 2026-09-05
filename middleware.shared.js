import { NextResponse } from 'next/server';
import { getViewerContextFromCookieHeader } from './app/lib/sessionViewer.mjs';
import { addSecurityHeaders } from './app/lib/security-headers';

export async function getLocalAdminSession(request) {
  const viewer = await getViewerContextFromCookieHeader(
    request.headers.get('cookie') || '',
    process.env
  );
  return viewer.authType === 'local' ? viewer.session : null;
}

export function getDashclawMode() {
  return process.env.DASHCLAW_MODE || 'self_host';
}

export function withCors(request, response) {
  for (const [k, v] of Object.entries(getCorsHeaders(request))) response.headers.set(k, v);
  return response;
}

// Canonical success/passthrough exit: forward the request (optionally with
// rewritten request headers) and apply the per-response security + CORS
// headers every authenticated/public exit path must carry.
export function forwardWithHeaders(request, requestHeaders = null) {
  const response = requestHeaders
    ? NextResponse.next({ request: { headers: requestHeaders } })
    : NextResponse.next();
  addSecurityHeaders(response, request);
  withCors(request, response);
  return response;
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

export function getClientIp(request) {
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

export async function checkRateLimit(ip) {
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

// SECURITY: CORS - restrict to deployment origin
export function getCorsHeaders(request) {
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
