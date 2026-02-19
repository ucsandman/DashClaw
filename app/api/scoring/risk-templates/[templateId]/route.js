import { getSql } from '../../../../lib/db.js';
import { getOrgId } from '../../../../lib/org.js';
import { updateRiskTemplate, deleteRiskTemplate } from '../../../../lib/scoringProfiles.js';

export async function PATCH(request, { params }) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { templateId } = await params;
    const body = await request.json();

    const updated = await updateRiskTemplate(sql, orgId, templateId, body);
    if (!updated) return Response.json({ error: 'Template not found' }, { status: 404 });

    return Response.json(updated);
  } catch (err) {
    console.error('[scoring/risk-templates/:id] PATCH error:', err.message);
    return Response.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { templateId } = await params;

    const deleted = await deleteRiskTemplate(sql, orgId, templateId);
    if (!deleted) return Response.json({ error: 'Template not found' }, { status: 404 });

    return Response.json({ deleted: true });
  } catch (err) {
    console.error('[scoring/risk-templates/:id] DELETE error:', err.message);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
