export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../../lib/db';
import { getOrgId } from '../../../../lib/org';
import { getSession, getSessionActions } from '../../../../lib/sessions';

// Lists the action_records attributed to a session (newest first, paginated).
// Shares the exact match predicate with the session's action_count aggregate,
// so `total` here always equals the "# Actions" card.
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

    const { searchParams } = new URL(request.url);
    const { actions, total } = await getSessionActions(sql, sessionId, orgId, {
      limit: searchParams.get('limit'),
      offset: searchParams.get('offset'),
    });

    return NextResponse.json({ actions, total });
  } catch (error) {
    console.error('Session actions error:', error);
    return NextResponse.json({ error: 'Failed to fetch session actions' }, { status: 500 });
  }
}
