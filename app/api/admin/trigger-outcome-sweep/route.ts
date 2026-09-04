export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 60;

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db';
import { getOrgId, getOrgRole } from '../../../lib/org';
import { sweepLostOutcomesForOrg } from '../../../lib/repositories/actions.repository';
import { getOutcomeTimeoutMinutes } from '../../../lib/outcome-timeout';

/**
 * POST /api/admin/trigger-outcome-sweep
 *
 * Admin-only, org-scoped manual trigger of the lost-confirmation outcome
 * sweep. The scheduled /api/cron/outcome-sweep is CRON_SECRET-gated and runs
 * org-wide; this lets a free-tier instance (no cron) finalize its own
 * timed-out actions on demand. Sweeps only the caller's org.
 */
export async function POST(request: Request) {
  try {
    const role = getOrgRole(request);
    if (role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden - admin role required' }, { status: 403 });
    }

    const sql = getSql();
    const orgId = getOrgId(request);
    const timeoutMinutes = await getOutcomeTimeoutMinutes(sql, orgId);
    const swept = await sweepLostOutcomesForOrg(sql, orgId, timeoutMinutes);

    return NextResponse.json({
      ok: true,
      rows_swept: swept.length,
      timeout_minutes: timeoutMinutes,
    });
  } catch (err) {
    console.error('[admin/trigger-outcome-sweep] Error:', err);
    return NextResponse.json({ error: 'Sweep failed' }, { status: 500 });
  }
}
