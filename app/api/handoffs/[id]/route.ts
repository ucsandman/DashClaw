import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db';
import { getOrgId } from '../../../lib/org';
import { apiErrorResponse } from '../../../lib/apiErrors';
import { getHandoffById } from '../../../lib/repositories/code-session-handoffs.repository';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const sql = getSql();
    const orgId = getOrgId(req);

    const row = await getHandoffById(sql, orgId, id);
    if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 });

    return NextResponse.json({
      id: row.id,
      agent_id: row.agent_id,
      project_id: row.project_id,
      bundle: row.bundle_json,
      created_at: row.created_at,
      consumed_at: row.consumed_at,
    });
  } catch (err) {
    return apiErrorResponse(err, 'HANDOFFS_GET');
  }
}
