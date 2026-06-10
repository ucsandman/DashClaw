import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db';
import { getOrgId } from '../../../lib/org';
import { apiErrorResponse } from '../../../lib/apiErrors';
import { getLatestHandoff } from '../../../lib/repositories/code-session-handoffs.repository';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(req: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(req);

    const { searchParams } = new URL(req.url);
    const agentId = searchParams.get('agent_id');
    const projectId = searchParams.get('project_id');
    if (!agentId) return NextResponse.json({ error: 'agent_id required' }, { status: 400 });

    const row = await getLatestHandoff(sql, orgId, { agentId, projectId });
    if (!row) return NextResponse.json({ error: 'no_handoff' }, { status: 404 });

    return NextResponse.json({
      id: row.id,
      agent_id: row.agent_id,
      project_id: row.project_id,
      bundle: row.bundle_json,
      created_at: row.created_at,
    });
  } catch (err) {
    return apiErrorResponse(err, 'HANDOFFS_LATEST');
  }
}
