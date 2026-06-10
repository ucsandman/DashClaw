export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 60;

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db';
import { timingSafeCompare } from '../../../lib/timing-safe';
import { sweep } from '../../../lib/repositories/jti-replay.repository';
import { purgeExpired as purgeOAuth } from '../../../lib/repositories/oauth.repository';

/**
 * GET /api/cron/jti-sweep — scheduled GC for short-lived auth rows.
 *
 * Phase 2b (issue #120, design by @piiiico). The repository runs a
 * probabilistic in-line sweep on ~1% of writes, but low-traffic periods
 * can leave expired rows around indefinitely. This endpoint is the
 * scheduled belt-and-suspenders, called every 5 minutes by
 * .github/workflows/jti-sweep.yml. It also purges spent OAuth rows
 * (consumed/expired authorization codes and revoked/aged access tokens),
 * which otherwise accumulate unbounded — neither has an in-line sweep.
 *
 * Authentication: CRON_SECRET (same pattern as outcome-sweep).
 */
export async function GET(request: Request) {
  try {
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
      return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 503 });
    }
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !timingSafeCompare(authHeader, `Bearer ${cronSecret}`)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const sql = getSql();
    const deleted = await sweep(sql);
    // OAuth GC is best-effort: a failure here must not fail the jti sweep.
    let oauthPurged = null;
    try {
      oauthPurged = await purgeOAuth(sql);
    } catch (oauthErr) {
      console.error('[cron/jti-sweep] OAuth purge failed:', oauthErr);
    }

    return NextResponse.json({ ok: true, deleted, oauth_purged: oauthPurged });
  } catch (err) {
    console.error('[cron/jti-sweep] Error:', err);
    return NextResponse.json({ error: 'Sweep failed' }, { status: 500 });
  }
}
