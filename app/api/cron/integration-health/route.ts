import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db';
import { checkAllIntegrations } from '../../../lib/integration-health';
import { upsertHealth, getActiveOrgIds } from '../../../lib/repositories/integration-health.repository';
import { fireHealthChangeAlerts } from '../../../lib/health-change-alerts';
import { timingSafeEqual } from 'crypto';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: Request) {
  try {
    const secret = process.env.CRON_SECRET;
    if (!secret) return NextResponse.json({ error: 'CRON_SECRET not set' }, { status: 500 });

    const authHeader = request.headers.get('authorization') || '';
    // SECURITY: Require explicit "Bearer " prefix to prevent token bypass
    if (!authHeader.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const token = authHeader.slice('Bearer '.length);
    if (!token || Buffer.byteLength(token) !== Buffer.byteLength(secret) ||
        !timingSafeEqual(Buffer.from(token), Buffer.from(secret))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const sql = getSql();

    const orgs = await getActiveOrgIds(sql);

    let totalChecked = 0;
    let totalAlerts = 0;
    for (const orgRow of orgs) {
      const org = orgRow as Record<string, any>;
      const results = await checkAllIntegrations(org.id, sql);
      const transitions = [];
      for (const [provider, result] of Object.entries(results) as [string, { status: string; message: string }][]) {
        if (result.status === 'not_configured') continue;
        const { changed, prev_status, new_status } = await upsertHealth(
          sql, org.id, provider, result.status, result.message,
        );
        totalChecked++;
        if (changed) {
          transitions.push({ provider, prev_status, new_status, message: result.message });
        }
      }
      if (transitions.length > 0) {
        const { fired } = await fireHealthChangeAlerts(sql, org.id, transitions);
        totalAlerts += fired;
      }
    }

    return NextResponse.json({ ok: true, orgs: orgs.length, checked: totalChecked, alerts: totalAlerts });
  } catch (err) {
    console.error('[cron/integration-health] Error:', err);
    return NextResponse.json({ error: 'Health check failed' }, { status: 500 });
  }
}
