export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db';
import { getOrgId } from '../../../lib/org';
import {
  ensureConnectionsTable,
  listConnections,
  upsertConnections
} from '../../../lib/repositories/connections.repository';

export async function GET(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);

    await ensureConnectionsTable(sql);

    const url = new URL(request.url);
    const agentId = url.searchParams.get('agent_id');
    const provider = url.searchParams.get('provider');

    const connections = await listConnections(sql, orgId, { agentId, provider });

    return NextResponse.json({
      connections: connections || [],
      total: connections?.length || 0
    });
  } catch (error) {
    console.error('Agent connections GET error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch agent connections' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const body = await request.json();

    const { agent_id, connections } = body;

    await ensureConnectionsTable(sql);

    const { results, errors } = await upsertConnections(sql, orgId, agent_id, connections);

    return NextResponse.json({
      connections: results,
      errors: errors.length > 0 ? errors : undefined,
      created: results.length
    });
  } catch (error) {
    console.error('Agent connections POST error:', error);
    return NextResponse.json(
      { error: (error as Error).message || 'Failed to save agent connections' },
      { status: 400 }
    );
  }
}
