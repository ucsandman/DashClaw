export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db';
import { getOrgId } from '../../../lib/org';
import { EVENTS, publishOrgEvent } from '../../../lib/events';
import { upsertAgentPresence, ensureAgentPresenceTable } from '../../../lib/repositories/agents.repository';

/**
 * POST /api/agents/heartbeat — Report agent presence and health.
 * Body: { agent_id, agent_name?, status, current_task_id?, metadata? }
 */
export async function POST(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const body = await request.json();

    const { agent_id, agent_name, status = 'online', current_task_id, metadata } = body;

    if (!agent_id) {
      return NextResponse.json({ error: 'agent_id is required' }, { status: 400 });
    }

    // Constrain status to the enum the trust-posture/signals layer expects.
    // Accepting arbitrary strings lets a misconfigured SDK caller write
    // garbage into the presence table that the Mission Control UI then
    // shows as an opaque badge.
    const VALID_STATUSES = ['online', 'offline', 'idle', 'busy', 'stale'];
    if (!VALID_STATUSES.includes(status)) {
      return NextResponse.json(
        { error: `status must be one of: ${VALID_STATUSES.join(', ')}` },
        { status: 400 },
      );
    }

    const now = new Date().toISOString();

    // Diagnostic logging for org mismatch troubleshooting
    // Use standard console.log so it appears in Vercel/container logs
    console.log(`[Heartbeat] Received from agent=${agent_id} for org=${orgId} (status=${status})`);

    // Upsert presence record using repository
    await upsertAgentPresence(sql, orgId, {
      agent_id,
      agent_name,
      status,
      current_task_id,
      metadata,
      timestamp: now
    });

    // Optionally emit a real-time presence event
    void publishOrgEvent('agent.heartbeat', {
      orgId,
      agent_id,
      status,
      last_heartbeat_at: now,
      current_task_id
    });

    return NextResponse.json({ status: 'ok', timestamp: now });
  } catch (error) {
    if ((error as Error).message?.includes('does not exist')) {
      // Auto-create table if missing using repository (DashClaw's lazy migration pattern)
      try {
        const sql = getSql();
        await ensureAgentPresenceTable(sql);
        return NextResponse.json({ error: 'Table initialized. Please retry.', code: 'RETRY' }, { status: 503 });
      } catch (setupErr) {
        console.error('[Heartbeat] Failed to create table:', setupErr);
      }
    }
    console.error('[Heartbeat] API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
