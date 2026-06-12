export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getOrgId } from '../../../lib/org';
import { getSql } from '../../../lib/db';
import { apiErrorResponse } from '../../../lib/apiErrors';
import { evaluateApprovalFlood, getInterruptBudget, FLEET_KEY } from '../../../lib/approval-flood';
import { getPolicyNamesByIds } from '../../../lib/repositories/guardrails.repository';

/**
 * GET /api/approvals/floods — current interruption-budget (approval flood)
 * state. Re-evaluates on read so banners stay fresh without a scheduler.
 */
export async function GET(request: Request) {
  try {
    const orgId = getOrgId(request);
    const sql = getSql();
    const [evaluation, budget] = await Promise.all([
      evaluateApprovalFlood(sql, orgId),
      getInterruptBudget(sql, orgId),
    ]);
    const policyIds = Object.keys(evaluation.state).filter((k) => k !== FLEET_KEY);
    const names = await getPolicyNamesByIds(sql as never, orgId, policyIds);
    const floods = policyIds.map((id) => {
      const entry = evaluation.state[id]!;
      return {
        policy_id: id,
        name: names[id] ?? id,
        count: entry.count,
        tripped_at: entry.tripped_at,
      };
    });
    const fleetEntry = evaluation.state[FLEET_KEY] ?? null;
    return NextResponse.json({ floods, fleet: fleetEntry, budget });
  } catch (err) {
    return apiErrorResponse(err, 'APPROVALS_FLOODS GET');
  }
}
