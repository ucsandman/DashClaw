import { NextResponse } from 'next/server';
import { getSql } from '../../../../lib/db';
import { getOrgId, getOrgRole } from '../../../../lib/org';
import { checkAllIntegrations } from '../../../../lib/integration-health';
import { upsertHealth, getHealthForOrg } from '../../../../lib/repositories/integration-health.repository';
import { fireHealthChangeAlerts } from '../../../../lib/health-change-alerts';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/integrations/health/refresh — on-demand health check.
 *
 * Free-tier alternative to the /api/cron/integration-health Bearer endpoint.
 * Session-authed (middleware enforces), admin-only, runs the same check
 * pipeline for the caller's org, returns the updated health map.
 *
 * The cron endpoint is still the preferred scheduling path when Vercel Pro or
 * an external scheduler (GitHub Actions, cron-job.org) is available.
 */
export async function POST(request: Request) {
  try {
    const role = getOrgRole(request);
    if (role !== 'admin') {
      return NextResponse.json({ error: 'Admin role required' }, { status: 403 });
    }

    const orgId = getOrgId(request);
    const sql = getSql();

    const results = await checkAllIntegrations(orgId, sql);
    let checked = 0;
    const transitions = [];
    for (const [provider, result] of Object.entries(results) as [string, any][]) {
      if (result.status === 'not_configured') continue;
      const { changed, prev_status, new_status } = await upsertHealth(
        sql, orgId, provider, result.status, result.message,
      );
      checked++;
      if (changed) {
        transitions.push({ provider, prev_status, new_status, message: result.message });
      }
    }

    let alerts = 0;
    if (transitions.length > 0) {
      // prev_status is `string | null` off the upsert; fireHealthChangeAlerts
      // reads it as a string label (a fresh row simply has no prior transition).
      const res = await fireHealthChangeAlerts(sql, orgId, transitions as Parameters<typeof fireHealthChangeAlerts>[2]);
      alerts = res.fired;
    }

    // Return the fresh map the UI can swap in without re-fetching.
    const rows = await getHealthForOrg(sql, orgId);
    const healthMap: Record<string, any> = {};
    for (const row of rows) {
      healthMap[row.provider as string] = {
        status: row.status,
        message: row.message,
        checked_at: row.checked_at,
      };
    }

    return NextResponse.json({ checked, alerts, health: healthMap });
  } catch (err) {
    console.error('[integrations/health/refresh] POST error:', err);
    return NextResponse.json({ error: 'Health refresh failed' }, { status: 500 });
  }
}
