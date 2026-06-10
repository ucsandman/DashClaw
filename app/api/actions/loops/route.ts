export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql as getDbSql } from '../../../lib/db';
import { validateOpenLoop } from '../../../lib/validate.js';
import { getOrgId } from '../../../lib/org';
import { redactAny } from '../../../lib/security';
import { publishOrgEvent, EVENTS } from '../../../lib/events';
import crypto from 'crypto';


let _sql: ReturnType<typeof getDbSql> | undefined;
function getSql() {
  if (_sql) return _sql;
  _sql = getDbSql();
  return _sql;
}

export async function GET(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { searchParams } = new URL(request.url);

    const status = searchParams.get('status');
    const loop_type = searchParams.get('loop_type');
    const priority = searchParams.get('priority');
    const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 200);
    const offset = parseInt(searchParams.get('offset') || '0', 10);
    const agent_id = searchParams.get('agent_id');

    let paramIdx = 1;
    const conditions = [`ol.org_id = $${paramIdx++}`];
    const params: unknown[] = [orgId];

    if (status) {
      conditions.push(`ol.status = $${paramIdx++}`);
      params.push(status);
    }
    if (loop_type) {
      conditions.push(`ol.loop_type = $${paramIdx++}`);
      params.push(loop_type);
    }
    if (priority) {
      conditions.push(`ol.priority = $${paramIdx++}`);
      params.push(priority);
    }
    if (agent_id) {
      conditions.push(`ar.agent_id = $${paramIdx++}`);
      params.push(agent_id);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const query = `
      SELECT ol.*, ar.agent_id, ar.agent_name, ar.declared_goal, ar.action_type
      FROM open_loops ol
      LEFT JOIN action_records ar ON ol.action_id = ar.action_id AND ar.org_id = ol.org_id
      ${where}
      ORDER BY
        CASE ol.priority
          WHEN 'critical' THEN 0
          WHEN 'high' THEN 1
          WHEN 'medium' THEN 2
          WHEN 'low' THEN 3
        END,
        ol.created_at DESC
      LIMIT $${paramIdx++} OFFSET $${paramIdx++}
    `;
    params.push(limit, offset);

    // The count must mirror the main query's join: the `where` clause can
    // reference ar.agent_id (when an agent_id filter is supplied), so the
    // LEFT JOIN to action_records has to be present here too. Without it
    // Postgres errors with "missing FROM-clause entry for table ar" and the
    // whole GET returns 500. The join cannot multiply rows (one action_record
    // per action_id per org), so COUNT(*) is unchanged for the unfiltered case.
    const countQuery = `
      SELECT COUNT(*) as total
      FROM open_loops ol
      LEFT JOIN action_records ar ON ol.action_id = ar.action_id AND ar.org_id = ol.org_id
      ${where}
    `;
    const countParams = params.slice(0, -2);

    const [loops, countResult, stats] = await Promise.all([
      sql.query(query, params),
      sql.query(countQuery, countParams),
      sql`
        SELECT
          COUNT(*) FILTER (WHERE status = 'open') as open_count,
          COUNT(*) FILTER (WHERE status = 'resolved') as resolved_count,
          COUNT(*) FILTER (WHERE priority = 'critical' AND status = 'open') as critical_open,
          COUNT(*) FILTER (WHERE priority = 'high' AND status = 'open') as high_open
        FROM open_loops
        WHERE org_id = ${orgId}
      `
    ]);

    return NextResponse.json({
      loops,
      total: parseInt((countResult[0]?.total as string | undefined) || '0', 10),
      stats: stats[0] || {},
      lastUpdated: new Date().toISOString()
    });
  } catch (error) {
    console.error('Open Loops API GET error:', error);
    return NextResponse.json(
      { error: 'An error occurred while fetching open loops', loops: [], stats: {} },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    let body;
    try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }

    const { valid, data, errors } = validateOpenLoop(body);
    if (!valid) {
      return NextResponse.json({ error: 'Validation failed', details: errors }, { status: 400 });
    }

    // SECURITY: redact likely secrets before storing loop fields.
    const dlpFindings: Array<{ severity?: string; category?: string }> = [];
    for (const k of ['description', 'owner', 'resolution']) {
      if (data[k] != null) data[k] = redactAny(data[k], dlpFindings);
    }

    // Verify parent action exists
    const action = await sql`
      SELECT action_id, agent_id, agent_name, declared_goal, action_type
      FROM action_records
      WHERE action_id = ${data.action_id} AND org_id = ${orgId}
    `;
    const parentAction = action[0];
    if (!parentAction) {
      return NextResponse.json({ error: 'Parent action not found' }, { status: 404 });
    }

    const loop_id = data.loop_id || `loop_${crypto.randomUUID()}`;

    const result = await sql`
      INSERT INTO open_loops (
        org_id, loop_id, action_id, loop_type, description,
        status, priority, owner
      ) VALUES (
        ${orgId},
        ${loop_id},
        ${data.action_id},
        ${data.loop_type},
        ${data.description},
        ${data.status || 'open'},
        ${data.priority || 'medium'},
        ${data.owner || null}
      )
      RETURNING *
    `;

    const loop = result[0];

    // Publish event
    // We attach parent action details to help frontend avoid an extra fetch
    const eventPayload = {
      ...loop,
      agent_id: parentAction.agent_id,
      agent_name: parentAction.agent_name || parentAction.agent_id,
      declared_goal: parentAction.declared_goal,
      action_type: parentAction.action_type,
    };

    await publishOrgEvent(EVENTS.LOOP_CREATED, {
      orgId,
      loop: eventPayload,
    });

    return NextResponse.json({
      loop: eventPayload,
      loop_id,
      security: {
        clean: dlpFindings.length === 0,
        findings_count: dlpFindings.length,
        critical_count: dlpFindings.filter(f => f.severity === 'critical').length,
        categories: [...new Set(dlpFindings.map(f => f.category))],
      },
    }, { status: 201 });
  } catch (error) {
    console.error('Open Loops API POST error:', error);
    if ((error as Error).message?.includes('unique') || (error as Error).message?.includes('duplicate')) {
      return NextResponse.json({ error: 'Loop with this loop_id already exists' }, { status: 409 });
    }
    return NextResponse.json({ error: 'An error occurred while creating the open loop' }, { status: 500 });
  }
}
