export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 60;

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db';
import { timingSafeCompare } from '../../../lib/timing-safe';
import { detectCacheCrater } from '../../../lib/claude-code/alerts';
import {
  insertAlerts,
  listProjectsWithSessions,
  getProjectTokenTotalsForRange,
} from '../../../lib/repositories/code-sessions.repository';

function isoWeekStart(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay();
  const diff = (day === 0 ? -6 : 1 - day);
  d.setUTCDate(d.getUTCDate() + diff);
  return d;
}

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
    const summary = { projects_scanned: 0, alerts_inserted: 0 };

    const now = new Date();
    const thisWeekStart = isoWeekStart(now).toISOString();
    const priorWeekStart = new Date(isoWeekStart(now).getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const nextWeekStart = new Date(isoWeekStart(now).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const projects = await listProjectsWithSessions(sql);

    for (const proj of projects) {
      const p = proj as Record<string, any>;
      summary.projects_scanned += 1;
      const thisWeek = await getProjectTokenTotalsForRange(sql, p.project_id, thisWeekStart, nextWeekStart);
      const priorWeek = await getProjectTokenTotalsForRange(sql, p.project_id, priorWeekStart, thisWeekStart);
      const alert = detectCacheCrater({ thisWeek, priorWeek, project: proj });
      if (!alert) continue;
      const inserted = await insertAlerts(sql, p.org_id, [{ ...alert, scope: 'project' }], {
        project_id: p.project_id,
      });
      summary.alerts_inserted += inserted;
    }

    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    console.error('[cron/code-session-cache-crater] Error:', err);
    return NextResponse.json({ error: 'Cache-crater sweep failed' }, { status: 500 });
  }
}
