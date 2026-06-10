export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 60;

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db';
import { getOrgId, getOrgRole } from '../../../lib/org';
import { sweepLostOutcomesForOrg } from '../../../lib/repositories/actions.repository';
import { getSettings } from '../../../lib/repositories/settings.repository';

const DEFAULT_TIMEOUT_MINUTES = 15;
const FLOOR_TIMEOUT_MINUTES = 1;
const CEILING_TIMEOUT_MINUTES = 24 * 60;

async function resolveTimeoutMinutes(sql: ReturnType<typeof getSql>, orgId: string): Promise<number> {
  try {
    const rows = await getSettings(sql, orgId, { key: 'DASHCLAW_OUTCOME_TIMEOUT_MINUTES' });
    const raw = rows?.[0]?.value;
    if (raw == null || raw === '') return DEFAULT_TIMEOUT_MINUTES;
    const n = Number(raw);
    if (!Number.isFinite(n)) return DEFAULT_TIMEOUT_MINUTES;
    return Math.min(CEILING_TIMEOUT_MINUTES, Math.max(FLOOR_TIMEOUT_MINUTES, Math.floor(n)));
  } catch {
    return DEFAULT_TIMEOUT_MINUTES;
  }
}

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
    const timeoutMinutes = await resolveTimeoutMinutes(sql, orgId);
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
