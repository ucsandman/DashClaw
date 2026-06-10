export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../../lib/db';
import { getOrgId } from '../../../../lib/org';
import { getSession, getSessionEvents } from '../../../../lib/sessions';

export async function GET(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  try {
    const { sessionId } = await params;
    const sql = getSql();
    const orgId = getOrgId(request);

    // Verify the session exists and belongs to this org
    const session = await getSession(sql, sessionId, orgId);

    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    const events = await getSessionEvents(sql, sessionId, orgId);

    return NextResponse.json({ events });
  } catch (error) {
    console.error('Session events error:', error);
    return NextResponse.json({ error: 'Failed to fetch session events' }, { status: 500 });
  }
}
