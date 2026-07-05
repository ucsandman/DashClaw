export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db';
import { getOrgId, getUserId } from '../../../lib/org';
import { invokeRegisteredAgent } from '../../../lib/agent-registry';

/**
 * POST /api/agents/invoke — invoke a capability through a registered agent,
 * governed by the existing capability runtime + guard + action ledger. No
 * route-local HTTP or SQL; delegates entirely to the agent-registry lib.
 * Body: { registered_agent_id, capability_id, agent_id?, payload?, declared_goal? }
 */
export async function POST(request: Request) {
  try {
    const orgId = getOrgId(request);
    const sql = await getSql();
    const body = await request.json().catch(() => ({}));
    const { status, payload } = await invokeRegisteredAgent(sql, orgId, ({
      entryId: body.registered_agent_id,
      capabilityId: body.capability_id,
      callerAgentId: body.agent_id || null,
      body: body.payload || {},
      declaredGoal: body.declared_goal,
      // Separation of duties (drizzle/0055): trusted middleware principal.
      createdBy: getUserId(request) || null,
    } as Parameters<typeof invokeRegisteredAgent>[2] & Record<string, unknown>));
    return NextResponse.json(payload, { status });
  } catch (err) {
    console.error('[AGENTS/INVOKE] POST error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
