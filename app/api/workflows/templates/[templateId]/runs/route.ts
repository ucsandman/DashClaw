export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getSql } from '../../../../../lib/db';
import { getOrgId } from '../../../../../lib/org';
import { apiErrorResponse } from '../../../../../lib/apiErrors';
import { listWorkflowRuns } from '../../../../../lib/repositories/workflow-runs.repository';

export async function GET(request: Request, { params }: { params: Promise<{ templateId: string }> }) {
  try {
    const { templateId } = await params;
    const sql = getSql();
    const orgId = getOrgId(request);
    const { searchParams } = new URL(request.url);

    const filters = {
      status: searchParams.get('status') || undefined,
      agent_id: searchParams.get('agent_id') || undefined,
      limit: searchParams.get('limit') || 20,
      offset: searchParams.get('offset') || 0,
    };

    const result = await listWorkflowRuns(sql, orgId, templateId, filters);

    return NextResponse.json({
      template_id: templateId,
      ...result,
    });
  } catch (error) {
    return apiErrorResponse(error, 'WORKFLOW_RUNS_LIST');
  }
}
