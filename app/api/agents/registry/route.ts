export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db';
import { getOrgId } from '../../../lib/org';
import { createRegisteredAgent, listRegisteredAgents } from '../../../lib/repositories/registered-agents.repository';

/** GET /api/agents/registry — list registered agents (org-scoped). */
export async function GET(request: Request) {
  try {
    const orgId = getOrgId(request);
    const sql = await getSql();
    const status = new URL(request.url).searchParams.get('status') || undefined;
    const agents = await listRegisteredAgents(sql, orgId, { status });
    return NextResponse.json({ registered_agents: agents });
  } catch (err) {
    console.error('[AGENTS/REGISTRY] GET error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** POST /api/agents/registry — register a new external provider. */
export async function POST(request: Request) {
  try {
    const orgId = getOrgId(request);
    const sql = await getSql();
    const body = await request.json().catch(() => ({}));
    if (!body?.name) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }
    const agent = await createRegisteredAgent(sql, orgId, body);
    return NextResponse.json({ registered_agent: agent }, { status: 201 });
  } catch (err) {
    console.error('[AGENTS/REGISTRY] POST error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
