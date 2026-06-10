export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db';
import { getOrgId } from '../../../lib/org';
import { getCostAggregation } from '../../../lib/repositories/actions.repository';

export async function GET(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { searchParams } = new URL(request.url);
    const period = searchParams.get('period') || '30d';
    const agentId = searchParams.get('agent_id') || null;

    const validPeriods = ['7d', '30d', '90d'];
    if (!validPeriods.includes(period)) {
      return NextResponse.json({ error: `Invalid period. Use: ${validPeriods.join(', ')}` }, { status: 400 });
    }

    const data = await getCostAggregation(sql, orgId, { period, agentId });
    return NextResponse.json(data);
  } catch (error) {
    console.error('[ACTIONS/COSTS] GET error:', error);
    return NextResponse.json({ error: 'Failed to fetch cost data' }, { status: 500 });
  }
}
