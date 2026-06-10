export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db';
import { getOrgId } from '../../../lib/org';
import { randomUUID } from 'node:crypto';
import { listThreads, createThread, getThreadById, updateThread } from '../../../lib/repositories/messagesContext.repository';

export async function GET(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const agentId = searchParams.get('agent_id');
    const limit = Math.min(parseInt(searchParams.get('limit') || '20', 10), 100);

    const rows = await listThreads(sql, orgId, { status: status ?? undefined, agentId: agentId ?? undefined, limit });

    return NextResponse.json({ threads: rows, total: rows.length });
  } catch (error) {
    console.error('Message threads GET error:', error);
    return NextResponse.json({ error: 'An error occurred while fetching threads' }, { status: 500 });
  }
}

export async function POST(request: Request) {
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

    const thread = await createThread(sql, orgId, { id, name, participants, created_by, now });

    return NextResponse.json({ thread, thread_id: id }, { status: 201 });
  } catch (error) {
    console.error('Message threads POST error:', error);
    return NextResponse.json({ error: 'An error occurred while creating thread' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const body = await request.json();

    const { thread_id, status, summary } = body;

    if (!thread_id) {
      return NextResponse.json({ error: 'thread_id is required' }, { status: 400 });
    }

    // message_threads ids are `mt_*`; context_threads are `ct_*`. Without this
    // prefix check a ct_ id falls through to getThreadById, which queries the
    // wrong table and returns a misleading 404 instead of a clear 400.
    if (typeof thread_id !== 'string' || !thread_id.startsWith('mt_')) {
      return NextResponse.json(
        { error: 'thread_id must be a message-thread id (mt_*). Use /api/context/threads for context thread ids (ct_*).' },
        { status: 400 },
      );
    }

    const existing = await getThreadById(sql, orgId, thread_id);
    if (!existing) {
      return NextResponse.json({ error: 'Thread not found' }, { status: 404 });
    }

    const now = new Date().toISOString();
    const newStatus = status || existing.status;
    const newSummary = summary !== undefined ? summary : existing.summary;
    const resolvedAt = (newStatus === 'resolved' && existing.status !== 'resolved') ? now : existing.resolved_at;

    const thread = await updateThread(sql, orgId, thread_id, {
      status: newStatus,
      summary: newSummary,
      resolvedAt,
      now,
    });

    return NextResponse.json({ thread });
  } catch (error) {
    console.error('Message threads PATCH error:', error);
    return NextResponse.json({ error: 'An error occurred while updating thread' }, { status: 500 });
  }
}
