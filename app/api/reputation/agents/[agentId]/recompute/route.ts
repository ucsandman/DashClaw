export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../../../lib/db';
import { getOrgId } from '../../../../../lib/org';
import { agentExistsInOrg } from '../../../../../lib/repositories/agents.repository';
import { recomputeReputation } from '../../../../../lib/repositories/reputation.repository';

/**
 * POST /api/reputation/agents/[agentId]/recompute — recompute the vector from
 * live evidence, persist the snapshot + a signed receipt, and return the
 * vector. 404 when the agent is unknown in this org.
 */
export async function POST(request: Request, { params }: { params: Promise<{ agentId: string }> }) {
  try {
    const { agentId } = await params;
    const orgId = getOrgId(request);
    const sql = await getSql();

    if (!(await agentExistsInOrg(sql, orgId, agentId))) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    const { vector } = await recomputeReputation(sql, orgId, agentId);
    return NextResponse.json({ agent_id: agentId, vector, recomputed_at: vector.computed_at });
  } catch (err) {
    console.error('[REPUTATION/RECOMPUTE] POST error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
