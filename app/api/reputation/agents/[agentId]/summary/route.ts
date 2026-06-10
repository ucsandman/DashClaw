export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../../../lib/db';
import { getOrgId } from '../../../../../lib/org';
import { agentExistsInOrg } from '../../../../../lib/repositories/agents.repository';
import {
  getReputationSnapshot,
  computeReputationVectorWithBreakdown,
  snapshotToVector,
} from '../../../../../lib/repositories/reputation.repository';

const ACTIVE_WINDOW_MS = 180 * 86_400_000; // 2x the 90-day half-life

/**
 * GET /api/reputation/agents/[agentId]/summary — the vector plus an isActive
 * flag (last event within the active window). Read-only. 404 when unknown.
 */
export async function GET(request: Request, { params }: { params: Promise<{ agentId: string }> }) {
  try {
    const { agentId } = await params;
    const orgId = getOrgId(request);
    const sql = await getSql();

    // Snapshot path carries breakdown via snapshotToVector; the live path
    // attaches it as a sibling — never inside the hashed vector.
    let vector = snapshotToVector(await getReputationSnapshot(sql, orgId, agentId));
    if (!vector) {
      if (!(await agentExistsInOrg(sql, orgId, agentId))) {
        return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
      }
      const live = await computeReputationVectorWithBreakdown(sql, orgId, agentId);
      vector = { ...live.vector, breakdown: live.breakdown };
    }

    const lastMs = vector.last_event_at ? Date.parse(vector.last_event_at) : null;
    const isActive = lastMs != null && (Date.now() - lastMs) <= ACTIVE_WINDOW_MS;

    return NextResponse.json({ agent_id: agentId, summary: { ...vector, is_active: isActive } });
  } catch (err) {
    console.error('[REPUTATION/SUMMARY] GET error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
