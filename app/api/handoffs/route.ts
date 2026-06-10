import { NextResponse } from 'next/server';
import { getSql } from '../../lib/db';
import { getOrgId } from '../../lib/org';
import { apiErrorResponse } from '../../lib/apiErrors';
import { createHandoff, getLatestHandoff, listHandoffs } from '../../lib/repositories/code-session-handoffs.repository';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// GET /api/handoffs — list handoffs (most-recent first) or, with ?latest=true,
// the single most recent unconsumed handoff for an agent. Both forms are
// already used by the Node/Python SDKs (getLatestHandoff / get_handoffs) and
// the dashboard Handoffs tab, which previously 405'd because only POST existed.
export async function GET(req: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(req);

    const { searchParams } = new URL(req.url);
    const agentId = searchParams.get('agent_id');
    const projectId = searchParams.get('project_id');

    if (searchParams.get('latest') === 'true') {
      if (!agentId) return NextResponse.json({ error: 'agent_id required' }, { status: 400 });
      const row = await getLatestHandoff(sql, orgId, { agentId, projectId });
      if (!row) return NextResponse.json({ error: 'no_handoff' }, { status: 404 });
      return NextResponse.json({
        id: row.id,
        agent_id: row.agent_id,
        project_id: row.project_id,
        bundle: row.bundle_json,
        created_at: row.created_at,
      });
    }

    const rows = await listHandoffs(sql, orgId, {
      agentId: agentId ?? undefined,
      projectId,
      limit: searchParams.get('limit') ?? undefined,
    });
    const handoffs = rows.map((row: any) => ({
      id: row.id,
      agent_id: row.agent_id,
      project_id: row.project_id,
      bundle: row.bundle_json,
      created_at: row.created_at,
      consumed_at: row.consumed_at,
    }));
    return NextResponse.json({ handoffs, total: handoffs.length });
  } catch (err) {
    return apiErrorResponse(err, 'HANDOFFS_GET');
  }
}

export async function POST(req: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(req);

    const body = await req.json().catch(() => ({}));
    if (!body.agent_id) return NextResponse.json({ error: 'agent_id required' }, { status: 400 });
    if (!body.bundle || typeof body.bundle !== 'object') {
      return NextResponse.json({ error: 'bundle (object) required' }, { status: 400 });
    }

    const result = await createHandoff(sql, orgId, {
      agentId: body.agent_id,
      projectId: body.project_id || null,
      createdInSessionId: body.created_in_session_id || null,
      bundle: body.bundle,
    });
    return NextResponse.json({ id: result.id }, { status: 201 });
  } catch (err) {
    return apiErrorResponse(err, 'HANDOFFS_POST');
  }
}
