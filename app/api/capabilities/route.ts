export const dynamic = 'force-dynamic';
export const revalidate = 0;

// v5 cull (Wave 13): the capability REGISTRY product is retired; the only
// surviving surface is the enforcement seam. This GET is the read source that
// backs `dashclaw_capabilities_list` discovery and `dashclaw_invoke`. There is
// no in-product create/edit path post-cull — the seam is inert by default and
// operators seed capability rows directly via SQL (see THESIS.md residue note).

import { NextResponse } from 'next/server';
import { getSql } from '../../lib/db';
import { getOrgId } from '../../lib/org';
import { apiErrorResponse } from '../../lib/apiErrors';
import { listCapabilities } from '../../lib/repositories/capabilities.repository';

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
