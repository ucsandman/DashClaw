export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../../../lib/db';
import { getOrgId } from '../../../../../lib/org';

export async function GET(request, { params }) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { threadId } = params;

    const threads = await sql`
      SELECT * FROM context_threads WHERE id = ${threadId} AND org_id = ${orgId}
    `;

    if (threads.length === 0) {
      return NextResponse.json({ error: 'Thread not found' }, { status: 404 });
    }

    const entries = await sql`
      SELECT * FROM context_entries WHERE thread_id = ${threadId} AND org_id = ${orgId} ORDER BY created_at ASC
    `;

    return NextResponse.json({ thread: threads[0], entries });
  } catch (error) {
    console.error('Thread GET error:', error);
    return NextResponse.json({ error: 'An error occurred while fetching thread' }, { status: 500 });
  }
}

export async function PATCH(request, { params }) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { threadId } = params;
    const body = await request.json();

    const { summary, status } = body;

    if (status && !['active', 'closed'].includes(status)) {
      return NextResponse.json({ error: 'status must be active or closed' }, { status: 400 });
    }

    // Verify thread exists and belongs to org
    const existing = await sql`
      SELECT id FROM context_threads WHERE id = ${threadId} AND org_id = ${orgId}
    `;
    if (existing.length === 0) {
      return NextResponse.json({ error: 'Thread not found' }, { status: 404 });
    }

    const now = new Date().toISOString();
    const updates = [];
    const values = [];
    let idx = 1;

    if (summary !== undefined) { updates.push(`summary = $${idx}`); values.push(summary); idx++; }
    if (status !== undefined) { updates.push(`status = $${idx}`); values.push(status); idx++; }
    updates.push(`updated_at = $${idx}`); values.push(now); idx++;

    if (updates.length === 1) {
      // Only updated_at, nothing meaningful to change
      return NextResponse.json({ error: 'At least one field (summary or status) is required' }, { status: 400 });
    }

    values.push(threadId, orgId);
    const result = await sql.query(
      `UPDATE context_threads SET ${updates.join(', ')} WHERE id = $${idx} AND org_id = $${idx + 1} RETURNING *`,
      values
    );

    return NextResponse.json({ thread: result[0] });
  } catch (error) {
    console.error('Thread PATCH error:', error);
    return NextResponse.json({ error: 'An error occurred while updating thread' }, { status: 500 });
  }
}
