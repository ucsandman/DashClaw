export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getOrgId } from '../../../../lib/org';
import { enforceFieldLimits } from '../../../../lib/validate.js';
import { getSql } from '../../../../lib/db';
import {
  listContextThreads,
  upsertContextThread,
} from '../../../../lib/repositories/messagesContext.repository';
import { randomUUID } from 'node:crypto';

export async function GET(request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { searchParams } = new URL(request.url);
    const agentId = searchParams.get('agent_id');
    const status = searchParams.get('status');
    const limit = Math.min(parseInt(searchParams.get('limit') || '20', 10), 100);

    const rows = await listContextThreads(sql, orgId, { agentId, status, limit });

    return NextResponse.json({ threads: rows, total: rows.length });
  } catch (error) {
    console.error('Context threads GET error:', error);
    return NextResponse.json({ error: 'An error occurred while fetching threads' }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const body = await request.json();

    const { ok, errors: fieldErrors } = enforceFieldLimits(body, { name: 500, summary: 5000 });
    if (!ok) {
      return NextResponse.json({ error: 'Validation failed', details: fieldErrors }, { status: 400 });
    }

    const { name, summary, agent_id } = body;

    if (!name) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }

    const id = `ct_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
    const now = new Date().toISOString();

    const result = await upsertContextThread(sql, {
      id,
      orgId,
      agent_id,
      name,
      summary,
      now,
    });

    return NextResponse.json({ thread: result, thread_id: result.id }, { status: 201 });
  } catch (error) {
    console.error('Context threads POST error:', error);
    return NextResponse.json({ error: 'An error occurred while creating thread' }, { status: 500 });
  }
}
