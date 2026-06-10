import { NextResponse } from 'next/server';
import { getSql } from '../../lib/db';
import { getOrgId } from '../../lib/org';
import { attachAgentConnections, listAgentsForOrg } from '../../lib/repositories/agents.repository';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);

    const agents = await listAgentsForOrg(sql, orgId);

    const url = new URL(request.url);
    const includeConnections = url.searchParams.get('include_connections') === 'true';
    const debug = url.searchParams.get('debug') === 'true';

    if (includeConnections) {
      await attachAgentConnections(sql, orgId, agents);
    }

    return NextResponse.json({
      agents,
      lastUpdated: new Date().toISOString(),
      meta: debug ? {
        org_id: orgId,
        server_time: new Date().toISOString(),
        agent_count: agents.length,
        heartbeat_source: 'agent_presence',
        online_window_ms: process.env.AGENT_ONLINE_WINDOW_MS || 'default(600000)'
      } : undefined
    });
  } catch (error) {
    console.error('Agents API error:', error);
    return NextResponse.json(
      { error: 'An error occurred while fetching agents', agents: [] },
      { status: 500 }
    );
  }
}
