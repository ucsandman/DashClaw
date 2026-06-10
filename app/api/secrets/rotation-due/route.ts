import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db';
import { getOrgId } from '../../../lib/org';
import { apiErrorResponse } from '../../../lib/apiErrors';
import { listRotationDue } from '../../../lib/repositories/governed-secrets.repository';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(req: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(req);

    const { searchParams } = new URL(req.url);
    const withinDays = Number(searchParams.get('within_days')) || 14;
    const agentId = searchParams.get('agent_id');

    const rows = await listRotationDue(sql, orgId, {
      withinDays,
      agentId: agentId || undefined,
    });
    return NextResponse.json({ due: rows, within_days: withinDays });
  } catch (err) {
    return apiErrorResponse(err, 'SECRETS_DUE');
  }
}
