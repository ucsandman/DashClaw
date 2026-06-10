export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../../lib/db';
import { getOrgId } from '../../../../lib/org';
import { enforceFieldLimits } from '../../../../lib/validate.js';
import { randomUUID } from 'node:crypto';

const VALID_CATEGORIES = ['decision', 'task', 'insight', 'question', 'general'];

export async function GET(request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { searchParams } = new URL(request.url);
    const agentId = searchParams.get('agent_id');
    const category = searchParams.get('category');
    const sessionDate = searchParams.get('session_date');
    const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 200);

    // Build dynamic query
    const conditions = ['org_id = $1'];
    const params = [orgId];
    let idx = 2;

    if (agentId) { conditions.push(`agent_id = $${idx}`); params.push(agentId); idx++; }
    if (category) { conditions.push(`category = $${idx}`); params.push(category); idx++; }
    if (sessionDate) { conditions.push(`session_date = $${idx}`); params.push(sessionDate); idx++; }

    const where = conditions.join(' AND ');
    const rows = await sql.query(
      `SELECT * FROM context_points WHERE ${where} ORDER BY importance DESC, created_at DESC LIMIT $${idx}`,
      [...params, limit]
    );

    return NextResponse.json({ points: rows, total: rows.length });
  } catch (error) {
    console.error('Context points GET error:', error);
    return NextResponse.json({ error: 'An error occurred while fetching context points' }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const body = await request.json();

    const { ok, errors: fieldErrors } = enforceFieldLimits(body, { content: 5000, category: 100, session_date: 50 });
    if (!ok) {
      return NextResponse.json({ error: 'Validation failed', details: fieldErrors }, { status: 400 });
    }

    const { content, category, importance, session_date, agent_id } = body;

    if (!content) {
      return NextResponse.json({ error: 'content is required' }, { status: 400 });
    }
    if (category && !VALID_CATEGORIES.includes(category)) {
      return NextResponse.json({ error: `category must be one of: ${VALID_CATEGORIES.join(', ')}` }, { status: 400 });
    }
    if (importance !== undefined && (importance < 1 || importance > 10)) {
      return NextResponse.json({ error: 'importance must be between 1 and 10' }, { status: 400 });
    }

    const id = `cp_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
    const now = new Date().toISOString();
    const dateStr = session_date || now.split('T')[0];

    const result = await sql`
      INSERT INTO context_points (id, org_id, agent_id, content, category, importance, session_date, created_at)
      VALUES (
        ${id}, ${orgId}, ${agent_id || null}, ${content},
        ${category || 'general'}, ${importance || 5}, ${dateStr}, ${now}
      )
      RETURNING *
    `;

    return NextResponse.json({ point: result[0], point_id: id }, { status: 201 });
  } catch (error) {
    console.error('Context points POST error:', error);
    return NextResponse.json({ error: 'An error occurred while creating context point' }, { status: 500 });
  }
}
