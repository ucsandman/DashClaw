export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 60;

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db';
import { timingSafeCompare } from '../../../lib/timing-safe';
import { listActionIdsByFilter, deleteActionsByIds } from '../../../lib/repositories/actions.repository';
import { deleteSyntheticAgentTraces } from '../../../lib/repositories/agents.repository';
import { logActivityStrict } from '../../../lib/audit';

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

    // Same write-ahead-audit contract as the manual /api/actions DELETE path
    // (see auditDeletion there): the cron sweep erases governed-action rows
    // unattended, so the erasure record must land BEFORE any row is deleted,
    // and a failed audit write must fail the whole sweep closed — otherwise
    // a scheduled job could silently wipe ledger history with no trace.
    // There's no human requester here, so the actor is the cron job itself
    // and `request` is the actual inbound cron-trigger request (honest IP
    // extraction, not a fabricated user).
    await logActivityStrict({
      orgId: org,
      actorId: 'cron:synthetic-sweep',
      actorType: 'system',
      action: 'synthetic.sweep',
      resourceType: 'action',
      details: {
        deleted_count: targetIds.length,
        action_ids: targetIds.slice(0, 100),
        filter: { synthetic: true, before: cutoff, org },
      },
      request,
    }, sql);

    let deleted = 0;
    for (let i = 0; i < targetIds.length; i += 10_000) {
      deleted += (await deleteActionsByIds(sql, org, targetIds.slice(i, i + 10_000))).length;
    }
    const traces = await deleteSyntheticAgentTraces(sql, org, { before: cutoff });

    return NextResponse.json({ ok: true, deleted, cutoff, org, traces });
  } catch (err) {
    console.error('[cron/synthetic-sweep] Error:', err);
    return NextResponse.json({ error: 'Sweep failed' }, { status: 500 });
  }
}
