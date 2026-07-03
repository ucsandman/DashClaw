export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db';
import { getOrgId } from '../../../lib/org';
import { apiErrorResponse } from '../../../lib/apiErrors';
import { baseAgentId } from '../../../lib/agent-identity-resolve';
import { getActivePolicies } from '../../../lib/repositories/guardrails.repository';
import { sumWindowSpend, sumWindowSpendByFamily } from '../../../lib/repositories/x402.repository';
import type { X402BudgetEntry } from '../../../lib/types/x402';

function parseAgentIds(raw: unknown): string[] {
  if (!raw) return [];
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

/**
 * GET /api/x402/budget — live cumulative-budget consumption (roadmap v2.6c).
 *
 * Renders the state the guard's budget gate computes but never showed: for
 * every ACTIVE x402_spend_limit policy with a budget tier (budget_usd or
 * budget_approval_threshold), the rolling-window spend it would gate the next
 * purchase against. Window/scope normalization mirrors the guard's
 * x402BudgetWindow, and the sums come from the SAME repository predicate the
 * gate uses (sumWindowSpend) — one definition of "spend".
 *
 * `?agent_id=` narrows agent-scoped entries to that identity family
 * (normalized to its base, matching the gate); org-scoped entries are
 * unaffected — an org budget doesn't shrink when you filter by agent.
 */
export async function GET(request: Request) {
  try {
    const orgId = getOrgId(request);
    const sql = getSql();
    const params = new URL(request.url).searchParams;
    const rawAgent = params.get('agent_id');
    const filterFamily = rawAgent ? (baseAgentId(rawAgent) ?? rawAgent) : null;

    const policies = await getActivePolicies(sql, orgId);
    const budgets: X402BudgetEntry[] = [];
    for (const policy of policies) {
      if (policy.policy_type !== 'x402_spend_limit') continue;
      let rules: Record<string, unknown>;
      try { rules = JSON.parse(String(policy.rules ?? '{}')); } catch { continue; }
      const budgetUsd = typeof rules.budget_usd === 'number' ? rules.budget_usd : null;
      const budgetApproval = typeof rules.budget_approval_threshold === 'number' ? rules.budget_approval_threshold : null;
      if (budgetUsd == null && budgetApproval == null) continue; // per-purchase-only policy — no window to meter

      // Same clamping as the guard's x402BudgetWindow (guard.ts): 1–365 days,
      // default 30; scope defaults to org.
      const windowDays = Math.max(1, Math.min(365, parseInt(String(rules.budget_window_days), 10) || 30));
      const scope: 'org' | 'agent' = rules.budget_scope === 'agent' ? 'agent' : 'org';
      const sinceIso = new Date(Date.now() - windowDays * 86400000).toISOString();

      const entry: X402BudgetEntry = {
        policy_id: String(policy.id),
        policy_name: policy.name != null ? String(policy.name) : null,
        agent_ids: parseAgentIds(policy.agent_ids),
        budget_usd: budgetUsd,
        budget_approval_threshold: budgetApproval,
        budget_window_days: windowDays,
        budget_scope: scope,
        window_start: sinceIso,
      };
      if (scope === 'org') {
        entry.window_spend_usd = await sumWindowSpend(sql, orgId, { sinceIso });
      } else if (filterFamily) {
        // Same targeting rule as the unfiltered path: a family this policy
        // never gates has no meter here.
        const targeted = entry.agent_ids.map((id) => baseAgentId(id) ?? id);
        entry.families = (entry.agent_ids.length === 0 || targeted.includes(filterFamily))
          ? [{
              agent_id: filterFamily,
              window_spend_usd: await sumWindowSpend(sql, orgId, { sinceIso, agentId: filterFamily }),
            }]
          : [];
      } else {
        entry.families = await sumWindowSpendByFamily(sql, orgId, { sinceIso });
        // Honor policy targeting: an agent_ids-targeted budget only ever gates
        // those families — other families' spend is not this policy's meter.
        if (entry.agent_ids.length > 0) {
          const targeted = new Set(entry.agent_ids.map((id) => baseAgentId(id) ?? id));
          entry.families = entry.families.filter((f) => targeted.has(f.agent_id));
        }
      }
      budgets.push(entry);
    }

    return NextResponse.json({ budgets });
  } catch (err) {
    return apiErrorResponse(err, 'X402/BUDGET GET');
  }
}
