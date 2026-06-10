export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../../../lib/db';
import { getOrgId } from '../../../../../lib/org';
import { agentExistsInOrg } from '../../../../../lib/repositories/agents.repository';
import { listReputationEvents } from '../../../../../lib/repositories/reputation.repository';

/**
 * GET /api/reputation/agents/[agentId]/events — paginated reputation events,
 * org-scoped. 404 when the agent is unknown in this org.
 */
export async function GET(request: Request, { params }: { params: Promise<{ agentId: string }> }) {
  try {
    const { agentId } = await params;
    const orgId = getOrgId(request);
    const sql = await getSql();
    const { searchParams } = new URL(request.url);
    const limit = Number(searchParams.get('limit')) || 50;
    const offset = Number(searchParams.get('offset')) || 0;

    if (!(await agentExistsInOrg(sql, orgId, agentId))) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    const events = await listReputationEvents(sql, orgId, agentId, { limit, offset });
    return NextResponse.json({
      agent_id: agentId,
      events,
      pagination: { limit, offset, count: events.length },
    });
  } catch (err) {
    console.error('[REPUTATION/EVENTS] GET error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
