export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../../lib/db';
import { getOrgId } from '../../../../lib/org';
import { apiErrorResponse } from '../../../../lib/apiErrors';
import {
  getWorkflowTemplate,
  updateWorkflowTemplate,
  deleteWorkflowTemplate,
} from '../../../../lib/repositories/workflow-templates.repository';

export async function GET(request: Request, { params }: { params: Promise<{ templateId: string }> }) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { templateId } = await params;

    const template = await getWorkflowTemplate(sql, orgId, templateId);
    if (!template) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    }
    return NextResponse.json({ template });
  } catch (error) {
    return apiErrorResponse(error, 'WORKFLOW TEMPLATE GET');
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ templateId: string }> }) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const orgRole = request.headers.get('x-org-role') || '';
    const { templateId } = await params;
    const body = await request.json();

    // Workflow templates are governance artifacts. Mutating one can change
    // which steps execute for every future run — stricter than DELETE since
    // DELETE leaves no silent drift. Match the admin gate DELETE already has.
    if (orgRole !== 'admin') {
      return NextResponse.json({ error: 'Admin role required' }, { status: 403 });
    }

    const updated = await updateWorkflowTemplate(sql, orgId, templateId, body);
    if (!updated) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    }
    return NextResponse.json({ template: updated });
  } catch (error) {
    return apiErrorResponse(error, 'WORKFLOW TEMPLATE PATCH');
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ templateId: string }> }) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const orgRole = request.headers.get('x-org-role') || '';
    const { templateId } = await params;

    if (orgRole !== 'admin') {
      return NextResponse.json({ error: 'Admin role required' }, { status: 403 });
    }

    const deleted = await deleteWorkflowTemplate(sql, orgId, templateId);
    if (!deleted) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    }

    return NextResponse.json({ deleted: true, template_id: templateId });
  } catch (error) {
    return apiErrorResponse(error, 'WORKFLOW TEMPLATE DELETE');
  }
}
