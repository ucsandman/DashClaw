export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getSql } from '../../../../lib/db';
import { getOrgId } from '../../../../lib/org';
import { apiErrorResponse } from '../../../../lib/apiErrors';
import { listAccessRules, createAccessRule } from '../../../../lib/repositories/capability-access.repository';

export async function GET(request: Request, { params }: { params: Promise<{ capabilityId: string }> }) {
  try {
    const { capabilityId } = await params;
    const sql = getSql();
    const orgId = getOrgId(request);
    const result = await listAccessRules(sql, orgId, capabilityId);
    return NextResponse.json(result);
  } catch (error) {
    return apiErrorResponse(error, 'CAPABILITY_ACCESS_LIST');
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ capabilityId: string }> }) {
  try {
    const { capabilityId } = await params;
    const sql = getSql();
    const orgId = getOrgId(request);
    const body = await request.json();

    if (!body.access) {
      return NextResponse.json({ error: 'access level is required' }, { status: 400 });
    }

    const rule = await createAccessRule(sql, orgId, {
      capability_id: capabilityId,
      agent_id: body.agent_id || null,
      access: body.access,
      reason: body.reason || null,
      created_by: request.headers.get('x-user-id') || null,
    });

    return NextResponse.json({ rule }, { status: 201 });
  } catch (error) {
    const message = (error as Error).message;
    if (message?.includes('already exists') || message?.includes('Invalid access')) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    return apiErrorResponse(error, 'CAPABILITY_ACCESS_CREATE');
  }
}
