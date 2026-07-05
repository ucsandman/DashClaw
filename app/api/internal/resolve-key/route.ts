import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db';
import { resolveKeyForAuth, touchKeyLastUsed } from '../../../lib/repositories/apiKeys.repository';
import { timingSafeCompare } from '../../../lib/timing-safe';
import { isSelfHostModeEnabled } from '../../../lib/selfHost';

export const dynamic = 'force-dynamic';

/**
 * Internal DB-key resolution bridge for self-host deployments.
 *
 * The edge middleware resolves API keys with the Neon HTTP driver, which cannot
 * reach a TCP-only Postgres. On self-host (non-Neon) the middleware delegates
 * key resolution to this Node route, which uses the runtime-aware `getSql()`
 * driver (direct TCP for local Postgres). Hosted/Neon deployments resolve keys
 * inline in middleware and never call this route.
 *
 * Not a public oracle: it 404s on Neon/hosted, and requires the instance
 * operator key (DASHCLAW_API_KEY) via `x-internal-auth` — the middleware
 * attaches it on the internal hop and nothing external can forge it.
 */
function isNeonDatabaseUrl(url: string): boolean {
  return url.includes('.neon.tech') || url.includes('neon.tech');
}

export async function POST(request: Request): Promise<Response> {
  // Only meaningful on self-host + non-Neon Postgres. Everywhere else this is a
  // no-op 404 so it can never become a hash->org lookup oracle.
  const dbUrl = process.env.DATABASE_URL || '';
  if (!(isSelfHostModeEnabled() && !isNeonDatabaseUrl(dbUrl))) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Authenticate the caller as the instance operator.
  const operatorKey = process.env.DASHCLAW_API_KEY || '';
  const presented = request.headers.get('x-internal-auth') || '';
  if (!operatorKey || !timingSafeCompare(presented, operatorKey)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let keyHash: string | null = null;
  try {
    const body = await request.json();
    keyHash = typeof body?.keyHash === 'string' ? body.keyHash : null;
  } catch {
    keyHash = null;
  }
  if (!keyHash) {
    return NextResponse.json({ error: 'keyHash required' }, { status: 400 });
  }

  try {
    const sql = getSql();
    const rows = await resolveKeyForAuth(sql, keyHash);
    const row = rows[0];
    if (!row || row.revoked_at) {
      // Definitive "no valid key" — middleware caches this as null.
      return NextResponse.json({ resolved: null });
    }
    // Fire-and-forget last_used_at (mirrors the Neon path in middleware).
    Promise.resolve(touchKeyLastUsed(sql, keyHash)).catch((err: unknown) => console.warn('[RESOLVE-KEY] last_used_at touch failed:', err instanceof Error ? err.message : String(err)));
    return NextResponse.json({
      resolved: {
        orgId: row.org_id,
        role: row.role,
        hostedMode: row.hosted_mode === true,
        trialEndsAt: row.trial_ends_at ?? null,
        trialActionCap: row.trial_action_cap ?? null,
        trialActionsUsed: row.trial_actions_used ?? null,
      },
    });
  } catch (err) {
    // Transient DB failure — 500 tells the middleware to fail closed WITHOUT
    // caching (so a later request retries). The Postgres error code rides
    // along so the middleware can answer an honest 503 (schema vs connection)
    // instead of a misleading 401.
    console.error('[INTERNAL] resolve-key failed:', (err as Error).message);
    const code = (err as { code?: string })?.code;
    return NextResponse.json({ resolved: null, code }, { status: 500 });
  }
}
