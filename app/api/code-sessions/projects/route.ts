export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db';
import { getOrgId } from '../../../lib/org';
import { listProjects, clearAllCodeSessions } from '../../../lib/repositories/code-sessions.repository';

export async function GET(request: Request) {
  const sql = getSql();
  const orgId = getOrgId(request);
  const projects = await listProjects(sql, orgId);
  return NextResponse.json({ projects });
}

// Clear-all: removes every code session and project for the caller org
// (sessions first — project_id has no cascade; handoffs survive via SET NULL).
// Requires the explicit ?confirm=all guard so a stray DELETE on the collection
// URL can't wipe telemetry; the UI additionally gates it behind typed confirm.
export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  if (searchParams.get('confirm') !== 'all') {
    return NextResponse.json(
      { error: 'confirm_required', hint: 'Pass ?confirm=all to clear every code session and project for this org.' },
      { status: 400 },
    );
  }
  const sql = getSql();
  const orgId = getOrgId(request);
  const result = await clearAllCodeSessions(sql, orgId);
  return NextResponse.json({ deleted: true, ...result });
}
