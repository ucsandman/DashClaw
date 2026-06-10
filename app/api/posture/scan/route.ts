export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db';
import { getOrgId } from '../../../lib/org';
import { apiErrorResponse } from '../../../lib/apiErrors';
import { computePosturePayload } from '../../../lib/posture/signals';
import { insertPostureSnapshot } from '../../../lib/repositories/posture.repository';

/**
 * POST /api/posture/scan
 *
 * Recompute the posture score and persist a trend snapshot. This is the only
 * place a posture_snapshots row is written — free-tier design: compute on
 * demand (GET), snapshot on explicit scan, no cron. Returns the freshly
 * computed score plus the persisted snapshot.
 */
export async function POST(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);

    const { score, findings, unitCount } = await computePosturePayload(sql, orgId);
    const snapshot = await insertPostureSnapshot(sql, orgId, score.score, score.dimensions);

    const openFindings = findings.filter((f) => f.status === 'open' || f.status === 'drafted').length;

    return NextResponse.json({
      score: score.score,
      status: score.status,
      dimensions: score.dimensions,
      cappedBy: score.cappedBy,
      snapshot,
      summary: { totalUnits: unitCount, openFindings },
    });
  } catch (error) {
    return apiErrorResponse(error, 'POSTURE SCAN');
  }
}
