export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db';
import { getOrgId } from '../../../lib/org';
import { apiErrorResponse } from '../../../lib/apiErrors';
import {
  listWorkflowTemplates,
  createWorkflowTemplate,
} from '../../../lib/repositories/workflow-templates.repository';

export async function GET(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { searchParams } = new URL(request.url);

    const status = searchParams.get('status') || undefined;
    const limit = searchParams.get('limit') || 50;
    const offset = searchParams.get('offset') || 0;

    const templates = await listWorkflowTemplates(sql, orgId, { status, limit, offset });
    return NextResponse.json({ templates });
  } catch (error) {
    return apiErrorResponse(error, 'WORKFLOW TEMPLATES GET');
  }
}

export async function POST(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const orgRole = request.headers.get('x-org-role') || '';
    const body = await request.json();

    if (orgRole !== 'admin') {
      return NextResponse.json({ error: 'Admin role required' }, { status: 403 });
    }

    if (!body?.name || typeof body.name !== 'string') {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }

    const template = await createWorkflowTemplate(sql, orgId, body);
    return NextResponse.json({ template }, { status: 201 });
  } catch (error) {
    const message = (error as Error).message;
    if (message?.includes('unique') || message?.includes('duplicate')) {
      return NextResponse.json({ error: 'A template with this slug already exists' }, { status: 409 });
    }
    return apiErrorResponse(error, 'WORKFLOW TEMPLATES POST');
  }
}
