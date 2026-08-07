export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 60;

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db';
import { timingSafeCompare } from '../../../lib/timing-safe';
import { listActionIdsByFilter, deleteActionsByIds } from '../../../lib/repositories/actions.repository';

/**
 * GET /api/cron/synthetic-sweep — retention GC for test traffic.
 *
 * Smoke/loadtest/bench runs write real action_records; without a sweep they
 * accumulate forever (729 phantom agents by 2026-08). Deletes synthetic-agent
 * rows older than DASHCLAW_SYNTHETIC_RETENTION_DAYS (default 7).
 * Org-scoped (default org_default): `test`/`test-%` could name a hosted
 * tenant's real agent, so cross-org sweeping is deliberately NOT done here.
 *
 * Authentication: CRON_SECRET (same pattern as jti-sweep / outcome-sweep).
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
    const days = parseInt(process.env.DASHCLAW_SYNTHETIC_RETENTION_DAYS || '', 10) || 7;
    const org = process.env.DASHCLAW_SYNTHETIC_SWEEP_ORG || 'org_default';
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
    const targetIds = await listActionIdsByFilter(sql, org, { synthetic: true, before: cutoff });
    let deleted = 0;
    for (let i = 0; i < targetIds.length; i += 10_000) {
      deleted += (await deleteActionsByIds(sql, org, targetIds.slice(i, i + 10_000))).length;
    }

    return NextResponse.json({ ok: true, deleted, cutoff, org });
  } catch (err) {
    console.error('[cron/synthetic-sweep] Error:', err);
    return NextResponse.json({ error: 'Sweep failed' }, { status: 500 });
  }
}
