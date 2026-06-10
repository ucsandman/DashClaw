export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../../lib/db';
import { getOrgId } from '../../../../lib/org';
import { agentExistsInOrg } from '../../../../lib/repositories/agents.repository';
import {
  getReputationSnapshot,
  computeReputationVector,
  snapshotToVector,
} from '../../../../lib/repositories/reputation.repository';

/**
 * GET /api/reputation/agents/[agentId] — the current reputation vector.
 * Returns the stored snapshot when present; otherwise computes it read-only
 * (no persistence). 404 when the agent is unknown in this org.
 */
export async function GET(request: Request, { params }: { params: Promise<{ agentId: string }> }) {
  try {
    const { agentId } = await params;
    const orgId = getOrgId(request);
    const sql = await getSql();

    const snapshot = await getReputationSnapshot(sql, orgId, agentId);
    if (snapshot) {
      return NextResponse.json({ agent_id: agentId, vector: snapshotToVector(snapshot), source: 'snapshot' });
    }

    if (!(await agentExistsInOrg(sql, orgId, agentId))) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    const vector = await computeReputationVector(sql, orgId, agentId);
    return NextResponse.json({ agent_id: agentId, vector, source: 'computed' });
  } catch (err) {
    console.error('[REPUTATION/AGENT] GET error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
