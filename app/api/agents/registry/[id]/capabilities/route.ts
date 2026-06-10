export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../../../lib/db';
import { getOrgId } from '../../../../../lib/org';
import {
  getRegisteredAgent,
  addAgentCapability,
  listAgentCapabilities,
} from '../../../../../lib/repositories/registered-agents.repository';

/** GET /api/agents/registry/[id]/capabilities — capabilities grouped under the agent. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const orgId = getOrgId(request);
    const sql = await getSql();
    if (!(await getRegisteredAgent(sql, orgId, id))) {
      return NextResponse.json({ error: 'Registered agent not found' }, { status: 404 });
    }
    const capabilities = await listAgentCapabilities(sql, orgId, id);
    return NextResponse.json({ capabilities });
  } catch (err) {
    console.error('[AGENTS/REGISTRY/:id/capabilities] GET error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** POST /api/agents/registry/[id]/capabilities — group a capability under the agent. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const orgId = getOrgId(request);
    const sql = await getSql();
    const body = await request.json().catch(() => ({}));
    if (!body?.capability_id) {
      return NextResponse.json({ error: 'capability_id is required' }, { status: 400 });
    }
    if (!(await getRegisteredAgent(sql, orgId, id))) {
      return NextResponse.json({ error: 'Registered agent not found' }, { status: 404 });
    }
    await addAgentCapability(sql, orgId, id, body.capability_id);
    const capabilities = await listAgentCapabilities(sql, orgId, id);
    return NextResponse.json({ capabilities }, { status: 201 });
  } catch (err) {
    console.error('[AGENTS/REGISTRY/:id/capabilities] POST error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
