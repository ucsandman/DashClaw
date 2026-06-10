export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../../lib/db';
import { getOrgId } from '../../../../lib/org';
import { submitTask, listTasks } from '../../../../lib/repositories/routing.repository';
import { EVENTS, publishOrgEvent } from '../../../../lib/events';

/**
 * GET /api/routing/tasks?status=pending&limit=50 — List tasks
 */
export async function GET(request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { searchParams } = new URL(request.url);

    const filters = {
      status: searchParams.get('status') || undefined,
      assignedTo: searchParams.get('assigned_to') || undefined,
      limit: Math.min(parseInt(searchParams.get('limit') || '50', 10), 200),
    };

    const tasks = await listTasks(sql, orgId, filters);
    return NextResponse.json({ tasks, total: tasks.length });
  } catch (err) {
    console.error('[ROUTING/TASKS] GET error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/routing/tasks — Submit a task for routing
 * Body: { title, description, requiredSkills, urgency, timeoutSeconds, maxRetries, callbackUrl }
 */
export async function POST(request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const body = await request.json();

    if (!body.title) {
      return NextResponse.json({ error: 'title is required' }, { status: 400 });
    }

    const result = await submitTask(sql, orgId, body);

    void publishOrgEvent(EVENTS.TASK_ASSIGNED, { orgId, task: result.task, assigned_to: result.routing?.assigned_to });

    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    console.error('[ROUTING/TASKS] POST error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
