import { NextResponse } from 'next/server';
import { getSql } from '../../lib/db';
import { getOrgId } from '../../lib/org';
import { apiErrorResponse } from '../../lib/apiErrors';
import { listSecrets, createSecret } from '../../lib/repositories/governed-secrets.repository';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(req: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(req);

    const { searchParams } = new URL(req.url);
    const agentId = searchParams.get('agent_id');
    const rows = await listSecrets(sql, orgId, agentId ? { agentId } : {});
    return NextResponse.json({ secrets: rows });
  } catch (err) {
    return apiErrorResponse(err, 'SECRETS_GET');
  }
}

export async function POST(req: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(req);

    const body = await req.json().catch(() => ({}));
    if (!body.name) return NextResponse.json({ error: 'name required' }, { status: 400 });

    const result = await createSecret(sql, orgId, {
      name: body.name,
      agentId: body.agent_id || null,
      lastRotatedAt: body.last_rotated_at || null,
      rotationIntervalDays: body.rotation_interval_days,
      notes: body.notes || null,
    });
    return NextResponse.json({ id: result.id, name: result.name }, { status: 201 });
  } catch (err) {
    return apiErrorResponse(err, 'SECRETS_POST');
  }
}
