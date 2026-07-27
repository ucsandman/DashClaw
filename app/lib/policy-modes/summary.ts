// Posture summary — synthesizes the read-only "what is governing my agents right
// now" view for the /policies cockpit from the active guard policies + decision
// counts. Pure: no I/O. The route layer supplies the queried inputs.

import { POLICY_MODE_CATALOG, type InterruptionLevel } from './catalog';
import { nominalDecision } from './compile';
import { SHIELDS, matchShieldsToPolicies } from '../../policies/lib/shields';
import type { GuardPolicyType, DecisionType } from '@/lib/types';

export interface ActivePolicyRow {
  id: string;
  name: string;
  policy_type: string;
  /** JSON text (the guard_policies column) or an already-parsed object. */
  rules: string | Record<string, unknown> | null;
  /** JSON array of agent ids the policy is scoped to; null/empty = all agents. */
  agent_ids?: string | null;
  active?: number;
}

export interface PolicyDecisionCount {
  fired: number;
  lastFiredAt: string | null;
}
export interface OutcomeCounts {
  total: number;
  allow: number;
  warn: number;
  require_approval: number;
  block: number;
}

export type RuleBucket = 'allow' | 'warn' | 'allow_contained' | 'require_approval' | 'block';
export interface PolicySummaryMode {
  id: string;
  name: string;
  interruptionLevel: InterruptionLevel;
}
export interface PolicySummaryRule {
  id: string;
  name: string;
  bucket: RuleBucket;
  fired30d: number;
  lastFiredAt: string | null;
}
export interface PolicySummaryShield {
  id: string;
  name: string;
  description: string;
  on: boolean;
  fired30d: number;
  lastFiredAt: string | null;
}

export interface PolicySummary {
  governed: boolean;
  modes: PolicySummaryMode[];
  /** Most-recently-applied mode (headline), or null when ungoverned. */
  primaryMode: PolicySummaryMode | null;
  /** Rule-count buckets over ALL active policies (allow is implicit). */
  enforcement: { total: number; warn: number; require_approval: number; block: number };
  /** The compiled rule list for the "View rules" disclosure, severity-ordered. */
  rules: PolicySummaryRule[];
  shields: PolicySummaryShield[];
  /** Decision OUTCOME counts over the last 30 days (separate from rule counts). */
  decisions30d: OutcomeCounts;
  /** Derived scope of the active policy set. `allAgents` = nothing is per-agent scoped. */
  scope: { allAgents: boolean };
  agents: { total: number };
  pendingApprovals: number;
}

function policyTargetsAllAgents(agentIds: string | null | undefined): boolean {
  if (agentIds == null || agentIds === '') return true;
  try {
    const parsed = JSON.parse(agentIds);
    return !Array.isArray(parsed) || parsed.length === 0;
  } catch {
    return true;
  }
}

function parseRules(r: ActivePolicyRow['rules']): Record<string, unknown> {
  if (r && typeof r === 'object') return r as Record<string, unknown>;
  if (typeof r === 'string') {
    try {
      return JSON.parse(r) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return {};
}

// allow_contained sits between warn and require_approval on the severity ladder.
const BUCKET_ORDER: Record<RuleBucket, number> = { block: 0, require_approval: 1, allow_contained: 2, warn: 3, allow: 4 };

function toBucket(d: DecisionType): RuleBucket {
  if (d === 'warn') return 'warn';
  if (d === 'allow_contained') return 'allow_contained';
  if (d === 'require_approval') return 'require_approval';
  if (d === 'block') return 'block';
  return 'allow';
}

/**
 * Build the cockpit's posture summary.
 * @param active        active guard_policies rows, ordered created_at DESC.
 * @param counts        per-policy-id fire counts (may be {} if unavailable).
 * @param decisions30d  org-wide outcome counts for the window.
 */
export function buildPolicySummary(
  active: ActivePolicyRow[],
  counts: Record<string, PolicyDecisionCount>,
  decisions30d: OutcomeCounts,
  agentsTotal: number,
  pendingApprovals: number,
): PolicySummary {
  const governed = active.length > 0;

  // Modes from the `_mode` tag. `active` is created_at DESC, so the first _mode
  // encountered is the most-recently-applied → the headline primary.
  const seen = new Set<string>();
  const modes: PolicySummaryMode[] = [];
  for (const p of active) {
    const mid = parseRules(p.rules)._mode;
    if (typeof mid !== 'string' || seen.has(mid)) continue;
    const cat = POLICY_MODE_CATALOG[mid];
    if (!cat) continue;
    seen.add(mid);
    modes.push({ id: cat.id, name: cat.name, interruptionLevel: cat.interruptionLevel });
  }
  const primaryMode = modes[0] ?? null;

  // Enforcement buckets + the compiled rule list over ALL active policies.
  const enforcement = { total: active.length, warn: 0, require_approval: 0, block: 0 };
  const rules: PolicySummaryRule[] = [];
  for (const p of active) {
    const parsed = parseRules(p.rules);
    const decision = nominalDecision({
      name: p.name,
      policy_type: p.policy_type as GuardPolicyType,
      rules: parsed,
      active: 1,
    });
    const bucket = toBucket(decision);
    if (bucket === 'warn') enforcement.warn++;
    else if (bucket === 'require_approval') enforcement.require_approval++;
    else if (bucket === 'block') enforcement.block++;
    const c = counts[p.id];
    rules.push({ id: p.id, name: p.name, bucket, fired30d: c?.fired ?? 0, lastFiredAt: c?.lastFiredAt ?? null });
  }
  rules.sort((a, b) => BUCKET_ORDER[a.bucket] - BUCKET_ORDER[b.bucket]);

  // Shields via the canonical `_shield` matcher; fired counts by the matched policy id.
  const matched = matchShieldsToPolicies(active as unknown as { rules?: string }[]);
  const shields: PolicySummaryShield[] = (
    SHIELDS as Array<{ id: string; name: string; description: string }>
  ).map((s) => {
    const policy = matched.get(s.id) as { id?: string } | null;
    const c = policy?.id ? counts[policy.id] : undefined;
    return {
      id: s.id,
      name: s.name,
      description: s.description,
      on: !!policy,
      fired30d: c?.fired ?? 0,
      lastFiredAt: c?.lastFiredAt ?? null,
    };
  });

  const scopeAllAgents = active.every((p) => policyTargetsAllAgents(p.agent_ids));

  return {
    governed,
    modes,
    primaryMode,
    enforcement,
    rules,
    shields,
    decisions30d,
    scope: { allAgents: scopeAllAgents },
    agents: { total: agentsTotal },
    pendingApprovals,
  };
}
