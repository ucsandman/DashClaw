import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db';
import { getOrgId } from '../../../lib/org';
import { apiErrorResponse } from '../../../lib/apiErrors';
import { updateSecret, deleteSecret } from '../../../lib/repositories/governed-secrets.repository';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const sql = getSql();
    const orgId = getOrgId(req);

    const body = await req.json().catch(() => ({}));
    const row = await updateSecret(sql, orgId, id, {
      lastRotatedAt: body.last_rotated_at,
      rotationIntervalDays: body.rotation_interval_days,
      notes: body.notes,
    });
    if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    return NextResponse.json(row);
  } catch (err) {
    return apiErrorResponse(err, 'SECRETS_PATCH');
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const sql = getSql();
    const orgId = getOrgId(req);

    const ok = await deleteSecret(sql, orgId, id);
    if (!ok) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    return NextResponse.json({ deleted: id });
  } catch (err) {
    return apiErrorResponse(err, 'SECRETS_DELETE');
  }
}
