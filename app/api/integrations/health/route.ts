import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db';
import { getOrgId } from '../../../lib/org';
import { getHealthForOrg } from '../../../lib/repositories/integration-health.repository';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const orgId = getOrgId(request);
    const sql = getSql();
    const health = await getHealthForOrg(sql, orgId);

    const healthMap: Record<string, any> = {};
    for (const row of health) {
      healthMap[row.provider as string] = {
        status: row.status,
        message: row.message,
        checked_at: row.checked_at,
      };
    }

    return NextResponse.json({ health: healthMap });
  } catch (err) {
    console.error('[integrations/health] GET error:', err);
    return NextResponse.json({ error: 'Failed to fetch health status' }, { status: 500 });
  }
}
