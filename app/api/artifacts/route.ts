export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getSql } from '../../lib/db';
import { getOrgId } from '../../lib/org';
import { apiErrorResponse } from '../../lib/apiErrors';
import { listArtifacts, createArtifact } from '../../lib/repositories/artifacts.repository';

export async function GET(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { searchParams } = new URL(request.url);

    const filters = {
      action_id: searchParams.get('action_id') || undefined,
      step_id: searchParams.get('step_id') || undefined,
      agent_id: searchParams.get('agent_id') || undefined,
      artifact_type: searchParams.get('type') || undefined,
      limit: searchParams.get('limit') || 50,
      offset: searchParams.get('offset') || 0,
    };

    const result = await listArtifacts(sql, orgId, filters);
    return NextResponse.json(result);
  } catch (error) {
    return apiErrorResponse(error, 'ARTIFACTS_LIST');
  }
}

export async function POST(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const body = await request.json();

    if (!body.artifact_type || !body.name) {
      return NextResponse.json(
        { error: 'artifact_type and name are required' },
        { status: 400 },
      );
    }

    const artifact = await createArtifact(sql, orgId, body);
    return NextResponse.json({ artifact }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error, 'ARTIFACTS_CREATE');
  }
}
