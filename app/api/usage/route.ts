export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../lib/db';
import { getOrgId } from '../../lib/org';
import { getUsageSummary, getUsageHistory } from '../../lib/repositories/usage.repository';

// GET /api/usage — read-only, caller-org-scoped metering report (G4).
// Current-period governed actions + seats, plus up to 12 months of history.
// Measurement only: nothing here (or anywhere) enforces off these numbers.
export async function GET(request: Request) {
  try {
    const orgId = getOrgId(request);
    const sql = getSql();
    const [summary, history] = await Promise.all([
      getUsageSummary(sql, orgId),
      getUsageHistory(sql, orgId, 12),
    ]);
    return NextResponse.json({
      org_id: orgId,
      ...summary,
      history,
      lastUpdated: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Usage API GET error:', error);
    return NextResponse.json({ error: 'Failed to fetch usage' }, { status: 500 });
  }
}
