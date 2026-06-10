export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../../lib/db';
import { getOrgId } from '../../../../lib/org';
import {
  getRegisteredAgent,
  updateRegisteredAgent,
  listAgentCapabilities,
  listInvocations,
} from '../../../../lib/repositories/registered-agents.repository';

/** GET /api/agents/registry/[id] — registered agent detail with capabilities + invocation history (org-scoped). */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const orgId = getOrgId(request);
    const sql = await getSql();
    const agent = await getRegisteredAgent(sql, orgId, id);
    if (!agent) {
      return NextResponse.json({ error: 'Registered agent not found' }, { status: 404 });
    }
    const [capabilities, invocations] = await Promise.all([
      listAgentCapabilities(sql, orgId, id),
      listInvocations(sql, orgId, id, { limit: 20 }),
    ]);
    return NextResponse.json({ registered_agent: agent, capabilities, invocations });
  } catch (err) {
    console.error('[AGENTS/REGISTRY/:id] GET error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** PATCH /api/agents/registry/[id] — update a registered agent. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const orgId = getOrgId(request);
    const sql = await getSql();
    const body = await request.json().catch(() => ({}));
    const updated = await updateRegisteredAgent(sql, orgId, id, body);
    if (!updated) {
      return NextResponse.json({ error: 'Registered agent not found' }, { status: 404 });
    }
    return NextResponse.json({ registered_agent: updated });
  } catch (err) {
    console.error('[AGENTS/REGISTRY/:id] PATCH error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
