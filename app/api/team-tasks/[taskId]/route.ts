export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db';
import { getOrgId } from '../../../lib/org';
import {
  getTeamTask, updateTeamTask, listTeamTaskEvents,
  TEAM_TASK_STATUSES,
} from '../../../lib/repositories/teamTasks.repository';

export async function GET(request: Request, { params }: { params: Promise<{ taskId: string }> }) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { taskId } = await params;

    const task = await getTeamTask(sql, orgId, taskId);
    if (!task) {
      return NextResponse.json({ error: 'task not found' }, { status: 404 });
    }
    const events = await listTeamTaskEvents(sql, orgId, taskId, {});
    return NextResponse.json({ task, events });
  } catch (error) {
    console.error('Team task get error:', error);
    return NextResponse.json({ error: 'Failed to get team task' }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ taskId: string }> }) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { taskId } = await params;
    const body = await request.json();
    const { status, claude_session_id, openclaw_session_key } = body;

    if (status !== undefined && !TEAM_TASK_STATUSES.includes(status)) {
      return NextResponse.json({ error: `invalid status (allowed: ${TEAM_TASK_STATUSES.join(', ')})` }, { status: 400 });
    }
    if (status === undefined && claude_session_id === undefined && openclaw_session_key === undefined) {
      return NextResponse.json({ error: 'nothing to update' }, { status: 400 });
    }

    const task = await updateTeamTask(sql, orgId, taskId, { status, claude_session_id, openclaw_session_key });
    if (!task) {
      return NextResponse.json({ error: 'task not found' }, { status: 404 });
    }
    return NextResponse.json({ task });
  } catch (error) {
    console.error('Team task update error:', error);
    return NextResponse.json({ error: 'Failed to update team task' }, { status: 500 });
  }
}
