export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db';
import { getOrgId, getUserId } from '../../../lib/org';
import { apiErrorResponse } from '../../../lib/apiErrors';
import { computePosturePayload, redactFindingAttribution } from '../../../lib/posture/signals';
import { FINDING_STATUSES } from '../../../lib/repositories/posture.repository';
import type { PostureFinding } from '../../../lib/posture/types';

const DIMENSIONS = ['identity', 'enforcement', 'spend', 'auditability', 'approval', 'data_protection'];

// Statuses that drop out of the actionable queue: resolved (done) or in the
// risk-accepted ledger (snoozed / accepted_risk). `open` + `drafted` stay — a
// draft awaits human activation, so it is still actionable.
const CLOSED_STATUSES = new Set<PostureFinding['status']>(['resolved', 'snoozed', 'accepted_risk']);
const LEDGER_STATUSES = new Set<PostureFinding['status']>(['snoozed', 'accepted_risk']);

function countByStatus(findings: PostureFinding[]): Record<string, number> {
  const counts: Record<string, number> = {
    open: 0, drafted: 0, resolved: 0, snoozed: 0, accepted_risk: 0, total: findings.length,
  };
  for (const f of findings) {
    if (f.status in counts) counts[f.status] = (counts[f.status] ?? 0) + 1;
  }
  return counts;
}

/**
 * GET /api/posture/findings
 *
 * The prioritized remediation queue. By default returns the actionable queue
 * (open + drafted, ordered by scoreDelta desc — already sorted by the engine).
 *
 * Filters:
 *   ?status=<status>      exact-match one of open|drafted|resolved|snoozed|accepted_risk
 *   ?dimension=<dim>      one of the six posture dimensions
 *
 * Always returns the `riskAccepted` ledger (snoozed + accepted_risk) and a
 * per-status `counts` summary so the operator surface can render both the queue
 * and the audit ledger from a single fetch.
 */
export async function GET(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const dimension = searchParams.get('dimension');

    if (status && !(FINDING_STATUSES as readonly string[]).includes(status)) {
      return NextResponse.json(
        { error: `Invalid status. Must be one of: ${FINDING_STATUSES.join(', ')}` },
        { status: 400 },
      );
    }
    if (dimension && !DIMENSIONS.includes(dimension)) {
      return NextResponse.json(
        { error: `Invalid dimension. Must be one of: ${DIMENSIONS.join(', ')}` },
        { status: 400 },
      );
    }

    const payload = await computePosturePayload(sql, orgId);
    // Attribution (actor/note) is for human sessions only — see /api/posture.
    const findings = getUserId(request)
      ? payload.findings
      : redactFindingAttribution(payload.findings);

    // Status filter: exact match when given, otherwise the actionable queue.
    let queue = status
      ? findings.filter((f) => f.status === status)
      : findings.filter((f) => !CLOSED_STATUSES.has(f.status));
    if (dimension) {
      queue = queue.filter((f) => f.dimension === dimension);
    }

    const riskAccepted = findings.filter((f) => LEDGER_STATUSES.has(f.status));

    return NextResponse.json({
      findings: queue,
      riskAccepted,
      counts: countByStatus(findings),
    });
  } catch (error) {
    return apiErrorResponse(error, 'POSTURE FINDINGS GET');
  }
}
