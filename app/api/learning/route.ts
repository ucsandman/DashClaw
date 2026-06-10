export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../lib/db';
import { getOrgId } from '../../lib/org';
import { enforceFieldLimits } from '../../lib/validate.js';
import { EVENTS, publishOrgEvent } from '../../lib/events';
import { listDecisions } from '../../lib/repositories/learning.repository';

// sql initialized inside handler for serverless compatibility

export async function GET(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { searchParams } = new URL(request.url);
    const agentId = searchParams.get('agent_id');
    const q = searchParams.get('q');
    const limit = searchParams.get('limit');

    const isMissingTable = (err: unknown) =>
      String((err as { code?: string })?.code || '').includes('42P01') || String((err as Error)?.message || '').includes('does not exist');

    // Get decisions (optionally filtered by agent and search text). We use
    // decisions.outcome directly; the outcomes table is optional. SQL lives in
    // the learning repository so server-side search stays off the route's
    // direct-SQL budget.
    let decisions: any[] = [];
    try {
      decisions = await listDecisions(sql, orgId, { agentId, q, limit: limit ?? undefined });
    } catch (err) {
      if (!isMissingTable(err)) throw err;
      decisions = [];
    }

    // Get lessons (optional table in some installs)
    let lessons: any[] = [];
    try {
      lessons = await sql`SELECT * FROM lessons WHERE org_id = ${orgId} ORDER BY confidence DESC`;
    } catch (err) {
      if (!isMissingTable(err)) throw err;
      lessons = [];
    }

    // Calculate stats
    const successCount = decisions.filter(d => d.outcome === 'success').length;
    const totalWithOutcome = decisions.filter(d => d.outcome && d.outcome !== 'pending').length;
    const successRate = totalWithOutcome > 0 ? Math.round((successCount / totalWithOutcome) * 100) : 0;

    const stats = {
      totalDecisions: decisions.length,
      totalLessons: lessons.length,
      successRate,
      patterns: lessons.filter(l => l.confidence >= 80).length
    };

    return NextResponse.json({
      decisions,
      lessons,
      stats,
      lastUpdated: new Date().toISOString()
    });
  } catch (error) {
    // SECURITY: Log detailed error server-side, return generic message to client
    console.error('Learning API error:', error);
    return NextResponse.json({ error: 'An error occurred while fetching learning data', decisions: [], lessons: [], stats: {} }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const body = await request.json();

    const { ok, errors: fieldErrors } = enforceFieldLimits(body, { decision: 2000, context: 5000, reasoning: 5000, outcome: 200 });
    if (!ok) {
      return NextResponse.json({ error: 'Validation failed', details: fieldErrors }, { status: 400 });
    }

    const { decision, context, reasoning, outcome, confidence, agent_id } = body;

    if (!decision) {
      return NextResponse.json({ error: 'decision is required' }, { status: 400 });
    }

    const result = await sql`
      INSERT INTO decisions (org_id, decision, context, reasoning, outcome, confidence, timestamp, agent_id)
      VALUES (
        ${orgId},
        ${decision},
        ${context || null},
        ${reasoning || null},
        ${outcome || 'pending'},
        ${confidence || 50},
        ${new Date().toISOString()},
        ${agent_id || null}
      )
      RETURNING *
    `;

    void publishOrgEvent(EVENTS.DECISION_CREATED, {
      orgId,
      decision: result[0]
    });

    return NextResponse.json({ decision: result[0] }, { status: 201 });
  } catch (error) {
    console.error('Learning API POST error:', error);
    return NextResponse.json({ error: 'An error occurred while recording the decision' }, { status: 500 });
  }
}
