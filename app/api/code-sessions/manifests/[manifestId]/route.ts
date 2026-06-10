export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../../lib/db';
import { getOrgId } from '../../../../lib/org';
import { getManifest } from '../../../../lib/repositories/code-sessions.repository';

export async function GET(request: Request, { params }: { params: Promise<{ manifestId: string }> }) {
  const { manifestId } = await params;
  const sql = getSql();
  const orgId = getOrgId(request);
  const manifest = await getManifest(sql, orgId, manifestId);
  if (!manifest) return NextResponse.json({ error: 'not_found_or_expired' }, { status: 404 });
  return NextResponse.json({
    id: manifest.id,
    session_id: manifest.session_id,
    project_cwd: manifest.project_cwd,
    plan: manifest.plan,
    expires_at: manifest.expires_at,
    created_at: manifest.created_at,
  });
}
