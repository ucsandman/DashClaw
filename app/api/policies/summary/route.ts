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
import { loadPackPolicies } from '../../../lib/guardrails/import-pack';
import {
  getInterruptionBudget,
  getOverBudgetPolicyIds,
  getOverBudgetShapeKeys,
} from '../../../lib/guard/caches';

const ZERO_OUTCOMES: OutcomeCounts = { total: 0, allow: 0, warn: 0, require_approval: 0, block: 0 };

/**
 * The real-money action class, read from the spend-lockdown pack's hold rule.
 * Best-effort: an unreadable pack means no suggestion, never a broken page.
 */
async function loadSpendActionTypes(): Promise<string[]> {
  try {
    const policies = await loadPackPolicies('spend-lockdown');
    const hold = policies.find((p) => p.policy_type === 'require_approval');
    const types = (hold?.rules as { action_types?: unknown } | undefined)?.action_types;
    return Array.isArray(types) ? types.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

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

    const [active, agents, counts, decisions30d, stats, spendActionTypes, budget, overPolicies, overShapes] =
      await Promise.all([
        getActivePolicies(sql, orgId),
        listAgentsForOrg(sql, orgId).catch(() => [] as unknown[]),
        getDecisionCountsByPolicy(sql, orgId, 30).catch(() => ({})),
        getDecisionOutcomeCounts(sql, orgId, 30).catch(() => ZERO_OUTCOMES),
        getActionStats(sql, orgId).catch(() => null),
        // The spend class has ONE definition: the spend-lockdown pack. Reading
        // it here beats a second copy in code that silently drifts from the pack.
        loadSpendActionTypes(),
        getInterruptionBudget(sql, orgId).catch(() => undefined),
        getOverBudgetPolicyIds(sql, orgId).catch(() => new Set<string>()),
        getOverBudgetShapeKeys(sql, orgId).catch(() => new Set<string>()),
      ]);

    const pendingApprovals =
      Number((stats?.current as { approval?: number } | undefined)?.approval ?? 0) || 0;

    const summary = buildPolicySummary(
      active as unknown as ActivePolicyRow[],
      counts,
      decisions30d,
      Array.isArray(agents) ? agents.length : 0,
      pendingApprovals,
      {
        spendActionTypes,
        policiesOverBudget: overPolicies.size,
        shapesOverBudget: overShapes.size,
        budget,
      },
    );

    return NextResponse.json(summary);
  } catch (err) {
    return apiErrorResponse(err, 'POLICY_SUMMARY GET');
  }
}
