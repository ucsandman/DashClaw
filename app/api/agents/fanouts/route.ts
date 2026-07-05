export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db';
import { getOrgId } from '../../../lib/org';
import { apiErrorResponse } from '../../../lib/apiErrors';
import { getRecentFanouts } from '../../../lib/repositories/fanouts.repository';

// v4.3 fleet attribution (docs/superpowers/specs/2026-07-04-fleet-attribution.md,
// verdict 5). GET the recent multi-agent harness sessions the /agents Fan-outs
// panel renders. Repository-only (no direct SQL); authed via the shared org
// boundary like GET /api/coverage.

export async function GET(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { searchParams } = new URL(request.url);

    const rawWindow = parseInt(searchParams.get('window_hours') || '', 10);
    const windowHours = Number.isFinite(rawWindow) ? Math.max(1, Math.min(rawWindow, 168)) : 24;
    const rawLimit = parseInt(searchParams.get('limit') || '', 10);
    const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(rawLimit, 100)) : 20;
    // Ephemeral diagnostic view (U2/V2 precedent): smoke proves the grouping
    // and lineage-join math with synthetic agents; nothing persisted, the
    // /agents panel never sets it.
    const includeSynthetic = searchParams.get('include_synthetic') === '1';

    const fanouts = await getRecentFanouts(sql, orgId, { windowHours, limit, includeSynthetic });

    return NextResponse.json({
      fanouts,
      window_hours: windowHours,
      ...(includeSynthetic ? { synthetic_included: true } : {}),
      lastUpdated: new Date().toISOString(),
    });
  } catch (error) {
    return apiErrorResponse(error, 'AGENTS_FANOUTS_GET');
  }
}
