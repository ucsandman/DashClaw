import { getSql } from '../../../../../../lib/db.js';
import { getOrgId } from '../../../../../../lib/org.js';
import { updateDimension, deleteDimension } from '../../../../../../lib/scoringProfiles.js';

export async function PATCH(request, { params }) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { dimensionId } = await params;
    const body = await request.json();

    const updated = await updateDimension(sql, orgId, dimensionId, body);
    if (!updated) return Response.json({ error: 'Dimension not found' }, { status: 404 });

    return Response.json(updated);
  } catch (err) {
    console.error('[scoring/dimensions/:id] PATCH error:', err.message);
    return Response.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { dimensionId } = await params;

    const deleted = await deleteDimension(sql, orgId, dimensionId);
    if (!deleted) return Response.json({ error: 'Dimension not found' }, { status: 404 });

    return Response.json({ deleted: true });
  } catch (err) {
    console.error('[scoring/dimensions/:id] DELETE error:', err.message);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
