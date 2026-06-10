export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db';
import { getOrgId } from '../../../lib/org';
import { listProjects } from '../../../lib/repositories/code-sessions.repository';

export async function GET(request: Request) {
  const sql = getSql();
  const orgId = getOrgId(request);
  const projects = await listProjects(sql, orgId);
  return NextResponse.json({ projects });
}
