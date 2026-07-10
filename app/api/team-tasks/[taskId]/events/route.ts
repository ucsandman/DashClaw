export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../../lib/db';
import { getOrgId } from '../../../../lib/org';
import { EVENTS, publishOrgEvent } from '../../../../lib/events';
import {
  appendTeamTaskEvent, listTeamTaskEvents,
  TEAM_EVENT_TYPES, TEAM_AGENTS, TEAM_RECIPIENTS,
} from '../../../../lib/repositories/teamTasks.repository';

export async function POST(request: Request, { params }: { params: Promise<{ taskId: string }> }) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { taskId } = await params;
    const body = await request.json();
    const { ts, from_agent, to_agent, type, summary, action_id } = body;

    if (!TEAM_AGENTS.includes(from_agent)) {
      return NextResponse.json({ error: `invalid from_agent (allowed: ${TEAM_AGENTS.join(', ')})` }, { status: 400 });
    }
    if (!TEAM_RECIPIENTS.includes(to_agent)) {
      return NextResponse.json({ error: `invalid to_agent (allowed: ${TEAM_RECIPIENTS.join(', ')})` }, { status: 400 });
    }
    if (!TEAM_EVENT_TYPES.includes(type)) {
      return NextResponse.json({ error: `invalid type (allowed: ${TEAM_EVENT_TYPES.join(', ')})` }, { status: 400 });
    }
    if (!summary || typeof summary !== 'string') {
      return NextResponse.json({ error: 'summary is required' }, { status: 400 });
    }

    const event = await appendTeamTaskEvent(sql, orgId, taskId, {
      ts, from_agent, to_agent, type, summary, body: body.body, action_id,
    });
    if (!event) {
      return NextResponse.json({ error: 'task not found' }, { status: 404 });
    }

    void publishOrgEvent(EVENTS.TEAM_TASK_EVENT, { orgId, event, task_id: taskId });
    return NextResponse.json({ event }, { status: 201 });
  } catch (error) {
    console.error('Team task event append error:', error);
    return NextResponse.json({ error: 'Failed to append team task event' }, { status: 500 });
  }
}

export async function GET(request: Request, { params }: { params: Promise<{ taskId: string }> }) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { taskId } = await params;
    const { searchParams } = new URL(request.url);
    const events = await listTeamTaskEvents(sql, orgId, taskId, {
      limit: searchParams.get('limit') || undefined,
    });
    return NextResponse.json({ events });
  } catch (error) {
    console.error('Team task events list error:', error);
    return NextResponse.json({ error: 'Failed to list team task events' }, { status: 500 });
  }
}
