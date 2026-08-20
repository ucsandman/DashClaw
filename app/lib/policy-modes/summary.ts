// Posture summary — synthesizes the read-only "what is governing my agents right
// now" view for the /policies cockpit from the active guard policies + decision
// counts. Pure: no I/O. The route layer supplies the queried inputs.

import { POLICY_MODE_CATALOG, type InterruptionLevel } from './catalog';
import { nominalDecision } from './compile';
import { SHIELDS, matchShieldsToPolicies } from '../../policies/lib/shields';
import { findInertPolicies, type InertPolicy } from '../inert-policies';
import { describePolicyScope } from './contract';
import { SHORT_LIST_CAP, isShortListLine, shortListTier, type ShortListTier } from '../guardrails/short-list';
import { INTERRUPTION_BUDGET_DEFAULTS } from '../posture/loosening';
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

/** One line on the Short List — the derived set allowed to interrupt (spec 4.2). */
export interface ShortListLine {
  id: string;
  name: string;
  tier: ShortListTier;
  policy_type: string;
  /** Plain-English one-liner, the same sentence the Sentences lens shows. */
  scope: string;
  fired30d: number;
  ungrantable: boolean;
  shape_exceptions: string[];
  active: boolean;
  /** Seeded at org birth by the catastrophe pack, rather than added by hand. */
  seeded: boolean;
}

/** A rule worth having that the org does not have yet. Never auto-applied. */
export interface PolicySuggestion {
  id: 'real_money';
  title: 'Real money';
  scope: string;
  rule: {
    policy_type: 'require_approval';
    rules: {
      action: 'require_approval';
      action_types: string[];
      ungrantable: true;
      short_list: true;
    };
  };
}

export interface BudgetReport {
  policiesOverBudget: number;
  shapesOverBudget: number;
  window_hours: number;
  budget: number;
  shape_budget: number;
}

/** Inputs the summary cannot derive from the policy rows alone. */
export interface PolicySummaryExtras {
  /** The spend class, read from the spend-lockdown pack by the caller. */
  spendActionTypes?: string[];
  /**
   * ALL policy rows, dormant included — the Short List renders `active: false`
   * lines struck-through with an On control. Defaults to the active rows.
   */
  allPolicies?: ActivePolicyRow[];
  policiesOverBudget?: number;
  shapesOverBudget?: number;
  /** The org's configured budget, so the report never contradicts the guard. */
  budget?: number;
}

/** Names the catastrophe pack writes at org birth. */
const SEEDED_NAME_PREFIX = 'Catastrophe Pack — ';

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
  /** Active gating rules currently nullified by an allow_grant (F1). An inert
   *  policy is worse than no policy — it manufactures false confidence — so
   *  /policies renders these with the suppressing grant. */
  inert: InertPolicy[];
  /** The rules allowed to interrupt, derived (never stored). Spec 4.2. */
  shortList: ShortListLine[];
  /** Hard cap on the above. An 11th line is a 409, not a silent overflow. */
  shortListCap: typeof SHORT_LIST_CAP;
  /** Rules worth having that this org does not have. A human clicks to adopt. */
  suggestions: PolicySuggestion[];
  /** What the interruption budget is currently relieving. Spec 4.4. */
  budgetReport: BudgetReport;
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
  extras: PolicySummaryExtras = {},
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
    // F1: gating rules an active grant currently nullifies. Computed here so
    // every consumer of the summary sees the same truth as the cockpit.
    inert: findInertPolicies(active as Parameters<typeof findInertPolicies>[0]),
    shortList: buildShortList(extras.allPolicies ?? active, counts),
    shortListCap: SHORT_LIST_CAP,
    suggestions: buildSuggestions(active, extras.spendActionTypes ?? []),
    budgetReport: buildBudgetReport(extras),
  };
}

function stringList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [];
}

/**
 * The Short List: membership is DERIVED from the rules (block/require_approval,
 * or the explicit `short_list` opt-in), never stored. One source of truth with
 * the write paths, which enforce the cap through the same predicate.
 *
 * Includes DORMANT lines. The cap counts only the active ones (a rule that is
 * off is not interrupting anybody), which is the consumer's `filter` to make.
 */
function buildShortList(
  rows: ActivePolicyRow[],
  counts: Record<string, PolicyDecisionCount>,
): ShortListLine[] {
  const out: ShortListLine[] = [];
  for (const p of rows) {
    const parsed = parseRules(p.rules);
    if (!isShortListLine(p.policy_type, parsed)) continue;
    out.push({
      id: p.id,
      name: p.name,
      tier: shortListTier(p.policy_type, parsed),
      policy_type: p.policy_type,
      scope: describePolicyScope(p),
      fired30d: counts[p.id]?.fired ?? 0,
      ungrantable: parsed.ungrantable === true,
      shape_exceptions: stringList(parsed.shape_exceptions),
      active: p.active === undefined || Number(p.active) === 1,
      seeded: p.name.startsWith(SEEDED_NAME_PREFIX),
    });
  }
  return out;
}

/**
 * Real money is the one class worth proposing unprompted: an unattended agent
 * that can spend is the failure nobody recovers from by reverting a commit.
 * Proposed only when NOTHING already gates the class — and proposed, never
 * applied (MAINTAINER.md 3: enforcement moves only on a human click).
 */
function buildSuggestions(active: ActivePolicyRow[], spendActionTypes: string[]): PolicySuggestion[] {
  if (spendActionTypes.length === 0) return [];
  const spend = new Set(spendActionTypes);
  const alreadyGated = active.some((p) => {
    const parsed = parseRules(p.rules);
    const decision = nominalDecision({
      name: p.name,
      policy_type: p.policy_type as GuardPolicyType,
      rules: parsed,
      active: 1,
    });
    if (decision !== 'require_approval' && decision !== 'block') return false;
    return stringList(parsed.action_types).some((t) => spend.has(t));
  });
  if (alreadyGated) return [];

  const rules = {
    action: 'require_approval',
    action_types: spendActionTypes,
    ungrantable: true,
    short_list: true,
  } as const;
  return [
    {
      id: 'real_money',
      title: 'Real money',
      scope: describePolicyScope({
        id: 'suggestion_real_money',
        name: 'Real money',
        policy_type: 'require_approval',
        rules,
      }),
      rule: { policy_type: 'require_approval', rules },
    },
  ];
}

function buildBudgetReport(extras: PolicySummaryExtras): BudgetReport {
  const budget = extras.budget ?? INTERRUPTION_BUDGET_DEFAULTS.perWindow;
  return {
    policiesOverBudget: extras.policiesOverBudget ?? 0,
    shapesOverBudget: extras.shapesOverBudget ?? 0,
    window_hours: INTERRUPTION_BUDGET_DEFAULTS.windowHours,
    budget,
    // One switch turns both grains off — mirrors the loosening route.
    shape_budget: budget > 0 ? INTERRUPTION_BUDGET_DEFAULTS.shapePerWindow : 0,
  };
}
