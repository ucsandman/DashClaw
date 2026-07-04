export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getOrgId } from '../../../lib/org';
import { getSql } from '../../../lib/db';
import { apiErrorResponse } from '../../../lib/apiErrors';
import { evaluateApprovalFlood, getInterruptBudget, FLEET_KEY } from '../../../lib/approval-flood';
import { getPolicyNamesByIds, getRecentApprovalCountsByPolicy } from '../../../lib/repositories/guardrails.repository';

/**
 * GET /api/approvals/floods — current interruption-budget (approval flood)
 * state. Re-evaluates on read so banners stay fresh without a scheduler;
 * this is also how a flood CLEARS once traffic stops. Note: the evaluation
 * persists flood-state membership transitions (trip/clear), so this GET can
 * write — by design, and bounded to transitions.
 *
 * ?include_synthetic=1 (v3.5): an EPHEMERAL would-trip view that counts
 * synthetic traffic too — nothing persisted, nothing suppressed, nothing
 * notified. Exists so the policy-smoke harness can positively prove flood
 * detection with its own marked traffic (tightening.repository.ts
 * precedent); the banner never sends this param.
 */
export async function GET(request: Request) {
  try {
    const orgId = getOrgId(request);
    const sql = getSql();

    const includeSynthetic = new URL(request.url).searchParams.get('include_synthetic') === '1';
    if (includeSynthetic) {
      const budget = await getInterruptBudget(sql, orgId);
      const counts = await getRecentApprovalCountsByPolicy(sql as never, orgId, budget.windowMin, { includeSynthetic: true });
      const tripped = Object.entries(counts).filter(([, count]) => count > budget.perPolicy);
      const names = await getPolicyNamesByIds(sql as never, orgId, tripped.map(([id]) => id));
      const floods = tripped.map(([id, count]) => ({
        policy_id: id,
        name: names[id] ?? id,
        count,
        tripped_at: null,
      }));
      const total = Object.values(counts).reduce((a, b) => a + b, 0);
      const fleet = total > budget.fleetWide ? { tripped_at: null, count: total } : null;
      return NextResponse.json({ floods, fleet, budget, synthetic_included: true });
    }

    const evaluation = await evaluateApprovalFlood(sql, orgId);
    const policyEntries = Object.entries(evaluation.state).filter(([k]) => k !== FLEET_KEY);
    const names = await getPolicyNamesByIds(sql as never, orgId, policyEntries.map(([id]) => id));
    const floods = policyEntries.map(([id, entry]) => ({
      policy_id: id,
      name: names[id] ?? id,
      count: entry.count,
      tripped_at: entry.tripped_at,
    }));
    const fleetEntry = evaluation.state[FLEET_KEY] ?? null;
    return NextResponse.json({ floods, fleet: fleetEntry, budget: evaluation.budget });
  } catch (err) {
    return apiErrorResponse(err, 'APPROVALS_FLOODS GET');
  }
}
