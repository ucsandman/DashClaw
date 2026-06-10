export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 60;

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db';
import { timingSafeCompare } from '../../../lib/timing-safe';
import { generateMemo } from '../../../lib/claude-code/memo';
import {
  getProjectSessionsChronological,
  saveMemo,
  listProjectsWithSessions,
} from '../../../lib/repositories/code-sessions.repository';

export async function GET(request: Request) {
  try {
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 503 });
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !timingSafeCompare(authHeader, `Bearer ${cronSecret}`)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const sql = getSql();
    const summary = { projects_scanned: 0, memos_saved: 0 };
    const projects = await listProjectsWithSessions(sql);
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();
    for (const proj of projects) {
      const p = proj as Record<string, any>;
      summary.projects_scanned++;
      const all = await getProjectSessionsChronological(sql, p.org_id, p.project_id);
      const sessions = all.filter((s: { started_at?: string }) => s.started_at && s.started_at >= sevenDaysAgo);
      const priorSessions = all.filter((s: { started_at?: string }) => s.started_at && s.started_at >= fourteenDaysAgo && s.started_at < sevenDaysAgo);
      if (!sessions.length) continue;
      const memo = generateMemo({
        project: { id: p.project_id, slug: p.slug },
        sessions, priorSessions, findings: [], stuckLoopTotal: 0, now,
      });
      await saveMemo(sql, p.org_id, p.project_id, memo.weekTag, memo.markdown);
      summary.memos_saved++;
    }
    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    console.error('[cron/code-session-weekly-memo]', err);
    return NextResponse.json({ error: 'weekly memo run failed' }, { status: 500 });
  }
}
