export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../lib/db';
import { getOrgId } from '../../lib/org';
import { apiErrorResponse } from '../../lib/apiErrors';
import { computePosturePayload } from '../../lib/posture/signals';
import { listPostureSnapshots } from '../../lib/repositories/posture.repository';

/**
 * GET /api/posture
 *
 * Returns the org's current governance posture score, per-dimension breakdown,
 * prioritized remediation findings, a summary counts object, and the recent
 * snapshot trend (newest first) for the on-page sparkline. snapshotTs is the
 * timestamp of the latest persisted scan, or null if none exists yet.
 */
export async function GET(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);

    const [{ score, findings, unitCount }, snapshots] = await Promise.all([
      computePosturePayload(sql, orgId),
      listPostureSnapshots(sql, orgId, 30),
    ]);

    const openFindings = findings.filter((f) => f.status === 'open').length;
    const pointsRecoverable = findings.reduce((s, f) => s + f.scoreDelta, 0);

    return NextResponse.json({
      score: score.score,
      status: score.status,
      cappedBy: score.cappedBy,
      dimensions: score.dimensions,
      findings,
      summary: {
        totalUnits: unitCount,
        coveredUnits: unitCount - openFindings,
        pointsRecoverable,
        openFindings,
      },
      // Trend for the sparkline — newest first; oldest-first is the UI's concern.
      snapshots: snapshots.map((s) => ({ score: s.score, createdAt: s.createdAt })),
      snapshotTs: snapshots[0]?.createdAt ?? null,
    });
  } catch (error) {
    return apiErrorResponse(error, 'POSTURE GET');
  }
}
