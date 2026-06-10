export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../../lib/db';
import { getOrgId } from '../../../../lib/org';
import { getSessionDetail, deleteCodeSession } from '../../../../lib/repositories/code-sessions.repository';

export async function GET(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const sql = getSql();
  const orgId = getOrgId(request);
  const detail = await getSessionDetail(sql, orgId, sessionId);
  if (!detail) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  return NextResponse.json(detail);
}

// Deletes one code session; message/tool-use/signal children cascade via the
// 0006 FKs. Irreversible telemetry loss — the UI gates this behind confirm.
export async function DELETE(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const sql = getSql();
  const orgId = getOrgId(request);
  const deleted = await deleteCodeSession(sql, orgId, sessionId);
  if (!deleted) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  return NextResponse.json({ deleted: true, id: sessionId });
}
