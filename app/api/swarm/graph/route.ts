export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db';
import { getOrgId } from '../../../lib/org';
import { listAgentsForOrg } from '../../../lib/repositories/agents.repository';

/**
 * GET /api/swarm/graph
 * Returns a graph representation of agent communication within the organization.
 * Nodes: Agents
 * Edges: Communication frequency (messages sent/received)
 */
export async function GET(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { searchParams } = new URL(request.url);
    const swarmId = searchParams.get('swarm_id');

    // 1. Fetch all agents in the org (broad discovery via repository)
    let agents: Array<{ agent_id: string; name?: string }>;
    if (swarmId) {
      // Swarm-scoped: start with action_records for the swarm, then merge broader discovery
      const swarmAgents = await sql`SELECT DISTINCT agent_id, MAX(agent_name) as name FROM action_records WHERE org_id = ${orgId} AND swarm_id = ${swarmId} GROUP BY agent_id` as Array<{ agent_id: string; name?: string }>;
      const allAgents = await listAgentsForOrg(sql, orgId);
      const swarmIds = new Set(swarmAgents.map((a) => a.agent_id));
      // Merge any agents not already found via swarm action_records
      agents = [
        ...swarmAgents,
        ...allAgents.filter((a) => !swarmIds.has(a.agent_id)).map((a) => ({ agent_id: a.agent_id, name: a.agent_name }))
      ];
    } else {
      const allAgents = await listAgentsForOrg(sql, orgId);
      agents = allAgents.map((a) => ({ agent_id: a.agent_id, name: a.agent_name }));
    }

    // 2. Fetch communication links (messages between agents)
    // We aggregate counts to create edge weights
    const linksQuery = sql`
      SELECT from_agent_id as source, to_agent_id as target, COUNT(*) as weight
      FROM agent_messages
      WHERE org_id = ${orgId}
        AND from_agent_id IS NOT NULL
        AND to_agent_id IS NOT NULL
      GROUP BY from_agent_id, to_agent_id
    `;

    const rawLinks = await linksQuery as Array<{ source: string; target: string; weight: string }>;

    // 3. Calculate agent stats for node sizing
    const statsQuery = sql`
      SELECT agent_id,
             COUNT(*) as action_count,
             AVG(risk_score) as avg_risk,
             SUM(cost_estimate) as total_cost
      FROM action_records
      WHERE org_id = ${orgId}
      GROUP BY agent_id
    `;
    // Neon returns COUNT/AVG/SUM aggregates as strings — type them honestly.
    const agentStats = await statsQuery as Array<{ agent_id: string; action_count?: number | string; avg_risk?: number | string; total_cost?: number | string }>;
    const statsMap: Record<string, { action_count?: number | string; avg_risk?: number | string; total_cost?: number | string }> = Object.fromEntries(agentStats.map((s) => [s.agent_id, s]));

    // Format for graph visualization (Nodes & Links). Coerce every aggregate to
    // a real number first — otherwise the node-size math did string concatenation
    // ('5' + 1 = '51'), wildly inflating node sizes.
    const nodes = agents.map((a) => {
      const stat = statsMap[a.agent_id];
      const actionCount = Number(stat?.action_count) || 0;
      return {
        id: a.agent_id,
        name: a.name || a.agent_id,
        actions: actionCount,
        risk: Number(stat?.avg_risk) || 0,
        cost: Number(stat?.total_cost) || 0,
        val: Math.log10((actionCount || 1) + 1) * 10 // Node size factor
      };
    });

    // Filter links to only include nodes we have
    const agentIds = new Set(nodes.map((n: { id: string }) => n.id));
    const links = rawLinks
      .filter((l: { source: string; target: string }) => agentIds.has(l.source) && agentIds.has(l.target))
      .map((l: { source: string; target: string; weight: string }) => ({
        source: l.source,
        target: l.target,
        weight: parseInt(l.weight, 10)
      }));

    return NextResponse.json({
      nodes,
      links,
      swarm_id: swarmId || 'all',
      total_agents: nodes.length,
      total_links: links.length
    });
  } catch (error) {
    console.error('[SWARM] Graph API error:', error);
    return NextResponse.json({ error: 'Failed to generate swarm graph' }, { status: 500 });
  }
}
