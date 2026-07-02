export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../../lib/db';
import { getOrgId } from '../../../../lib/org';
import { getSessionRetroData } from '../../../../lib/sessions';
import { buildSessionRetro } from '../../../../lib/session-retro';

// Per-session defensibility retro (roadmap v2.5) — posture + evidenced
// findings composed on read; no rows are written.
export async function GET(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  try {
    const { sessionId } = await params;
    const sql = getSql();
    const orgId = getOrgId(request);

    const data = await getSessionRetroData(sql, sessionId, orgId);
    if (!data) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    return NextResponse.json({ retro: buildSessionRetro(data) });
  } catch (error) {
    console.error('Session retro error:', error);
    return NextResponse.json({ error: 'Failed to build session retro' }, { status: 500 });
  }
}
