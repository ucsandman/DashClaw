export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db';
import { getOrgId } from '../../../lib/org';
import { apiErrorResponse } from '../../../lib/apiErrors';
import { buildOperationsFeed } from '../../../lib/operations-feed';

export async function GET(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { searchParams } = new URL(request.url);

    const filters = {
      category: searchParams.get('category') || undefined,
      severity: searchParams.get('severity') || undefined,
      agent_id: searchParams.get('agent_id') || undefined,
      limit: searchParams.get('limit') || 50,
      offset: searchParams.get('offset') || 0,
    };

    const result = await buildOperationsFeed(sql, orgId, filters);

    return NextResponse.json(result);
  } catch (error) {
    return apiErrorResponse(error, 'OPERATIONS_FEED');
  }
}
