import { NextResponse } from 'next/server';
import { getSql } from '../../lib/db';
import { getOrgId } from '../../lib/org';
import { listAgentsForOrg } from '../../lib/repositories/agents.repository';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Slim agent roster: the distinct agents an org has governed, derived from
// action_records (with goals/decisions as fallbacks) in the repository layer.
// This is the minimal surface the shared agent-filter picker
// (AgentFilterContext), the identities fleet view, and the policy CustomTab
// agent dropdown consume — each needs { agent_id, agent_name } and nothing
// more. The richer fleet/coverage/connections view was removed in the v5 cull;
// this endpoint intentionally does not restore it.
export async function GET(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { searchParams } = new URL(request.url);
    const includeSynthetic = searchParams.get('include_synthetic') === 'true';
    const agents = await listAgentsForOrg(sql, orgId, { includeSynthetic });
    return NextResponse.json({ agents, lastUpdated: new Date().toISOString() });
  } catch (error) {
    console.error('Agents API error:', error);
    return NextResponse.json(
      { error: 'An error occurred while fetching agents', agents: [] },
      { status: 500 }
    );
  }
}
