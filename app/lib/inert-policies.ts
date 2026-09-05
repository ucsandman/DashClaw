/**
 * Inert-policy detection (F1, governance gap audit 2026-08-05).
 *
 * An operator writes "Require approval: social posts" and believes they have
 * an approval gate. A blanket `[Grant] post` — accumulated from an
 * "approve and don't ask again" click months earlier — silently downgrades
 * every matching verdict to allow. The policy still MATCHES, still appears in
 * matched_policies, and still reads as active on /policies. It just never
 * stops anything.
 *
 * That is the exact failure shape DashClaw exists to prevent, one level up:
 * a control that reports healthy while enforcing nothing. So the suppression
 * has to be visible where the operator reads their rules.
 *
 * Pure and synchronous — the caller supplies the org's policy rows.
 */

import { grantIsExpired } from './policy-shapes';
import { parseRules } from './guardrails/short-list';

export interface PolicyRowLike {
  id: string;
  name: string;
  policy_type: string;
  rules: unknown;
  active?: unknown;
  created_at?: unknown;
}

export interface Suppressor {
  id: string;
  name: string;
  /** null when the grant covers the whole action type (legacy blanket grant). */
  target_prefix: string | null;
}

export interface InertPolicy {
  id: string;
  name: string;
  policy_type: string;
  /** Action types whose gate this policy loses to a grant. */
  action_types: string[];
  suppressed_by: Suppressor[];
}

const isActive = (p: PolicyRowLike): boolean => p.active == null || p.active === 1 || p.active === true;

/** Gating policy types whose verdict an allow_grant can clear (blocks can't be). */
const GRANTABLE_GATING_TYPES = new Set(['require_approval', 'warn_action_type']);

/**
 * Which active gating policies are currently nullified by an active,
 * unexpired grant — and by which grant.
 *
 * Scope note: a *scoped* grant (target_prefix) only suppresses the gate for
 * targets under that prefix, so it is reported as a partial suppressor only
 * when it is the sole one; a blanket grant nullifies the policy outright.
 * Both are worth showing — the operator's belief ("this rule gates X") is
 * wrong in either case, just to different degrees.
 */
export function findInertPolicies(policies: PolicyRowLike[], now: Date = new Date()): InertPolicy[] {
  const grants: Array<{ id: string; name: string; action_type: string; target_prefix: string | null }> = [];
  for (const p of policies) {
    if (p.policy_type !== 'allow_grant' || !isActive(p)) continue;
    const rules = parseRules(p.rules);
    if (grantIsExpired(rules, p.created_at, now)) continue;
    if (typeof rules.action_type !== 'string' || !rules.action_type) continue;
    grants.push({
      id: p.id,
      name: p.name,
      action_type: rules.action_type,
      target_prefix: typeof rules.target_prefix === 'string' && rules.target_prefix ? rules.target_prefix : null,
    });
  }
  if (grants.length === 0) return [];

  const inert: InertPolicy[] = [];
  for (const p of policies) {
    if (!GRANTABLE_GATING_TYPES.has(p.policy_type) || !isActive(p)) continue;
    const rules = parseRules(p.rules);
    // An ungrantable rule is immune by construction (F1) — never report it.
    if (rules.ungrantable === true) continue;
    const actionTypes = Array.isArray(rules.action_types)
      ? rules.action_types.filter((t): t is string => typeof t === 'string' && !!t)
      : [];
    if (actionTypes.length === 0) continue;

    const suppressors = new Map<string, Suppressor>();
    const covered: string[] = [];
    for (const type of actionTypes) {
      const match = grants.find((g) => g.action_type === type);
      if (!match) continue;
      covered.push(type);
      suppressors.set(match.id, { id: match.id, name: match.name, target_prefix: match.target_prefix });
    }
    if (covered.length > 0) {
      inert.push({
        id: p.id,
        name: p.name,
        policy_type: p.policy_type,
        action_types: covered,
        suppressed_by: [...suppressors.values()],
      });
    }
  }
  return inert;
}
