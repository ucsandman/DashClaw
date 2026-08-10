export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 60;

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db';
import { timingSafeCompare } from '../../../lib/timing-safe';
import { EVENTS, publishOrgEvent } from '../../../lib/events';
import { fireWebhooksForOrg } from '../../../lib/webhooks';
import {
  listOrgsWithStaleOutcomes,
  sweepLostOutcomesForOrg,
} from '../../../lib/repositories/actions.repository';
import { getSettings } from '../../../lib/repositories/settings.repository';
import { sweepAbandonedSessions } from '../../../lib/sessions';

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

function buildSignal(row: {
  agent_id?: string | null;
  action_id: string;
  declared_goal?: string | null;
  action_type?: string | null;
  created_at: string;
  outcome_at: string;
}) {
  return {
    type: 'lost_confirmation',
    severity: 'warning',
    agent_id: row.agent_id || null,
    action_id: row.action_id,
    declared_goal: row.declared_goal || null,
    action_type: row.action_type || null,
    created_at: row.created_at,
    outcome_at: row.outcome_at,
    message: 'Action passed its outcome timeout without an agent report',
  };
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
    const summary = { orgs_scanned: 0, rows_swept: 0, webhooks_fired: 0, sessions_closed: 0 };

    // Reap abandoned sessions first (cross-org): a 'running' session dead for
    // 48h+ otherwise stays 'running' forever and pollutes /sessions and the
    // stalled-session signal. Best-effort — a reap failure must not block the
    // outcome sweep below.
    try {
      const closedSessions = await sweepAbandonedSessions(sql);
      summary.sessions_closed = closedSessions.length;
    } catch (err) {
      console.warn('[outcome-sweep] session reap failed:', (err as Error).message);
    }

    const orgIds = await listOrgsWithStaleOutcomes(sql, FLOOR_TIMEOUT_MINUTES);

    for (const rawOrgId of orgIds) {
      const orgId = rawOrgId as string;
      const timeoutMinutes = await resolveTimeoutMinutes(sql, orgId);
      const swept = await sweepLostOutcomesForOrg(sql, orgId, timeoutMinutes);
      summary.orgs_scanned++;
      if (swept.length === 0) continue;

      summary.rows_swept += swept.length;
      const signals = (swept as Parameters<typeof buildSignal>[0][]).map(buildSignal);

      for (const signal of signals) {
        void publishOrgEvent(EVENTS.SIGNAL_DETECTED, { orgId, signal });
      }

      try {
        const whResults = await fireWebhooksForOrg(orgId, signals, sql);
        summary.webhooks_fired += whResults.filter((r) => r.success).length;
      } catch (err) {
        console.warn(`[outcome-sweep] webhook delivery failed for ${orgId}:`, (err as Error).message);
      }
    }

    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    console.error('[cron/outcome-sweep] Error:', err);
    return NextResponse.json({ error: 'Sweep failed' }, { status: 500 });
  }
}
