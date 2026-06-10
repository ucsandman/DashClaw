export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../../lib/db';
import { getOrgId } from '../../../../lib/org';
import { randomUUID } from 'node:crypto';

export async function GET(request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const agentId = searchParams.get('agent_id');
    const limit = Math.min(parseInt(searchParams.get('limit') || '20', 10), 100);

    const conditions = ['t.org_id = $1'];
    const params = [orgId];
    let idx = 2;

    if (status) {
      conditions.push(`t.status = $${idx}`);
      params.push(status);
      idx++;
    }

    if (agentId) {
      // Threads where agent is a participant or has sent messages
      conditions.push(`(t.participants ILIKE $${idx} OR t.created_by = $${idx + 1} OR EXISTS (SELECT 1 FROM agent_messages m WHERE m.thread_id = t.id AND (m.from_agent_id = $${idx + 1} OR m.to_agent_id = $${idx + 1})))`);
      params.push(`%${agentId}%`, agentId);
      idx += 2;
    }

    const where = conditions.join(' AND ');
    const rows = await sql.query(
      `SELECT t.*,
        (SELECT COUNT(*)::int FROM agent_messages m WHERE m.thread_id = t.id) as message_count,
        (SELECT MAX(m.created_at) FROM agent_messages m WHERE m.thread_id = t.id) as last_message_at
      FROM message_threads t
      WHERE ${where}
      ORDER BY COALESCE((SELECT MAX(m.created_at) FROM agent_messages m WHERE m.thread_id = t.id), t.created_at) DESC
      LIMIT $${idx}`,
      [...params, limit]
    );

    return NextResponse.json({ threads: rows, total: rows.length });
  } catch (error) {
    console.error('Message threads GET error:', error);
    return NextResponse.json({ error: 'An error occurred while fetching threads' }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const body = await request.json();

    const { name, participants, created_by } = body;

    if (!name) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }
    if (!created_by) {
      return NextResponse.json({ error: 'created_by is required' }, { status: 400 });
    }

    const id = `mt_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
    const now = new Date().toISOString();
    const participantsJson = participants ? JSON.stringify(participants) : null;

    const result = await sql`
      INSERT INTO message_threads (id, org_id, name, participants, status, created_by, created_at, updated_at)
      VALUES (${id}, ${orgId}, ${name}, ${participantsJson}, 'open', ${created_by}, ${now}, ${now})
      RETURNING *
    `;

    return NextResponse.json({ thread: result[0], thread_id: id }, { status: 201 });
  } catch (error) {
    console.error('Message threads POST error:', error);
    return NextResponse.json({ error: 'An error occurred while creating thread' }, { status: 500 });
  }
}

export async function PATCH(request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const body = await request.json();

    const { thread_id, status, summary } = body;

    if (!thread_id) {
      return NextResponse.json({ error: 'thread_id is required' }, { status: 400 });
    }

    // Verify thread exists
    const existing = await sql`SELECT * FROM message_threads WHERE id = ${thread_id} AND org_id = ${orgId}`;
    if (existing.length === 0) {
      return NextResponse.json({ error: 'Thread not found' }, { status: 404 });
    }

    const now = new Date().toISOString();
    const newStatus = status || existing[0].status;
    const newSummary = summary !== undefined ? summary : existing[0].summary;
    const resolvedAt = (newStatus === 'resolved' && existing[0].status !== 'resolved') ? now : existing[0].resolved_at;

    const result = await sql`
      UPDATE message_threads
      SET status = ${newStatus}, summary = ${newSummary}, resolved_at = ${resolvedAt}, updated_at = ${now}
      WHERE id = ${thread_id} AND org_id = ${orgId}
      RETURNING *
    `;

    return NextResponse.json({ thread: result[0] });
  } catch (error) {
    console.error('Message threads PATCH error:', error);
    return NextResponse.json({ error: 'An error occurred while updating thread' }, { status: 500 });
  }
}
