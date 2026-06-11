export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db';
import { getOrgId } from '../../../lib/org';
import { apiErrorResponse } from '../../../lib/apiErrors';
import { claimNextWorkOrder } from '../../../lib/repositories/work-orders.repository';
import { runWorkOrderSweeps } from '../../../lib/work-orders/sweeps';

export async function POST(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
    }
    const agentId = typeof body.agent_id === 'string' ? body.agent_id : '';
    if (!agentId) {
      return NextResponse.json({ error: 'validation_failed', details: [{ field: 'agent_id', message: 'required field missing', code: 'required' }] }, { status: 400 });
    }
    const types = Array.isArray(body.types) ? body.types.filter((t): t is string => typeof t === 'string') : null;
    await runWorkOrderSweeps(sql, orgId);
    const order = await claimNextWorkOrder(sql, orgId, agentId, types);
    return NextResponse.json({ work_order: order }); // null when nothing queued
  } catch (error) {
    return apiErrorResponse(error, 'WORK_ORDERS_CLAIM');
  }
}
