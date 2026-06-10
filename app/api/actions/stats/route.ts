export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db';
import { getOrgId } from '../../../lib/org';
import { getActionStats } from '../../../lib/repositories/actions.repository';

/**
 * GET /api/actions/stats
 *
 * Returns decision throughput statistics for the last 24 hours.
 * DashClaw adheres to a strict governance boundary; metrics related to
 * agent actions live within the actions namespace.
 */
export async function GET(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const agentId = (request as Request & { nextUrl: URL }).nextUrl.searchParams.get('agent_id') || null;

    const { current, previousTotal } = await getActionStats(sql, orgId, agentId);
    const previousTotalNum = Number(previousTotal);
    const currentTotalNum = Number((current as Record<string, unknown>).total);

    // Calculate change percent
    let change_percent = 0;
    if (previousTotalNum > 0) {
      change_percent = Math.round(((currentTotalNum - previousTotalNum) / previousTotalNum) * 100);
    } else if (currentTotalNum > 0) {
      change_percent = 100;
    }

    return NextResponse.json({
      ...current,
      change_percent,
      lastUpdated: new Date().toISOString()
    });
  } catch (error) {
    console.error('Actions Stats API GET error:', error);
    return NextResponse.json(
      {
        error: 'An error occurred while fetching action statistics',
        total: 0,
        completed: 0,
        failed: 0,
        cancelled: 0,
        approval: 0,
        change_percent: 0
      },
      { status: 500 }
    );
  }
}
