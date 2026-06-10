export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getOrgId } from '../../../lib/org';
import { getSql } from '../../../lib/db';
import { apiErrorResponse } from '../../../lib/apiErrors';
import {
  getActivePolicies,
  getDecisionCountsByPolicy,
  getDecisionOutcomeCounts,
} from '../../../lib/repositories/guardrails.repository';
import { listAgentsForOrg } from '../../../lib/repositories/agents.repository';
import { getActionStats } from '../../../lib/repositories/actions.repository';
import {
  buildPolicySummary,
  type ActivePolicyRow,
  type OutcomeCounts,
} from '../../../lib/policy-modes/summary';

const ZERO_OUTCOMES: OutcomeCounts = { total: 0, allow: 0, warn: 0, require_approval: 0, block: 0 };

/**
 * GET /api/policies/summary — the read-only posture summary for the /policies
 * cockpit: current mode(s), enforcement rule buckets, the compiled rule list,
 * shield states, 30-day decision outcomes, agent count, and pending approvals.
 *
 * Decision-derived signals (per-policy fire counts, outcome rollup, pending
 * approvals) are ADDITIVE: each is caught independently so a failing analytics
 * query degrades to zeros rather than breaking the page.
 */
export async function GET(request: Request) {
  try {
    const orgId = getOrgId(request);
    const sql = getSql();

    const [active, agents, counts, decisions30d, stats] = await Promise.all([
      getActivePolicies(sql, orgId),
      listAgentsForOrg(sql, orgId).catch(() => [] as unknown[]),
      getDecisionCountsByPolicy(sql, orgId, 30).catch(() => ({})),
      getDecisionOutcomeCounts(sql, orgId, 30).catch(() => ZERO_OUTCOMES),
      getActionStats(sql, orgId).catch(() => null),
    ]);

    const pendingApprovals =
      Number((stats?.current as { approval?: number } | undefined)?.approval ?? 0) || 0;

    const summary = buildPolicySummary(
      active as unknown as ActivePolicyRow[],
      counts,
      decisions30d,
      Array.isArray(agents) ? agents.length : 0,
      pendingApprovals,
    );

    return NextResponse.json(summary);
  } catch (err) {
    return apiErrorResponse(err, 'POLICY_SUMMARY GET');
  }
}
