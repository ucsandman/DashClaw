import { NextResponse } from 'next/server';
import { getSql } from '../../lib/db';
import { getOrgId } from '../../lib/org';
import { attachAgentConnections, listAgentsForOrg } from '../../lib/repositories/agents.repository';
import { getAgentCoverage } from '../../lib/repositories/coverage.repository';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const COVERAGE_WINDOW_HOURS = 24;

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

    // v4.2 coverage truth: merge per-agent record/outcome coverage in ONE extra
    // aggregate query (never per-agent). `coverage: null` = no evidence at all,
    // which must render differently from 100% on /agents.
    const coverageByAgent = new Map(
      (await getAgentCoverage(sql, orgId, COVERAGE_WINDOW_HOURS)).map((c) => [c.agentId, c]),
    );
    for (const agent of agents) {
      const cov = coverageByAgent.get(agent.agent_id);
      agent.coverage = cov
        ? {
            record_pct: cov.recordPct,
            outcome_pct: cov.outcomePct,
            expected: cov.expected,
            recorded: cov.recorded,
            window_hours: COVERAGE_WINDOW_HOURS,
          }
        : null;
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
