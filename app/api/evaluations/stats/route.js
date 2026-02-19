export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db.js';
import { getOrgId } from '../../../lib/org.js';
import { getEvalStats } from '../../../lib/repositories/evaluations.repository.js';

/**
 * GET /api/evaluations/stats   Aggregate evaluation statistics
 * Query: ?agent_id, ?scorer_name, ?days (default 30)
 */
export async function GET(request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { searchParams } = new URL(request.url);

    const agentId = searchParams.get('agent_id');
    const scorerName = searchParams.get('scorer_name');
    const days = parseInt(searchParams.get('days') || '30', 10);

    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const stats = await getEvalStats(sql, orgId, { agentId, scorerName, cutoff });

    return NextResponse.json(stats);
  } catch (error) {
    console.error('Eval stats error:', error);
    return NextResponse.json({ error: 'Failed to fetch eval stats' }, { status: 500 });
  }
}
