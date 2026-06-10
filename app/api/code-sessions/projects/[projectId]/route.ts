export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../../lib/db';
import { getOrgId } from '../../../../lib/org';
import { getProject, deleteCodeProject } from '../../../../lib/repositories/code-sessions.repository';

export async function GET(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const sql = getSql();
  const orgId = getOrgId(request);
  const project = await getProject(sql, orgId, projectId);
  if (!project) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  return NextResponse.json({ project });
}

// Deletes a project and all its sessions (sessions first — project_id has no
// cascade). Handoff bundles survive with project_id SET NULL. Irreversible.
export async function DELETE(request: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const sql = getSql();
  const orgId = getOrgId(request);
  const deleted = await deleteCodeProject(sql, orgId, projectId);
  if (!deleted) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  return NextResponse.json({ deleted: true, id: projectId });
}
