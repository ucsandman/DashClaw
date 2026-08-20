export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../lib/db';
import { getOrgId } from '../../lib/org';
import { EVENTS, publishOrgEvent } from '../../lib/events';
import {
  createTeamTask, listTeamTasks,
  TEAM_TASK_STATUSES, TEAM_ORIGINS, TEAM_AGENT_ID_PATTERN, isTeamAgentId,
} from '../../lib/repositories/teamTasks.repository';

export async function POST(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const body = await request.json();
    const { id, instruction, origin, lead_agent, status, stop_condition, max_exchanges } = body;

    if (!id || typeof id !== 'string') {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }
    if (!instruction || typeof instruction !== 'string') {
      return NextResponse.json({ error: 'instruction is required' }, { status: 400 });
    }
    if (!TEAM_ORIGINS.includes(origin)) {
      return NextResponse.json({ error: `invalid origin (allowed: ${TEAM_ORIGINS.join(', ')})` }, { status: 400 });
    }
    if (!isTeamAgentId(lead_agent)) {
      return NextResponse.json({ error: `invalid lead_agent (expected an agent id matching ${TEAM_AGENT_ID_PATTERN})` }, { status: 400 });
    }
    if (status !== undefined && !TEAM_TASK_STATUSES.includes(status)) {
      return NextResponse.json({ error: `invalid status (allowed: ${TEAM_TASK_STATUSES.join(', ')})` }, { status: 400 });
    }

    let task;
    try {
      task = await createTeamTask(sql, orgId, { id, instruction, origin, lead_agent, status, stop_condition, max_exchanges });
    } catch (err: any) {
      if (err?.code === '23505') {
        return NextResponse.json({ error: 'task already exists' }, { status: 409 });
      }
      throw err;
    }

    void publishOrgEvent(EVENTS.TEAM_TASK_CREATED, { orgId, task });
    return NextResponse.json({ task }, { status: 201 });
  } catch (error) {
    console.error('Team task create error:', error);
    return NextResponse.json({ error: 'Failed to create team task' }, { status: 500 });
  }
}

export async function GET(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { searchParams } = new URL(request.url);
    const tasks = await listTeamTasks(sql, orgId, {
      status: searchParams.get('status') || undefined,
      limit: searchParams.get('limit') || undefined,
      offset: searchParams.get('offset') || undefined,
    });
    return NextResponse.json({ tasks });
  } catch (error) {
    console.error('Team tasks list error:', error);
    return NextResponse.json({ error: 'Failed to list team tasks' }, { status: 500 });
  }
}
