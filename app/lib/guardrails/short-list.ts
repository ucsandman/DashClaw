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

/** Hard cap. Adding an 11th interrupting line is a 409, not a silent overflow. */
export const SHORT_LIST_CAP = 10;

export type ShortListTier = 'BLOCK' | 'HOLD' | 'WATCH';
export type EffectiveAction = 'allow' | 'warn' | 'require_approval' | 'block' | 'other';

const ACTION_VALUES = new Set<string>(['allow', 'warn', 'require_approval', 'block']);

/**
 * Per-type default decision when the rules carry no explicit action key.
 * Mirrors the runtime evaluators in app/lib/guard/policy.ts (POLICY_EVALUATORS)
 * so a tier chip agrees with what the rule actually does.
 */
const TYPE_DEFAULT_ACTION: Record<string, EffectiveAction> = {
  block_action_type: 'block',
  risk_threshold: 'block',
  non_fabrication: 'block',
  require_approval: 'require_approval',
  protected_path: 'require_approval',
  webhook_check: 'require_approval',
  permission_escalation: 'require_approval',
  green_contract: 'require_approval',
  branch_freshness: 'require_approval',
  delegation_constraint: 'require_approval',
  role_constraint: 'require_approval',
  deviation_response: 'require_approval',
  warn_action_type: 'warn',
  rate_limit: 'warn',
  agent_allowlist: 'warn',
  require_evidence: 'warn',
  allow_grant: 'allow',
};

/** Policy types whose evaluator HARDCODES its decision and ignores `rules.action`. */
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
 * The decision this rule yields when it fires. An explicit action key wins
 * (`action`, or the per-type spellings `on_violation` / `enforcement`);
 * otherwise the type's default. Unknown/retired types are `other`.
 */
export function effectiveAction(policyType: string, rules: Record<string, unknown>): EffectiveAction {
  for (const key of ['action', 'on_violation', 'enforcement'] as const) {
    const v = rules?.[key];
    if (typeof v === 'string' && ACTION_VALUES.has(v)) return v as EffectiveAction;
  }
  return TYPE_DEFAULT_ACTION[policyType] ?? 'other';
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
 * Demote a rule to Watch: it still fires and is still recorded, it just does
 * not interrupt. Returns a COPY; the Short List opt-in flags are stripped so a
 * watched rule can never claim a slot.
 *
 * `policyType` is optional only to keep the helper usable on a bare rules
 * object; callers that know the type MUST pass it, otherwise a rule whose
 * interrupting action comes from its type default (e.g. risk_threshold with no
 * `action`) is left untouched.
 *
 * ponytail: `non_fabrication` has no warn tier (`on_violation` is
 * block|require_approval only), so it cannot be demoted here. Upgrade path is a
 * warn option in the evaluator, not more code in this function.
 */
export function toWatchTier(
  rules: Record<string, unknown>,
  policyType = '',
): Record<string, unknown> {
  const out = { ...rules };
  delete out.short_list;
  delete out.ungrantable;
  const action = effectiveAction(policyType, rules);
  if (action === 'block' || action === 'require_approval') {
    out.action = 'warn';
    // require_evidence reads `enforcement`, not `action`, and defaults to warn
    // when the key is absent.
    delete out.enforcement;
  }
  return out;
}

/**
 * The policy type a watched rule must be stored as. `require_approval` and
 * `block_action_type` hardcode their decision in the evaluator and ignore
 * `rules.action`; both share `warn_action_type`'s exact rules shape.
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
