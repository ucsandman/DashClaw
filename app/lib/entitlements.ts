/**
 * Plan entitlements — hosted paid tier
 * (docs/decisions/2026-08-09-hosted-paid-tier.md).
 *
 * The gating principle from that decision: paid tiers gate CAPACITY and
 * OPERATIONS only (seats, monthly governed-action ceilings). No plan, free
 * or paid, ever loses a governance/safety capability — guard decisions,
 * policy enforcement, and approval requirements are identical on every plan.
 *
 * Enforcement applies ONLY when the org's `hosted_mode` is true. Self-hosted
 * DashClaw is free and complete forever, with no enforcement, ever — callers
 * must check `hosted_mode` before consulting this module; the functions here
 * are plan-shaped only and don't know about hosted_mode themselves.
 *
 * Seat caps and monthly ceilings below are PROVISIONAL: the decision doc is
 * explicit that final numbers are set only after real hosted usage has been
 * measured against the v5.12 metering rollup. Expect these to be retuned.
 *
 * Pure module: no SQL, no fetch, no DB access. Callers pass in already-read
 * plan/count/usage values.
 */

export type Plan = 'free' | 'indie' | 'team';

export interface PlanEntitlements {
  seatCap: number;
  /**
   * null = no monthly governed-action ceiling. The free hosted plan has no
   * ceiling here because it's already governed by the separate lifetime
   * `organizations.trial_action_cap` (the 30-day trial cap), not a monthly one.
   */
  monthlyActionCeiling: number | null;
}

// PROVISIONAL — see docs/decisions/2026-08-09-hosted-paid-tier.md.
export const PLAN_ENTITLEMENTS: Record<Plan, PlanEntitlements> = {
  free: { seatCap: 2, monthlyActionCeiling: null },
  indie: { seatCap: 2, monthlyActionCeiling: 50_000 },
  team: { seatCap: 10, monthlyActionCeiling: 250_000 },
};

function normalizePlan(plan: string | null | undefined): Plan {
  return plan === 'indie' || plan === 'team' ? plan : 'free';
}

/** Entitlements for a plan string. Unrecognized/missing values fall back to 'free'. */
export function entitlementsForPlan(plan: string | null | undefined): PlanEntitlements {
  return PLAN_ENTITLEMENTS[normalizePlan(plan)];
}

/**
 * True when adding one more seat (a new invite) would put the org at or over
 * its plan's seat cap. Existing members are never removed by a downgrade —
 * this only blocks the NEXT invite once members + pending invites are
 * already at cap.
 */
export function seatCapReached(
  plan: string | null | undefined,
  memberCount: number,
  pendingInviteCount: number,
): boolean {
  const { seatCap } = entitlementsForPlan(plan);
  return memberCount + pendingInviteCount >= seatCap;
}

/**
 * True when the current period's governed-action count is at or over the
 * plan's monthly ceiling. Plans with no ceiling (free) never trip this.
 */
export function actionCeilingExceeded(
  plan: string | null | undefined,
  currentPeriodGovernedActions: number,
): boolean {
  const { monthlyActionCeiling } = entitlementsForPlan(plan);
  if (monthlyActionCeiling == null) return false;
  return currentPeriodGovernedActions >= monthlyActionCeiling;
}
