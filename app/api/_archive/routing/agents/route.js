export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../../lib/db';
import { getOrgId } from '../../../../lib/org';
import { registerAgent, listAgents } from '../../../../lib/repositories/routing.repository';

/**
 * GET /api/routing/agents?status=available — List registered routing agents
 */
export async function GET(request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') || undefined;

    const agents = await listAgents(sql, orgId, status);
    return NextResponse.json({ agents });
  } catch (err) {
    console.error('[ROUTING/AGENTS] GET error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/routing/agents — Register a new routing agent
 * Body: { name, capabilities, maxConcurrent, endpoint }
 */
export async function POST(request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const body = await request.json();

    if (!body.name) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }

    // Validate endpoint URL for SSRF protection
    if (body.endpoint) {
      try {
        const parsed = new URL(body.endpoint);
        if (parsed.protocol !== 'https:') {
          return NextResponse.json({ error: 'Agent endpoint must use HTTPS' }, { status: 400 });
        }
        if (parsed.username || parsed.password) {
          return NextResponse.json({ error: 'Agent endpoint must not include credentials' }, { status: 400 });
        }
      } catch {
        return NextResponse.json({ error: 'Agent endpoint must be a valid URL' }, { status: 400 });
      }
    }

    // Validate maxConcurrent
    if (body.maxConcurrent !== undefined) {
      const mc = Number(body.maxConcurrent);
      if (!Number.isFinite(mc) || mc < 1 || mc > 100) {
        return NextResponse.json({ error: 'maxConcurrent must be between 1 and 100' }, { status: 400 });
      }
    }

    // Validate capabilities
    if (body.capabilities !== undefined) {
      if (!Array.isArray(body.capabilities) || body.capabilities.length > 50) {
        return NextResponse.json({ error: 'capabilities must be an array with at most 50 items' }, { status: 400 });
      }
    }

    const agent = await registerAgent(sql, orgId, body);
    return NextResponse.json({ agent }, { status: 201 });
  } catch (err) {
    console.error('[ROUTING/AGENTS] POST error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
