export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db';
import { runMemoryMaintenance } from '../../../lib/maintenance';
import { logActivity } from '../../../lib/audit';
import { timingSafeCompare } from '../../../lib/timing-safe';
import { isHostedMode } from '../../../lib/hosted/flag';

// GET /api/cron/memory-maintenance - Vercel Cron handler
export async function GET(request: Request) {
  try {
    // SECURITY: Always require CRON_SECRET
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
      return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 503 });
    }
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !timingSafeCompare(authHeader, `Bearer ${cronSecret}`)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const sql = getSql();
    const summary = { orgs_processed: 0, agents_notified: 0, messages_sent: 0 };

    // Load active orgs. org_default is only excluded on the HOSTED deployment
    // (shared legacy bucket); on self-hosted it is the operator's real org —
    // same scoping fix as the signals cron.
    const orgs = isHostedMode()
      ? await sql`SELECT id, name FROM organizations WHERE id != 'org_default'`
      : await sql`SELECT id, name FROM organizations`;

    for (const org of orgs) {
      try {
        const result = await runMemoryMaintenance(org.id as string, sql);

        if (result.status === 'processed') {
          const r = result as Record<string, any>;
          summary.agents_notified += r.agents_notified;
          summary.messages_sent += r.messages_sent;

          logActivity({
            orgId: org.id as string, actorId: 'cron', actorType: 'cron',
            action: 'memory.maintenance_run', resourceType: 'agent',
            details: { notified: r.agents_notified, messages: r.messages_sent },
          }, sql);
        }

        summary.orgs_processed++;
      } catch (err) {
        console.error(`[CRON-MAINTENANCE] Error processing org ${org.id}:`, (err as Error).message);
        summary.orgs_processed++;
      }
    }

    return NextResponse.json({ success: true, summary });
  } catch (error) {
    console.error('Cron memory maintenance error:', error);
    return NextResponse.json({ error: 'Maintenance job failed' }, { status: 500 });
  }
}
