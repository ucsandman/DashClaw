export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../lib/db';
import { getOrgId, getUserId } from '../../lib/org';
import { apiErrorResponse } from '../../lib/apiErrors';
import { computePosturePayload, redactFindingAttribution } from '../../lib/posture/signals';
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

    const [payload, snapshots] = await Promise.all([
      computePosturePayload(sql, orgId),
      listPostureSnapshots(sql, orgId, 30),
    ]);
    const { score, unitCount, coveredUnits } = payload;

    // Operator attribution (who quieted a finding, and why) is for humans on
    // the review surface — middleware sets x-user-id only on session auth.
    // Key-authenticated callers get the timestamps, not the identity.
    const isHumanSession = Boolean(getUserId(request));
    const findings = isHumanSession ? payload.findings : redactFindingAttribution(payload.findings);

    const openFindings = findings.filter((f) => f.status === 'open').length;
    // Recoverable = open findings only: an accepted/resolved finding's delta
    // was judged, not left on the table (v3.1).
    const pointsRecoverable = findings
      .filter((f) => f.status === 'open')
      .reduce((s, f) => s + f.scoreDelta, 0);
    const accepted = findings.filter((f) => f.status === 'accepted_risk');
    const lastAccepted = accepted
      .map((f) => f.statusMeta)
      .filter((m): m is NonNullable<typeof m> => Boolean(m?.updatedAt))
      .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))[0] ?? null;

    return NextResponse.json({
      score: score.score,
      status: score.status,
      cappedBy: score.cappedBy,
      dimensions: score.dimensions,
      findings,
      summary: {
        totalUnits: unitCount,
        // Counted from coverage grades in the engine — never negative (v3.1;
        // the old `unitCount - openFindings` read -22 on the live instance).
        coveredUnits,
        pointsRecoverable,
        openFindings,
        acceptedRisk: {
          count: accepted.length,
          lastActor: lastAccepted?.actor ?? null,
          lastAt: lastAccepted?.updatedAt ?? null,
        },
      },
      // Trend for the sparkline — newest first; oldest-first is the UI's concern.
      snapshots: snapshots.map((s) => ({ score: s.score, createdAt: s.createdAt })),
      snapshotTs: snapshots[0]?.createdAt ?? null,
    });
  } catch (error) {
    return apiErrorResponse(error, 'POSTURE GET');
  }
}
