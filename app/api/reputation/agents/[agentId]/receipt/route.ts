export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../../../lib/db';
import { getOrgId } from '../../../../../lib/org';
import { agentExistsInOrg } from '../../../../../lib/repositories/agents.repository';
import { getLatestReputationReceipt, buildCurrentReceipt } from '../../../../../lib/repositories/reputation.repository';

/**
 * GET /api/reputation/agents/[agentId]/receipt — the signed receipt for the
 * current vector. Returns the latest stored receipt when present; otherwise
 * builds one read-only (computed + signed, not persisted). 404 when unknown.
 */
export async function GET(request: Request, { params }: { params: Promise<{ agentId: string }> }) {
  try {
    const { agentId } = await params;
    const orgId = getOrgId(request);
    const sql = await getSql();

    const stored = await getLatestReputationReceipt(sql, orgId, agentId);
    if (stored) {
      return NextResponse.json({ agent_id: agentId, receipt: stored, source: 'stored' });
    }

    if (!(await agentExistsInOrg(sql, orgId, agentId))) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    const receipt = await buildCurrentReceipt(sql, orgId, agentId);
    return NextResponse.json({ agent_id: agentId, receipt, source: 'computed' });
  } catch (err) {
    console.error('[REPUTATION/RECEIPT] GET error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
