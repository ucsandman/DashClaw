export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../../../../lib/db';
import { getOrgId } from '../../../../../../lib/org';
import { completeTask } from '../../../../../../lib/repositories/routing.repository';
import { EVENTS, publishOrgEvent } from '../../../../../../lib/events';

/**
 * POST /api/routing/tasks/:taskId/complete — Complete a task
 * Body: { success: boolean, result?: any, error?: string }
 */
export async function POST(request, { params }) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { taskId } = await params;
    const body = await request.json();

    const result = await completeTask(sql, orgId, taskId, {
      success: body.success !== false,
      result: body.result,
      error: body.error,
    });

    void publishOrgEvent(EVENTS.TASK_COMPLETED, { orgId, task: result.task });

    return NextResponse.json(result);
  } catch (err) {
    if (err.message?.includes('not found')) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    console.error('[ROUTING/TASKS/:id/COMPLETE] POST error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
