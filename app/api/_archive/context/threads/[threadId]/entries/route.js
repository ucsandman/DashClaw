export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../../../../lib/db';
import { getOrgId } from '../../../../../../lib/org';
import { enforceFieldLimits } from '../../../../../../lib/validate.js';
import { randomUUID } from 'node:crypto';

export async function POST(request, { params }) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { threadId } = params;
    const body = await request.json();

    const { ok, errors: fieldErrors } = enforceFieldLimits(body, { content: 5000, entry_type: 100 });
    if (!ok) {
      return NextResponse.json({ error: 'Validation failed', details: fieldErrors }, { status: 400 });
    }

    const { content, entry_type } = body;

    if (!content) {
      return NextResponse.json({ error: 'content is required' }, { status: 400 });
    }

    // Verify thread exists and belongs to org
    const thread = await sql`
      SELECT id, status FROM context_threads WHERE id = ${threadId} AND org_id = ${orgId}
    `;
    if (thread.length === 0) {
      return NextResponse.json({ error: 'Thread not found' }, { status: 404 });
    }
    if (thread[0].status === 'closed') {
      return NextResponse.json({ error: 'Cannot add entries to a closed thread' }, { status: 400 });
    }

    const id = `ce_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
    const now = new Date().toISOString();

    const result = await sql`
      INSERT INTO context_entries (id, thread_id, org_id, content, entry_type, created_at)
      VALUES (${id}, ${threadId}, ${orgId}, ${content}, ${entry_type || 'note'}, ${now})
      RETURNING *
    `;

    // Update thread's updated_at
    await sql`UPDATE context_threads SET updated_at = ${now} WHERE id = ${threadId} AND org_id = ${orgId}`;

    return NextResponse.json({ entry: result[0], entry_id: id }, { status: 201 });
  } catch (error) {
    console.error('Thread entries POST error:', error);
    return NextResponse.json({ error: 'An error occurred while adding entry' }, { status: 500 });
  }
}
