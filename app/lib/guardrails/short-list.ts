/**
 * The Short List — the derived set of rules allowed to interrupt an agent.
 *
 * Membership is DERIVED, never stored as its own table: a rule is on the list
 * iff its effective action is block/require_approval, OR its rules carry the
 * explicit `short_list: true` opt-in. Existing orgs therefore already have a
 * Short List with no backfill.
 *
 * Every write path (pack import, POST/PATCH /api/policies) runs new rules
 * through `toWatchTier` unless the caller opts in with `short_list: true`,
 * and enforces `SHORT_LIST_CAP` on the ones that do.
 */

import { nominalDecision } from '../policy-modes/compile';
import { isKnownPolicyType } from '../guard/policy';
import type { GuardPolicyType } from '../types';

/** Hard cap. Adding an 11th interrupting line is a 409, not a silent overflow. */
export const SHORT_LIST_CAP = 10;

export type ShortListTier = 'BLOCK' | 'HOLD' | 'WATCH';
export type EffectiveAction = 'allow' | 'warn' | 'require_approval' | 'block' | 'other';

const ACTION_VALUES = new Set<string>(['allow', 'warn', 'require_approval', 'block']);

/**
 * Types whose evaluator reads `escalate_action` and never looks at
 * `rules.action` (app/lib/guard/policy.ts:430, :475, :529). For
 * delegation/role it is the escalation itself; for deviation_response it is a
 * CEILING, so it is still the worst this rule can do.
 */
const ESCALATE_ACTION_TYPES = new Set(['delegation_constraint', 'role_constraint', 'deviation_response']);

/**
 * Types with NO warn tier — their only settings are require_approval/block, so
 * they cannot be demoted to Watch at all:
 *   non_fabrication        on_violation      require_approval | block (policy.ts:121)
 *   delegation_constraint  escalate_action   require_approval | block (validate.js:718)
 *   role_constraint        escalate_action   require_approval | block (validate.js:748)
 * deviation_response is NOT here: validate.js:776 accepts `warn` and the
 * evaluator clamps every consequence to that ceiling.
 */
const NO_WATCH_TIER_TYPES = new Set(['non_fabrication', 'delegation_constraint', 'role_constraint']);

/**
 * Policy types whose evaluator HARDCODES its decision and ignores every action
 * key. Both share `warn_action_type`'s exact rules shape (all three route
 * through `matchActionType`), so the watch form swaps the stored type.
 */
const WATCH_TYPE_SWAP: Record<string, string> = {
  require_approval: 'warn_action_type',
  block_action_type: 'warn_action_type',
};

/** Accept the guard_policies.rules column in any of its three shapes. */
export function parseRules(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return {};
}

/**
 * The decision this rule yields when it fires.
 *
 * Delegates to `nominalDecision` (app/lib/policy-modes/compile.ts) — the same
 * table the /policies Ledger's Bucket column uses — so a tier chip can never
 * disagree with the Ledger. Two things it adds: the `escalate_action` types
 * nominalDecision does not model, and `other` for a retired/unknown type,
 * which nominalDecision's `default:` branch would report as `block`.
 */
export function effectiveAction(policyType: string, rules: Record<string, unknown>): EffectiveAction {
  if (!isKnownPolicyType(policyType)) return 'other';
  if (ESCALATE_ACTION_TYPES.has(policyType)) {
    const escalate = rules?.escalate_action;
    return typeof escalate === 'string' && ACTION_VALUES.has(escalate)
      ? (escalate as EffectiveAction)
      : 'require_approval';
  }
  const decision = nominalDecision({
    name: '',
    policy_type: policyType as GuardPolicyType,
    rules: rules ?? {},
    active: 1,
  });
  // allow_contained executes (contained), it does not interrupt — not a slot.
  return decision === 'allow_contained' ? 'other' : decision;
}

/** True when this rule occupies a Short List slot. */
export function isShortListLine(policyType: string, rules: Record<string, unknown>): boolean {
  if (rules?.short_list === true) return true;
  const action = effectiveAction(policyType, rules);
  return action === 'block' || action === 'require_approval';
}

export function shortListTier(policyType: string, rules: Record<string, unknown>): ShortListTier {
  const action = effectiveAction(policyType, rules);
  if (action === 'block') return 'BLOCK';
  if (action === 'require_approval') return 'HOLD';
  return 'WATCH';
}

/**
 * False when this policy type has no warn tier at all. Such a rule can only
 * interrupt, so it must be added as a Short List line or not at all — writing
 * a demotion flag its evaluator ignores would leave it interrupting while the
 * UI reported it as watched, and it would escape the cap count.
 */
export function hasWatchTier(policyType: string): boolean {
  return !NO_WATCH_TIER_TYPES.has(policyType);
}

/** Operator-facing reason a rule of this type cannot be demoted to Watch. */
export function noWatchTierMessage(policyType: string): string {
  return `A ${policyType} rule has no Watch tier — it can only interrupt. Add it as a Short List line (rules.short_list: true) or remove it.`;
}

/**
 * Demote a rule to Watch: it still fires and is still recorded, it just does
 * not interrupt. Returns a COPY; the Short List opt-in flags are stripped so a
 * watched rule can never claim a slot.
 *
 * The demotion is written to the key the rule's OWN evaluator reads —
 * `escalate_action`, `enforcement`, or `action` — never a key it ignores.
 * Callers must check `hasWatchTier` first; for a type without one this returns
 * the rules unchanged apart from the flags.
 *
 * `policyType` is optional only to keep the helper usable on a bare rules
 * object; callers that know the type MUST pass it, otherwise a rule whose
 * interrupting action comes from its type default (e.g. risk_threshold with no
 * `action`) is left untouched.
 */
export function toWatchTier(
  rules: Record<string, unknown>,
  policyType = '',
): Record<string, unknown> {
  const out = { ...rules };
  delete out.short_list;
  delete out.ungrantable;

  const action = effectiveAction(policyType, rules);
  if (action !== 'block' && action !== 'require_approval') return out;
  if (!hasWatchTier(policyType)) return out;

  if (ESCALATE_ACTION_TYPES.has(policyType)) {
    out.escalate_action = 'warn';
  } else if (policyType === 'require_evidence') {
    // The evaluator reads `enforcement`; nominalDecision reads it too, so it
    // must be SET to warn, not deleted (they disagree on the absent default).
    out.enforcement = 'warn';
  } else if (!(policyType in WATCH_TYPE_SWAP)) {
    out.action = 'warn';
    // validate.js:715 rejects contain_above unless action is require_approval,
    // so a demoted containment band would fail the next edit.
    delete out.contain_above;
  }
  return out;
}

/**
 * The policy type a watched rule must be stored as — see WATCH_TYPE_SWAP.
 */
export function watchPolicyType(policyType: string): string {
  return WATCH_TYPE_SWAP[policyType] ?? policyType;
}

/** How many Short List slots the given rows occupy. Inactive rows do not count. */
export function countShortListLines(
  rows: Array<{ policy_type: string; rules: unknown; active?: unknown }>,
): number {
  let count = 0;
  for (const row of rows) {
    if (row.active === 0 || row.active === false || row.active === '0') continue;
    if (isShortListLine(row.policy_type, parseRules(row.rules))) count++;
  }
  return count;
}

/** Thrown/returned when a write would push the Short List past SHORT_LIST_CAP. */
export class ShortListFullError extends Error {
  readonly code = 'SHORT_LIST_FULL';
  constructor(message = `The Short List is full (${SHORT_LIST_CAP} of ${SHORT_LIST_CAP}). Remove a line to add this one.`) {
    super(message);
    this.name = 'ShortListFullError';
  }
}
