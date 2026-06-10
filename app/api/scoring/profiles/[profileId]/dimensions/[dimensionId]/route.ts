export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { getSql } from '../../../../../../lib/db';
import { getOrgId } from '../../../../../../lib/org';
import { updateDimension, deleteDimension } from '../../../../../../lib/scoringProfiles';

export async function PATCH(request: Request, { params }: { params: Promise<{ profileId: string; dimensionId: string }> }) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { dimensionId } = await params;
    const body = await request.json();

    const updated = await updateDimension(sql, orgId, dimensionId, body);
    if (!updated) return Response.json({ error: 'Dimension not found' }, { status: 404 });

    return Response.json(updated);
  } catch (err) {
    console.error('[scoring/dimensions/:id] PATCH error:', (err as Error).message);
    return Response.json({ error: (err as Error).message || 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ profileId: string; dimensionId: string }> }) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { dimensionId } = await params;

    const deleted = await deleteDimension(sql, orgId, dimensionId);
    if (!deleted) return Response.json({ error: 'Dimension not found' }, { status: 404 });

    return Response.json({ deleted: true });
  } catch (err) {
    console.error('[scoring/dimensions/:id] DELETE error:', (err as Error).message);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
