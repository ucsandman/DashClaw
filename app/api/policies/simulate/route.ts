export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db';
import { getOrgId } from '../../../lib/org';
import { evaluatePolicy } from '../../../lib/guard';
import { listActionsForSimulation } from '../../../lib/repositories/actions.repository';
import { loadPackPolicies } from '../../../lib/guardrails/import-pack';
import { inferPolicyType, AVAILABLE_PACKS } from '../../../lib/policyPackPreviews';

// Severity used to dedupe pack-simulation outcomes per action: when several
// pack policies match the same historical action, the aggregate counts it once
// at the most severe outcome. allow_contained sits with warn — it lets the act
// run (contained), so counting it as an interrupt would overstate the pack.
const OUTCOME_SEVERITY: Record<string, number> = {
  block: 3, require_approval: 2, warn: 1, allow_contained: 1,
};

// Mirror import-pack's old-format conversion so a pack simulates exactly the
// rules its install would create.
function packPolicyRules(policy: Record<string, unknown>): Record<string, unknown> {
  if (policy.rules) return policy.rules as Record<string, unknown>;
  return {
    action_types: (policy.applies_to as { tools?: unknown[] })?.tools || [],
    ...((policy.rule as Record<string, unknown>) || {}),
  };
}

/**
 * POST /api/policies/simulate — Dry-run a policy against historical actions.
 * Body: { policy_type, rules (Object), days? } OR { pack: string, days? }
 */
export async function POST(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const body = await request.json();

    const { policy_type, rules, pack, days = 7 } = body;

    if (pack) {
      if (!AVAILABLE_PACKS.includes(pack)) {
        return NextResponse.json({ error: `Invalid pack. Choose from: ${AVAILABLE_PACKS.join(', ')}` }, { status: 400 });
      }
      return simulatePack(sql, orgId, pack, days);
    }

    if (!policy_type || !rules) {
      return NextResponse.json({ error: 'policy_type and rules are required (or pass a pack id)' }, { status: 400 });
    }

    // Fetch historical actions using the repository
    const actions = await listActionsForSimulation(sql, orgId, days);

    if (actions.length === 0) {
      return NextResponse.json({
        summary: { total: 0, matches: 0, block: 0, warn: 0, require_approval: 0, allow: 0 },
        matches: [],
        message: 'No historical actions found in the specified window.'
      });
    }

    const simulationResults = [];
    const counts: Record<string, number> = { total: actions.length, matches: 0, block: 0, warn: 0, require_approval: 0, allow: 0 };

    const dummyPolicy = { id: 'sim_1', name: 'Simulation Policy', policy_type };

    // Run evaluations
    for (const action of actions) {
      const context = {
        ...action,
        // Ensure systems_touched is parsed if it's a string from DB
        systems_touched: typeof action.systems_touched === 'string' ? JSON.parse(action.systems_touched) : action.systems_touched
      };

      const result = await evaluatePolicy(dummyPolicy as unknown as Parameters<typeof evaluatePolicy>[0], rules, context, sql, orgId, undefined as unknown as number);

      if (result && result.action !== 'allow') {
        counts.matches = (counts.matches ?? 0) + 1;
        counts[result.action] = (counts[result.action] ?? 0) + 1;
        simulationResults.push({
          action_id: action.action_id,
          goal: action.declared_goal,
          agent_name: action.agent_name || action.agent_id,
          timestamp: action.timestamp_start,
          original_status: action.status,
          simulated_action: result.action,
          simulated_reason: result.reason
        });
      } else {
        counts.allow = (counts.allow ?? 0) + 1;
      }
    }

    return NextResponse.json({
      summary: counts,
      matches: simulationResults,
      sample_size: actions.length,
      window_days: days
    });
  } catch (err) {
    console.error('[POLICIES/SIMULATE] POST error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

const PACK_MATCH_CAP = 50;

// Pack-level dry run: every policy in the pack is evaluated against the same
// historical window; the aggregate counts each action once at its most severe
// outcome, and per_policy reports each policy's own match counts.
async function simulatePack(
  sql: ReturnType<typeof getSql>,
  orgId: string,
  pack: string,
  days: number,
) {
  let packPolicies: Array<Record<string, unknown>>;
  try {
    packPolicies = await loadPackPolicies(pack);
  } catch {
    return NextResponse.json({ error: `Pack file not found: ${pack}` }, { status: 404 });
  }

  const policies = packPolicies.map((p) => ({
    name: String(p.description || p.id),
    policy_type: inferPolicyType(p),
    rules: packPolicyRules(p),
  }));

  const actions = await listActionsForSimulation(sql, orgId, days);

  const emptySummary = { total: actions.length, matches: 0, block: 0, warn: 0, require_approval: 0, allow: actions.length };
  const perPolicy = policies.map((p) => ({
    name: p.name, policy_type: p.policy_type, matches: 0,
    block: 0, warn: 0, require_approval: 0,
  }));

  if (actions.length === 0) {
    return NextResponse.json({
      pack,
      summary: { ...emptySummary, allow: 0 },
      per_policy: perPolicy,
      matches: [],
      matches_truncated: false,
      sample_size: 0,
      window_days: days,
      message: 'No historical actions found in the specified window.',
    });
  }

  const summary: Record<string, number> = { total: actions.length, matches: 0, block: 0, warn: 0, require_approval: 0, allow: 0 };
  const matches = [];
  let truncated = false;

  for (const action of actions) {
    const context = {
      ...action,
      systems_touched: typeof action.systems_touched === 'string' ? JSON.parse(action.systems_touched) : action.systems_touched,
    };

    let worst: { action: string; reason: string; policyName: string } | null = null;

    for (let i = 0; i < policies.length; i++) {
      const p = policies[i]!;
      const dummyPolicy = { id: `sim_pack_${i}`, name: p.name, policy_type: p.policy_type };
      const result = await evaluatePolicy(
        dummyPolicy as unknown as Parameters<typeof evaluatePolicy>[0],
        p.rules, context, sql, orgId, undefined as unknown as number,
      );
      if (!result || result.action === 'allow') continue;
      const severity = OUTCOME_SEVERITY[result.action] ?? 1;
      const pp = perPolicy[i]!;
      pp.matches += 1;
      if (result.action === 'block' || result.action === 'warn' || result.action === 'require_approval') {
        pp[result.action] += 1;
      }
      if (!worst || severity > (OUTCOME_SEVERITY[worst.action] ?? 1)) {
        worst = { action: result.action, reason: result.reason, policyName: p.name };
      }
    }

    if (worst) {
      summary.matches = (summary.matches ?? 0) + 1;
      summary[worst.action] = (summary[worst.action] ?? 0) + 1;
      if (matches.length < PACK_MATCH_CAP) {
        matches.push({
          action_id: action.action_id,
          goal: action.declared_goal,
          agent_name: action.agent_name || action.agent_id,
          timestamp: action.timestamp_start,
          original_status: action.status,
          simulated_action: worst.action,
          simulated_reason: worst.reason,
          matched_policy: worst.policyName,
        });
      } else {
        truncated = true;
      }
    } else {
      summary.allow = (summary.allow ?? 0) + 1;
    }
  }

  return NextResponse.json({
    pack,
    summary,
    per_policy: perPolicy,
    matches,
    matches_truncated: truncated,
    sample_size: actions.length,
    window_days: days,
  });
}
