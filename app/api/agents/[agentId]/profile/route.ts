export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getSql } from '../../../../lib/db';
import { getOrgId } from '../../../../lib/org';
import { getAgentDetail, getAgentTrustPosture } from '../../../../lib/repositories/agents.repository';
import { getAssumptionsSummary } from '../../../../lib/repositories/assumptions.repository';
import { computeSignals } from '../../../../lib/signals';

export async function GET(request: Request, { params }: { params: Promise<{ agentId: string }> }) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { agentId } = await params;

    const agent = await getAgentDetail(sql, orgId, agentId);
    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    const [trust, signals, assumptionsSummary] = await Promise.all([
      getAgentTrustPosture(sql, orgId, agentId),
      computeSignals(orgId, agentId, sql),
      getAssumptionsSummary(sql, orgId, agentId),
    ]);

    return NextResponse.json({
      agent: {
        agent_id: agent.agent_id,
        agent_name: agent.agent_name,
        action_count: agent.action_count || 0,
        last_active: agent.last_active,
        presence: {
          status: agent.presence_state || 'unknown',
          last_heartbeat_at: agent.last_heartbeat_at || null,
          current_task_id: agent.current_task_id || null,
        },
      },
      trust,
      signals,
      assumptions_summary: assumptionsSummary,
    });
  } catch (error) {
    console.error('[AGENT PROFILE] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
