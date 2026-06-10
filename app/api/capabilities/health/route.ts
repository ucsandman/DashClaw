export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db';
import { getOrgId } from '../../../lib/org';
import { apiErrorResponse } from '../../../lib/apiErrors';
import { listCapabilityHealthSummaries } from '../../../lib/capability-health';

export async function GET(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { searchParams } = new URL(request.url);

    const category = searchParams.get('category') || undefined;
    const risk_level = searchParams.get('risk_level') || undefined;
    const search = searchParams.get('search') || undefined;
    const status = searchParams.get('status') || undefined;
    const certification_status = searchParams.get('certification_status') || undefined;
    const stale_only = searchParams.get('stale_only') === 'true';
    const limit = searchParams.get('limit') || 100;
    const offset = searchParams.get('offset') || 0;

    const capabilities = await listCapabilityHealthSummaries(sql, orgId, {
      category,
      risk_level,
      search,
      status,
      certification_status,
      stale_only,
      limit,
      offset,
    });

    return NextResponse.json({ capabilities });
  } catch (error) {
    return apiErrorResponse(error, 'CAPABILITY_HEALTH_LIST');
  }
}
