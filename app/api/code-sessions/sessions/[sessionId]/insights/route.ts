export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../../../lib/db';
import { getOrgId } from '../../../../../lib/org';
import {
  getSessionInsights,
  listSignalsForSession,
} from '../../../../../lib/repositories/code-sessions.repository';
import { detectRepeatedRuns } from '../../../../../lib/claude-code/repeated-runs';
import type { ToolEvent } from '../../../../../lib/claude-code/repeated-runs';

export async function GET(request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const sql = getSql();
  const orgId = getOrgId(request);
  const insights = await getSessionInsights(sql, orgId, sessionId);
  if (!insights) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  // getSessionInsights types toolEvent fields as `unknown` (DB-origin); they
  // match ToolEvent (name/requestId/target) at runtime.
  const repeatedRuns = detectRepeatedRuns(insights.toolEvents as ToolEvent[]);
  const signals = await listSignalsForSession(sql, orgId, sessionId);
  return NextResponse.json({
    session_id: sessionId,
    repeated_runs: repeatedRuns,
    signals,
  });
}
