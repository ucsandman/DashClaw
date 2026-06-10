export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getSql } from '../../../../../../../lib/db';
import { getOrgId } from '../../../../../../../lib/org';
import { apiErrorResponse } from '../../../../../../../lib/apiErrors';
import { cancelWorkflowRun } from '../../../../../../../lib/repositories/workflow-runs.repository';

export async function POST(request: Request, { params }: { params: Promise<{ templateId: string; runActionId: string }> }) {
  try {
    const { templateId, runActionId } = await params;
    const sql = getSql();
    const orgId = getOrgId(request);

    const result = await cancelWorkflowRun(sql, orgId, runActionId);

    if (!result.found) {
      return NextResponse.json({ error: 'run_not_found' }, { status: 404 });
    }

    if (!result.running) {
      return NextResponse.json(
        { error: 'not_running', message: 'Only running workflows can be cancelled.' },
        { status: 400 },
      );
    }

    return NextResponse.json({
      success: true,
      action_id: runActionId,
      status: 'cancelled',
    });
  } catch (error) {
    return apiErrorResponse(error, 'WORKFLOW_CANCEL');
  }
}
