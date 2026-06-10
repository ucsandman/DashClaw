export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../../../lib/db';
import { getOrgId } from '../../../../../lib/org';
import { getAgent, updateAgentStatus, unregisterAgent } from '../../../../../lib/repositories/routing.repository';

/**
 * GET /api/routing/agents/:agentId — Get agent details
 */
export async function GET(request, { params }) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { agentId } = await params;

    const agent = await getAgent(sql, orgId, agentId);
    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    return NextResponse.json({ agent });
  } catch (err) {
    console.error('[ROUTING/AGENTS/:id] GET error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * PATCH /api/routing/agents/:agentId — Update agent status
 * Body: { status: 'available' | 'busy' | 'offline' }
 */
export async function PATCH(request, { params }) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { agentId } = await params;
    const body = await request.json();

    if (!body.status) {
      return NextResponse.json({ error: 'status is required' }, { status: 400 });
    }

    const validStatuses = ['available', 'busy', 'offline'];
    if (!validStatuses.includes(body.status)) {
      return NextResponse.json({ error: `status must be one of: ${validStatuses.join(', ')}` }, { status: 400 });
    }

    const agent = await updateAgentStatus(sql, orgId, agentId, body.status);
    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    return NextResponse.json({ agent });
  } catch (err) {
    console.error('[ROUTING/AGENTS/:id] PATCH error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * DELETE /api/routing/agents/:agentId — Unregister agent
 */
export async function DELETE(request, { params }) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { agentId } = await params;

    const agent = await unregisterAgent(sql, orgId, agentId);
    if (!agent) {
      return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
    }

    return NextResponse.json({ deleted: true, agent });
  } catch (err) {
    console.error('[ROUTING/AGENTS/:id] DELETE error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
