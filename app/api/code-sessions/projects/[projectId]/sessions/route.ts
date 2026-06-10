export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../../../lib/db';
import { getOrgId } from '../../../../../lib/org';
import { listSessions } from '../../../../../lib/repositories/code-sessions.repository';

export async function GET(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const sql = getSql();
  const orgId = getOrgId(request);
  const url = new URL(request.url);
  const limit = url.searchParams.get('limit');
  const offset = url.searchParams.get('offset');
  const sessions = await listSessions(sql, orgId, projectId, { limit: limit ?? undefined, offset: offset ?? undefined });
  return NextResponse.json({ project_id: projectId, sessions });
}
