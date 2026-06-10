export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db';
import { getOrgId } from '../../../lib/org';
import { consolidateLessons } from '../../../lib/learning-lessons';

export async function GET(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { searchParams } = new URL(request.url);
    const agentId = searchParams.get('agent_id');
    const actionType = searchParams.get('action_type');
    const limit = parseInt(searchParams.get('limit') || '10', 10);

    const result = await consolidateLessons(sql, orgId, { agentId, actionType, limit });
    return NextResponse.json(result);
  } catch (err) {
    console.error('[learning/lessons] GET error:', (err as Error).message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
