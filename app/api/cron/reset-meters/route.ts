export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db';
import { getCurrentPeriod } from '../../../lib/usage';
import { timingSafeCompare } from '../../../lib/timing-safe';

export async function GET(request: Request) {
  try {
    // SECURITY: fail-closed — never run without CRON_SECRET configured.
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
      return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 503 });
    }
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !timingSafeCompare(authHeader, `Bearer ${cronSecret}`)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const sql = getSql();
    const period = getCurrentPeriod();

    // Purge previous-period rows for per-period resources. Current period is
    // left intact. Resources stored under the synthetic 'current' period
    // (members, api_keys, etc.) are never period-based and are excluded.
    const reset = await sql`
      DELETE FROM usage_meters
      WHERE period <> ${period}
        AND period <> 'current'
        AND resource IN ('governed_actions', 'capability_invocations', 'workflow_executions', 'actions_per_month')
    ` as Record<string, unknown>[] & { count?: number };

    console.log(`[Cron] Meter reset: purged ${reset.count || 0} rows from prior periods (current=${period})`);

    return NextResponse.json({
      success: true,
      period,
      meters_reset: reset.count || 0,
    });
  } catch (error) {
    console.error('[Cron] Meter reset failed:', error);
    return NextResponse.json({ error: 'Meter reset failed' }, { status: 500 });
  }
}
