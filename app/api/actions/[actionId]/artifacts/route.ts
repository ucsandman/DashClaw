export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getSql } from '../../../../lib/db';
import { getOrgId } from '../../../../lib/org';
import { apiErrorResponse } from '../../../../lib/apiErrors';
import { listArtifacts } from '../../../../lib/repositories/artifacts.repository';

export async function GET(request: Request, { params }: { params: Promise<{ actionId: string }> }) {
  try {
    const { actionId } = await params;
    const sql = getSql();
    const orgId = getOrgId(request);
    const { searchParams } = new URL(request.url);

    const result = await listArtifacts(sql, orgId, {
      action_id: actionId,
      limit: searchParams.get('limit') || 50,
      offset: searchParams.get('offset') || 0,
    });

    return NextResponse.json(result);
  } catch (error) {
    return apiErrorResponse(error, 'ACTION_ARTIFACTS');
  }
}
