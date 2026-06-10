export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db';
import { getOrgId } from '../../../lib/org';
import { getSession, updateSession } from '../../../lib/sessions';

export async function GET(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  try {
    const { sessionId } = await params;
    const sql = getSql();
    const orgId = getOrgId(request);

    const session = await getSession(sql, sessionId, orgId);

    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    return NextResponse.json({ session });
  } catch (error) {
    console.error('Session detail error:', error);
    return NextResponse.json({ error: 'Failed to fetch session' }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  try {
    const { sessionId } = await params;
    const sql = getSql();
    const orgId = getOrgId(request);
    const body = await request.json();

    const { status, green_level, branch_freshness, commits_behind, blocked_reason, summary } = body;

    // At least one update field must be present
    if (!status && !green_level && !branch_freshness && commits_behind == null && !blocked_reason) {
      return NextResponse.json({ error: 'No update fields provided' }, { status: 400 });
    }

    const session = await updateSession(sql, sessionId, orgId, {
      status,
      green_level,
      branch_freshness,
      commits_behind,
      blocked_reason,
      // session_end (MCP dashclaw_session_end) sends { status, summary }; the
      // summary used to be silently dropped. updateSession now records it as
      // the terminal session_event's detail. Note: summary alone (no status)
      // still fails the field check above by design — there is no terminal
      // event to attach it to without a status transition.
      summary,
    });

    if (!session) {
      // updateSession returns null both when the session does not exist and when
      // it exists but is closed (the terminal-state guard rejects updates).
      // Disambiguate so a closed session gets an accurate 409 instead of a
      // contradictory 404 (GET still returns the closed session).
      const existing = await getSession(sql, sessionId, orgId);
      if (existing) {
        return NextResponse.json(
          { error: 'Session is closed and cannot be updated' },
          { status: 409 }
        );
      }
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    return NextResponse.json({ session });
  } catch (error) {
    console.error('Session update error:', error);
    return NextResponse.json({ error: 'Failed to update session' }, { status: 500 });
  }
}
