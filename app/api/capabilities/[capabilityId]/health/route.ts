export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../../lib/db';
import { getOrgId } from '../../../../lib/org';
import { apiErrorResponse } from '../../../../lib/apiErrors';
import { getCapability } from '../../../../lib/repositories/capabilities.repository';
import { getCapabilityWithHealth } from '../../../../lib/capability-health';

export async function GET(request: Request, { params }: { params: Promise<{ capabilityId: string }> }) {
  try {
    const { capabilityId } = await params;
    const sql = getSql();
    const orgId = getOrgId(request);

    const capability = await getCapability(sql, orgId, capabilityId);
    if (!capability) {
      return NextResponse.json({ error: 'Capability not found' }, { status: 404 });
    }

    // getCapability returns a Record<string,unknown> DB row that matches the
    // Capability shape at runtime.
    const health = await getCapabilityWithHealth(sql, orgId, capability as Parameters<typeof getCapabilityWithHealth>[2]);
    return NextResponse.json(health);
  } catch (error) {
    return apiErrorResponse(error, 'CAPABILITY_HEALTH');
  }
}
