export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getSql } from '../../../../../lib/db';
import { getOrgId } from '../../../../../lib/org';
import { apiErrorResponse } from '../../../../../lib/apiErrors';
import { evaluateAccess } from '../../../../../lib/repositories/capability-access.repository';

export async function GET(request: Request, { params }: { params: Promise<{ capabilityId: string }> }) {
  try {
    const { capabilityId } = await params;
    const sql = getSql();
    const orgId = getOrgId(request);
    const { searchParams } = new URL(request.url);
    const agentId = searchParams.get('agent_id');

    if (!agentId) {
      return NextResponse.json({ error: 'agent_id query param is required' }, { status: 400 });
    }

    const result = await evaluateAccess(sql, orgId, capabilityId, agentId);
    return NextResponse.json(result);
  } catch (error) {
    return apiErrorResponse(error, 'CAPABILITY_ACCESS_CHECK');
  }
}
