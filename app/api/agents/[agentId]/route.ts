export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db';
import { getOrgId } from '../../../lib/org';
import { getAgentDetail } from '../../../lib/repositories/agents.repository';

export async function GET(request: Request, { params }: { params: Promise<{ agentId: string }> }) {
  try {
    const { agentId } = await params;
    const orgId = getOrgId(request);
    const sql = await getSql();

    const agent = await getAgentDetail(sql, orgId, agentId);

    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    return NextResponse.json({ agent });
  } catch (error) {
    console.error('Agent Detail API error:', error);
    return NextResponse.json(
      { error: 'An error occurred while fetching agent details' },
      { status: 500 }
    );
  }
}
