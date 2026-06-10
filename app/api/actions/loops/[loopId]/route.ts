export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql as getDbSql } from '../../../../lib/db';
import { getOrgId } from '../../../../lib/org';
import { redactAny } from '../../../../lib/security';
import { publishOrgEvent, EVENTS } from '../../../../lib/events';


let _sql: ReturnType<typeof getDbSql> | undefined;
function getSql() {
  if (_sql) return _sql;
  _sql = getDbSql();
  return _sql;
}

export async function GET(request: Request, { params }: { params: Promise<{ loopId: string }> }) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { loopId } = await params;

    const loops = await sql`
      SELECT ol.*, ar.agent_id, ar.agent_name, ar.declared_goal, ar.action_type, ar.status as action_status
      FROM open_loops ol
      LEFT JOIN action_records ar ON ol.action_id = ar.action_id
      WHERE ol.loop_id = ${loopId} AND ol.org_id = ${orgId}
    `;

    if (loops.length === 0) {
      return NextResponse.json({ error: 'Open loop not found' }, { status: 404 });
    }

    return NextResponse.json({ loop: loops[0] });
  } catch (error) {
    console.error('Loop detail GET error:', error);
    return NextResponse.json({ error: 'An error occurred while fetching the loop' }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ loopId: string }> }) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { loopId } = await params;
    const body = await request.json();

    // Only allow status + resolution updates
    const { status, resolution } = body;

    if (!status || !['resolved', 'cancelled'].includes(status)) {
      return NextResponse.json(
        { error: 'status is required and must be "resolved" or "cancelled"' },
        { status: 400 }
      );
    }

    if (status === 'resolved' && !resolution) {
      return NextResponse.json(
        { error: 'resolution is required when resolving a loop' },
        { status: 400 }
      );
    }

    if (resolution && resolution.length > 2000) {
      return NextResponse.json(
        { error: 'resolution exceeds max length of 2000' },
        { status: 400 }
      );
    }

    // SECURITY: redact likely secrets before storing loop resolution.
    const dlpFindings: Array<{ severity?: string; category?: string }> = [];
    const safeResolution = resolution != null ? redactAny(resolution, dlpFindings) : null;

    // Atomic compare-and-set on status='open' — two concurrent operators
    // resolving the same loop cannot both win and silently clobber each
    // other's resolution text. If zero rows are returned, the loop either
    // does not exist (404) or is not open (409); a single lookup
    // distinguishes the two cases.
    const result = await sql`
      UPDATE open_loops
      SET status = ${status},
          resolution = ${safeResolution || null},
          resolved_at = ${new Date().toISOString()}
      WHERE loop_id = ${loopId} AND org_id = ${orgId} AND status = 'open'
      RETURNING *
    `;

    if (result.length === 0) {
      const existing = await sql`SELECT status FROM open_loops WHERE loop_id = ${loopId} AND org_id = ${orgId}`;
      if (existing.length === 0) {
        return NextResponse.json({ error: 'Open loop not found' }, { status: 404 });
      }
      return NextResponse.json({ error: 'Loop is already ' + existing[0]?.status }, { status: 409 });
    }

    const loop = result[0];

    // Publish event
    await publishOrgEvent(EVENTS.LOOP_UPDATED, {
      orgId,
      loop,
    });

    return NextResponse.json({
      loop,
      security: {
        clean: dlpFindings.length === 0,
        findings_count: dlpFindings.length,
        critical_count: dlpFindings.filter(f => f.severity === 'critical').length,
        categories: [...new Set(dlpFindings.map(f => f.category))],
      },
    });
  } catch (error) {
    console.error('Loop detail PATCH error:', error);
    return NextResponse.json({ error: 'An error occurred while updating the loop' }, { status: 500 });
  }
}
