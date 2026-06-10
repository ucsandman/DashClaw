export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getOrgId } from '../../../lib/org';
import { enforceFieldLimits } from '../../../lib/validate.js';
import { getSql } from '../../../lib/db';
import { scanSensitiveData } from '../../../lib/security';
import { randomUUID } from 'node:crypto';

export async function GET(request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { searchParams } = new URL(request.url);
    const agentId = searchParams.get('agent_id');
    const date = searchParams.get('date');
    const latest = searchParams.get('latest');
    const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 1000);

    if (latest === 'true') {
      const rows = agentId
        ? await sql`SELECT * FROM handoffs WHERE org_id = ${orgId} AND agent_id = ${agentId} ORDER BY created_at DESC LIMIT 1`
        : await sql`SELECT * FROM handoffs WHERE org_id = ${orgId} ORDER BY created_at DESC LIMIT 1`;
      return NextResponse.json({ handoff: rows[0] || null });
    }

    let rows;
    if (agentId && date) {
      rows = await sql`SELECT * FROM handoffs WHERE org_id = ${orgId} AND agent_id = ${agentId} AND session_date = ${date} ORDER BY created_at DESC LIMIT ${limit}`;
    } else if (agentId) {
      rows = await sql`SELECT * FROM handoffs WHERE org_id = ${orgId} AND agent_id = ${agentId} ORDER BY created_at DESC LIMIT ${limit}`;
    } else if (date) {
      rows = await sql`SELECT * FROM handoffs WHERE org_id = ${orgId} AND session_date = ${date} ORDER BY created_at DESC LIMIT ${limit}`;
    } else {
      rows = await sql`SELECT * FROM handoffs WHERE org_id = ${orgId} ORDER BY created_at DESC LIMIT ${limit}`;
    }

    return NextResponse.json({ handoffs: rows, total: rows.length });
  } catch (error) {
    console.error('Handoffs GET error:', error);
    return NextResponse.json({ error: 'An error occurred while fetching handoffs' }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const body = await request.json();

    const { ok, errors: fieldErrors } = enforceFieldLimits(body, { summary: 5000, mood_notes: 2000, session_date: 50 });
    if (!ok) {
      return NextResponse.json({ error: 'Validation failed', details: fieldErrors }, { status: 400 });
    }

    const { agent_id, summary: summaryRaw, session_date, key_decisions, open_tasks, mood_notes: moodRaw, next_priorities } = body;

    if (!summaryRaw) {
      return NextResponse.json({ error: 'summary is required' }, { status: 400 });
    }

    // SECURITY: Scan for sensitive data (API keys, etc.)
    const { redacted: summary } = scanSensitiveData(summaryRaw);
    const { redacted: mood_notes } = scanSensitiveData(moodRaw || '');

    if (!agent_id) {
      return NextResponse.json({ error: 'agent_id is required' }, { status: 400 });
    }

    const id = `ho_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
    const now = new Date().toISOString();
    const dateStr = session_date || now.split('T')[0];

    const result = await sql`
      INSERT INTO handoffs (id, org_id, agent_id, session_date, summary, key_decisions, open_tasks, mood_notes, next_priorities, created_at)
      VALUES (
        ${id}, ${orgId}, ${agent_id}, ${dateStr}, ${summary},
        ${key_decisions ? JSON.stringify(key_decisions) : null},
        ${open_tasks ? JSON.stringify(open_tasks) : null},
        ${mood_notes || null},
        ${next_priorities ? JSON.stringify(next_priorities) : null},
        ${now}
      )
      RETURNING *
    `;

    return NextResponse.json({ handoff: result[0], handoff_id: id }, { status: 201 });
  } catch (error) {
    console.error('Handoffs POST error:', error);
    return NextResponse.json({ error: 'An error occurred while creating handoff' }, { status: 500 });
  }
}
