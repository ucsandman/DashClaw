export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../../lib/db';
import { getOrgId } from '../../../../lib/org';
import { getRoutingStats } from '../../../../lib/repositories/routing.repository';

/**
 * GET /api/routing/stats — Router statistics
 */
export async function GET(request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);

    const stats = await getRoutingStats(sql, orgId);
    return NextResponse.json(stats);
  } catch (err) {
    console.error('[ROUTING/STATS] GET error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
