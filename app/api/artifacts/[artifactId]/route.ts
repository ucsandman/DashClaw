export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db';
import { getOrgId } from '../../../lib/org';
import { apiErrorResponse } from '../../../lib/apiErrors';
import { getArtifact, deleteArtifact } from '../../../lib/repositories/artifacts.repository';

export async function GET(request: Request, { params }: { params: Promise<{ artifactId: string }> }) {
  try {
    const { artifactId } = await params;
    const sql = getSql();
    const orgId = getOrgId(request);

    const artifact = await getArtifact(sql, orgId, artifactId);
    if (!artifact) {
      return NextResponse.json({ error: 'artifact_not_found' }, { status: 404 });
    }

    return NextResponse.json(artifact);
  } catch (error) {
    return apiErrorResponse(error, 'ARTIFACT_DETAIL');
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ artifactId: string }> }) {
  try {
    const { artifactId } = await params;
    const sql = getSql();
    const orgId = getOrgId(request);

    const result = await deleteArtifact(sql, orgId, artifactId);
    if (!result) {
      return NextResponse.json({ error: 'artifact_not_found' }, { status: 404 });
    }

    return NextResponse.json({ deleted: true });
  } catch (error) {
    return apiErrorResponse(error, 'ARTIFACT_DELETE');
  }
}
