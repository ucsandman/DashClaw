export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../lib/db';
import { getOrgId } from '../../lib/org';
import { createSession, listSessions } from '../../lib/sessions';

export async function POST(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const body = await request.json();

    const { agent_id, workspace, branch } = body;

    if (!agent_id || typeof agent_id !== 'string') {
      return NextResponse.json({ error: 'agent_id is required' }, { status: 400 });
    }

    const session = await createSession(sql, orgId, agent_id, workspace || null, branch || null);

    return NextResponse.json({ session }, { status: 201 });
  } catch (error) {
    console.error('Session create error:', error);
    return NextResponse.json({ error: 'Failed to create session' }, { status: 500 });
  }
}

export async function GET(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);

    const { searchParams } = new URL(request.url);
    const filters = {
      agent_id: searchParams.get('agent_id') || undefined,
      status: searchParams.get('status') || undefined,
      limit: searchParams.get('limit') || undefined,
    };

    const sessions = await listSessions(sql, orgId, filters);

    return NextResponse.json({ sessions });
  } catch (error) {
    console.error('Sessions list error:', error);
    return NextResponse.json({ error: 'Failed to list sessions' }, { status: 500 });
  }
}
