export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { getSql } from '../../../../lib/db';
import { getOrgId } from '../../../../lib/org';
import { updateRiskTemplate, deleteRiskTemplate } from '../../../../lib/scoringProfiles';

export async function PATCH(request: Request, { params }: { params: Promise<{ templateId: string }> }) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { templateId } = await params;
    const body = await request.json();

    const updated = await updateRiskTemplate(sql, orgId, templateId, body);
    if (!updated) return Response.json({ error: 'Template not found' }, { status: 404 });

    return Response.json(updated);
  } catch (err) {
    console.error('[scoring/risk-templates/:id] PATCH error:', (err as Error).message);
    return Response.json({ error: (err as Error).message || 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ templateId: string }> }) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { templateId } = await params;

    const deleted = await deleteRiskTemplate(sql, orgId, templateId);
    if (!deleted) return Response.json({ error: 'Template not found' }, { status: 404 });

    return Response.json({ deleted: true });
  } catch (err) {
    console.error('[scoring/risk-templates/:id] DELETE error:', (err as Error).message);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
