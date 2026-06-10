export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db';
import { getOrgId } from '../../../lib/org';
import { listReputationSnapshots, snapshotToVector } from '../../../lib/repositories/reputation.repository';

/**
 * GET /api/reputation/leaderboard — top agents by reliability in the org,
 * from stored snapshots. Org-scoped, no cross-org access.
 */
export async function GET(request: Request) {
  try {
    const orgId = getOrgId(request);
    const sql = await getSql();
    const { searchParams } = new URL(request.url);
    const limit = Number(searchParams.get('limit')) || 20;

    const rows = await listReputationSnapshots(sql, orgId, { limit });
    return NextResponse.json({ leaderboard: rows.map(snapshotToVector) });
  } catch (err) {
    console.error('[REPUTATION/LEADERBOARD] GET error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
