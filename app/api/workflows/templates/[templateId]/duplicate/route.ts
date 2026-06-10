export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../../../lib/db';
import { getOrgId } from '../../../../../lib/org';
import { apiErrorResponse } from '../../../../../lib/apiErrors';
import { duplicateWorkflowTemplate } from '../../../../../lib/repositories/workflow-templates.repository';

export async function POST(request: Request, { params }: { params: Promise<{ templateId: string }> }) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { templateId } = await params;

    // Accept optional name/slug override in body; tolerate empty body.
    let overrides = {};
    try {
      overrides = (await request.json()) || {};
    } catch {
      overrides = {};
    }

    const duplicate = await duplicateWorkflowTemplate(sql, orgId, templateId, overrides);
    if (!duplicate) {
      return NextResponse.json({ error: 'Source template not found' }, { status: 404 });
    }
    return NextResponse.json({ template: duplicate }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error, 'WORKFLOW TEMPLATE DUPLICATE');
  }
}
