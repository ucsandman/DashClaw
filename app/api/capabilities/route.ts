export const dynamic = 'force-dynamic';
export const revalidate = 0;

// v5 cull (Wave 13): the capability REGISTRY product is retired; the only
// surviving surface is the enforcement seam. This GET is the read source that
// backs `dashclaw_capabilities_list` discovery and `dashclaw_invoke`. There is
// no in-product create/edit path post-cull — the seam is inert by default and
// operators seed capability rows directly via SQL (see THESIS.md residue note).
//
// 2026-09-04 spend incident: restoring a single write path here. An http_api
// capability is now the credential-custody seam for purchases (DashClaw holds
// the registrar token, the agent never does), and operators need a way to
// register one that isn't raw SQL. Only POST comes back — no pages, no
// update/delete/health; those stay retired.

import { NextResponse } from 'next/server';
import { getSql } from '../../lib/db';
import { getOrgId, getOrgRole, getUserId } from '../../lib/org';
import { apiErrorResponse } from '../../lib/apiErrors';
import { logActivity } from '../../lib/audit';
import { listCapabilities, createCapability } from '../../lib/repositories/capabilities.repository';

export async function GET(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { searchParams } = new URL(request.url);

    const category = searchParams.get('category') || undefined;
    const risk_level = searchParams.get('risk_level') || undefined;
    const search = searchParams.get('search') || undefined;
    const limit = searchParams.get('limit') || 100;
    const offset = searchParams.get('offset') || 0;

    const capabilities = await listCapabilities(sql, orgId, {
      category,
      risk_level,
      search,
      limit,
      offset,
    });
    return NextResponse.json({ capabilities });
  } catch (error) {
    return apiErrorResponse(error, 'CAPABILITIES GET');
  }
}

// POST - Register a capability (admin only). Same admin gate as
// /api/settings POST — this seam now custodies the registrar credential for
// spend-capable capabilities, so writes are not open to any API-key holder.
export async function POST(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);

    if (getOrgRole(request) !== 'admin') {
      return NextResponse.json({ error: 'Admin access required to register capabilities' }, { status: 403 });
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Malformed JSON body' }, { status: 400 });
    }

    if (!body?.name || typeof body.name !== 'string') {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }

    let capability;
    try {
      capability = await createCapability(sql, orgId, body);
    } catch (error) {
      const message = (error as Error).message;
      const code = (error as { code?: string }).code;

      if (code === '23505' || message?.includes('duplicate key')) {
        return NextResponse.json(
          { error: 'capability_exists', slug: (body.slug as string) || (body.name as string) },
          { status: 409 },
        );
      }

      if (code === 'capability_contract_invalid' || message?.includes('must be') || message?.includes('is required')) {
        return NextResponse.json({ error: message }, { status: 400 });
      }

      throw error;
    }

    logActivity({
      orgId, actorId: getUserId(request) || 'unknown', action: 'capability.created',
      resourceType: 'capability', resourceId: (capability as Record<string, unknown> | null)?.capability_id as string | undefined,
      request,
    }, sql);

    return NextResponse.json({ success: true, capability }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error, 'CAPABILITY_CREATE');
  }
}
