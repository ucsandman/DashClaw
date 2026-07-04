export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { isHostedMode, hostedConfig } from '../../../lib/hosted/flag';
import { verifyTurnstile } from '../../../lib/hosted/turnstile';
import { createRateLimiter } from '../../../lib/hosted/rate-limit';
import { provisionHostedWorkspace, countActiveTrials } from '../../../lib/repositories/hosted-workspace.repository';
import { getSql } from '../../../lib/db';

const DAY_MS = 24 * 60 * 60 * 1000;
let _limiter: (ReturnType<typeof createRateLimiter> & { _max?: number }) | null = null;
function getLimiter() {
  const cfg = hostedConfig();
  if (!_limiter || _limiter._max !== cfg.maxProvisionsPerIpPerDay) {
    _limiter = createRateLimiter({ max: cfg.maxProvisionsPerIpPerDay, windowMs: DAY_MS });
    _limiter._max = cfg.maxProvisionsPerIpPerDay;
  }
  return _limiter;
}

export function _resetLimiterForTests() {
  _limiter = null;
}

function clientIp(request: Request): string {
  // SECURITY: Mirror middleware.js trust-proxy logic. In self-host without
  // TRUST_PROXY, x-forwarded-for is attacker-controlled and would let any
  // caller spoof a unique IP per request to bypass the per-IP provisioning
  // rate limit. On Vercel, VERCEL=1 implies the platform sets the header.
  const trustProxy = ['1', 'true', 'yes', 'on'].includes(
    String(process.env.TRUST_PROXY || process.env.VERCEL || '').toLowerCase(),
  );
  if (trustProxy) {
    const fwd = request.headers.get('x-forwarded-for');
    if (fwd) {
      const first = fwd.split(',')[0];
      if (first) return first.trim();
    }
    const real = request.headers.get('x-real-ip');
    if (real) return real;
  }
  // Sentinel instead of null: the rate limiter short-circuits on falsy
  // keys, so a deployment that can't resolve an IP would otherwise grant
  // unlimited provisioning. Sharing a single bucket across unknown-IP
  // callers caps abuse without breaking legitimate requests.
  return (request as Request & { ip?: string }).ip || 'unknown';
}

function publicEndpoint(request: Request): string {
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

export async function POST(request: Request) {
  if (!isHostedMode()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const ip = clientIp(request);

  let body: any = {};
  try { body = await request.json(); } catch { /* best-effort: empty request body is allowed */ }

  // Verify turnstile BEFORE consuming a rate-limit slot so bot requests with bad
  // tokens don't burn quota for legitimate users sharing a NAT egress IP.
  const turnstile = await verifyTurnstile(body.turnstile_token || '', ip);
  if (!turnstile.ok) {
    return NextResponse.json(
      { error: `turnstile verification failed: ${turnstile.reason}` },
      { status: 400 },
    );
  }

  const rl = getLimiter().take(ip);
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'Rate limit exceeded', retry_after_ms: rl.retryAfterMs },
      { status: 429 },
    );
  }

  const cfg = hostedConfig();
  try {
    const sql = getSql();
    const active = await countActiveTrials(sql);
    if (active >= cfg.maxActiveTrials) {
      return NextResponse.json({ error: 'Trials are full', full: true }, { status: 503 });
    }
    const result = await provisionHostedWorkspace(sql, {
      trialDays: cfg.trialDays,
      trialActionCap: cfg.trialActionCap,
      label: 'trial',
    });
    return NextResponse.json({
      workspace_id: result.orgId,
      api_key: result.apiKey,
      key_prefix: result.keyPrefix,
      endpoint: publicEndpoint(request),
      expires_at: result.expiresAt,
      trial_action_cap: cfg.trialActionCap,
      next_steps_url: `${publicEndpoint(request)}/connect?hosted=${result.orgId}`,
    });
  } catch (err) {
    console.error('[HOSTED] provision failed:', err);
    return NextResponse.json({ error: 'Provisioning failed' }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json(
    { error: 'Method not allowed' },
    { status: 405, headers: { Allow: 'POST' } },
  );
}
