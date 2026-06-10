export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../../lib/db';
import { getOrgId } from '../../../../lib/org';
import { apiErrorResponse } from '../../../../lib/apiErrors';
import { getCapability } from '../../../../lib/repositories/capabilities.repository';
import { getCapabilityHistory } from '../../../../lib/capability-history';

export async function GET(request: Request, { params }: { params: Promise<{ capabilityId: string }> }) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { capabilityId } = await params;
    const { searchParams } = new URL(request.url);

    const capability = await getCapability(sql, orgId, capabilityId);
    if (!capability) {
      return NextResponse.json({ error: 'Capability not found' }, { status: 404 });
    }

    // DB row matches the CapabilityRef shape at runtime; bridge the loose
    // Record<string, unknown> via unknown (values are typed unknown, not string).
    const capabilityRef = capability as unknown as { capability_id: string; name: string; slug: string };
    const history = await getCapabilityHistory(sql, orgId, capabilityRef, {
      action_type: searchParams.get('action_type') || undefined,
      status: searchParams.get('status') || undefined,
      limit: searchParams.get('limit') || 20,
      offset: searchParams.get('offset') || 0,
    });

    return NextResponse.json(history);
  } catch (error) {
    return apiErrorResponse(error, 'CAPABILITY_HISTORY');
  }
}
