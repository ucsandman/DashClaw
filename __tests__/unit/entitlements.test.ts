/**
 * app/lib/entitlements.ts — pure plan-entitlement functions (hosted paid
 * tier, docs/decisions/2026-08-09-hosted-paid-tier.md). No SQL, no fetch;
 * these tests only exercise the pure functions with hand-fed inputs.
 */
import { describe, it, expect } from 'vitest';
import {
  PLAN_ENTITLEMENTS,
  entitlementsForPlan,
  seatCapReached,
  actionCeilingExceeded,
} from '../../app/lib/entitlements';

describe('entitlementsForPlan', () => {
  it('returns the provisioned caps for each known plan', () => {
    expect(entitlementsForPlan('free')).toEqual({ seatCap: 2, monthlyActionCeiling: null });
    expect(entitlementsForPlan('indie')).toEqual({ seatCap: 2, monthlyActionCeiling: 50_000 });
    expect(entitlementsForPlan('team')).toEqual({ seatCap: 10, monthlyActionCeiling: 250_000 });
  });

  it('falls back to free for unrecognized or missing plan values', () => {
    expect(entitlementsForPlan('enterprise')).toEqual(PLAN_ENTITLEMENTS.free);
    expect(entitlementsForPlan(null)).toEqual(PLAN_ENTITLEMENTS.free);
    expect(entitlementsForPlan(undefined)).toEqual(PLAN_ENTITLEMENTS.free);
  });
});

describe('seatCapReached', () => {
  it('blocks the (cap+1)th invite for indie (seatCap 2)', () => {
    expect(seatCapReached('indie', 1, 0)).toBe(false); // 1 seat used, cap 2 -> room for one more
    expect(seatCapReached('indie', 2, 0)).toBe(true);  // at cap
    expect(seatCapReached('indie', 1, 1)).toBe(true);  // member + pending invite already at cap
  });

  it('allows up to 10 seats for team before blocking', () => {
    expect(seatCapReached('team', 9, 0)).toBe(false);
    expect(seatCapReached('team', 10, 0)).toBe(true);
    expect(seatCapReached('team', 5, 5)).toBe(true);
  });

  it('a downgrade with existing members already over cap blocks new invites', () => {
    // Org downgraded from team (10 seats) to indie (2 seats) with 6 existing
    // members. Existing members are never removed; the next invite is blocked.
    expect(seatCapReached('indie', 6, 0)).toBe(true);
  });
});

describe('actionCeilingExceeded', () => {
  it('blocks at the indie ceiling (50,000) but not just under it', () => {
    expect(actionCeilingExceeded('indie', 49_999)).toBe(false);
    expect(actionCeilingExceeded('indie', 50_000)).toBe(true);
    expect(actionCeilingExceeded('indie', 50_001)).toBe(true);
  });

  it('blocks at the team ceiling (250,000)', () => {
    expect(actionCeilingExceeded('team', 249_999)).toBe(false);
    expect(actionCeilingExceeded('team', 250_000)).toBe(true);
  });

  it('free has no monthly ceiling — governed by the lifetime trial cap instead', () => {
    expect(actionCeilingExceeded('free', 1_000_000)).toBe(false);
  });
});
