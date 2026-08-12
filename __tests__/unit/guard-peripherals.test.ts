/**
 * Regression coverage for three adversarial-review findings in the guard's
 * supporting modules (peripherals to evaluateGuard itself):
 *
 * 1. protected-path.ts globs must match case-insensitively — Windows and
 *    default macOS are case-insensitive filesystems, so a write to
 *    `app/api/Auth/route.ts` or `.ENV` addresses the same file the
 *    lowercase-authored PROTECTED_PATH_GROUPS glob is meant to guard.
 * 2. risk.ts must attribute the persisted risk-template score to the SAME
 *    template computeAutoRisk (riskTemplates.ts) matched, not re-derive an
 *    independent (and possibly disagreeing) selection.
 * 3. caches.ts's six org-keyed Maps must not grow for the process lifetime —
 *    a size cap + expired-entry sweep on .set(), and org deletion
 *    (hosted-workspace.repository.ts) must invalidate them.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { matchesProtectedPath, PROTECTED_PATH_GROUPS } from '@/lib/guard/protected-path';
import { computeRiskAssessment } from '@/lib/guard/risk';
import type { GuardEvalContext, GuardSql } from '@/lib/guard/types';
import {
  loadOrgRiskTemplates,
  __resetGuardCaches,
  GUARD_CACHE_MAX_ENTRIES,
} from '@/lib/guard/caches';
import { deleteHostedWorkspace } from '@/lib/repositories/hosted-workspace.repository';
import type { SqlTag } from '@/lib/types/db';

// ─────────────────────────────────────────────────────────────────────────
// 1. protected-path case-insensitivity
// ─────────────────────────────────────────────────────────────────────────

describe('protected-path case-insensitive matching (Windows/macOS filesystem identity)', () => {
  it('a mixed-case .env file matches the lowercase-authored secrets glob', () => {
    expect(matchesProtectedPath('.ENV', PROTECTED_PATH_GROUPS.secrets)).toBe(true);
  });

  it('a mixed-case auth route matches the lowercase-authored auth glob', () => {
    expect(matchesProtectedPath('app/api/Auth/route.ts', PROTECTED_PATH_GROUPS.auth)).toBe(true);
  });

  it('still returns false for a path that matches on neither case', () => {
    expect(matchesProtectedPath('app/components/Button.jsx', PROTECTED_PATH_GROUPS.auth)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 2. risk-template attribution must match the template that produced the score
// ─────────────────────────────────────────────────────────────────────────

function stubTemplateSql(rows: Record<string, unknown>[]): GuardSql {
  const fn = (async (strings: TemplateStringsArray) => {
    const text = strings.join(' ');
    if (text.includes('FROM risk_templates')) return rows;
    return [];
  }) as GuardSql;
  fn.query = async () => [];
  return fn;
}

describe('computeRiskAssessment — template attribution matches computeAutoRisk\'s selection', () => {
  beforeEach(() => __resetGuardCaches());

  it('attributes the score to the wildcard template that actually produced it, not the array-order fallback', async () => {
    // action_type "other" matches neither template exactly. computeAutoRisk
    // correctly falls back to the ACTIVE WILDCARD template (action_type null
    // matches everything). The old risk.ts re-derivation instead fell back to
    // templates[0] — the first row in array order — regardless of whether
    // that row was relevant, so it attributed the audit trail to "Deploy Only
    // Rule" even though "Wildcard Rule" (base_risk 40) produced the score.
    const rows = [
      { id: 'rt_deploy_only', name: 'Deploy Only Rule', status: 'active', action_type: 'deploy', base_risk: 90, rules: [] },
      { id: 'rt_wildcard', name: 'Wildcard Rule', status: 'active', action_type: null, base_risk: 40, rules: [] },
    ];
    const context: GuardEvalContext = { action_type: 'other', agent_id: 'a1', declared_goal: 'noop' };
    const { breakdownBase } = await computeRiskAssessment(stubTemplateSql(rows), 'org_attr_1', context);
    expect(breakdownBase.template).toEqual({ id: 'rt_wildcard', name: 'Wildcard Rule', score: 40 });
  });

  it('attributes to the exact action_type match when one exists (both selections agree)', async () => {
    const rows = [
      { id: 'rt_wildcard', name: 'Wildcard Rule', status: 'active', action_type: null, base_risk: 20, rules: [] },
      { id: 'rt_deploy', name: 'Deploy Rule', status: 'active', action_type: 'deploy', base_risk: 55, rules: [] },
    ];
    const context: GuardEvalContext = { action_type: 'deploy', agent_id: 'a1', declared_goal: 'noop' };
    const { breakdownBase } = await computeRiskAssessment(stubTemplateSql(rows), 'org_attr_2', context);
    expect(breakdownBase.template).toEqual({ id: 'rt_deploy', name: 'Deploy Rule', score: 55 });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 3a. cache growth cap + expired-entry sweep (caches.ts)
// ─────────────────────────────────────────────────────────────────────────

function noopRiskTemplateSql(): SqlTag {
  const fn = vi.fn(async () => []);
  (fn as unknown as { query: unknown }).query = vi.fn(async () => []);
  return fn as unknown as SqlTag;
}

describe('guard cache growth cap (caches.ts)', () => {
  beforeEach(() => __resetGuardCaches());
  afterEach(() => vi.useRealTimers());

  it('evicts by oldest-insertion-order once the map exceeds the cap', async () => {
    const sql = noopRiskTemplateSql() as unknown as GuardSql;
    for (let i = 0; i < GUARD_CACHE_MAX_ENTRIES; i++) {
      await loadOrgRiskTemplates(sql, `org_cap_${i}`);
    }
    // One more entry pushes the map past the cap and triggers the sweep.
    await loadOrgRiskTemplates(sql, 'org_cap_newest');

    // The oldest entry (none of these are expired — same TTL window) must
    // have been evicted to make room: a follow-up call re-queries the DB.
    const trackedOldest = vi.fn(async () => []);
    (trackedOldest as unknown as { query: unknown }).query = vi.fn(async () => []);
    await loadOrgRiskTemplates(trackedOldest as unknown as GuardSql, 'org_cap_0');
    expect(trackedOldest).toHaveBeenCalled();

    // The just-inserted entry must still be cached: no re-query.
    const trackedNewest = vi.fn(async () => []);
    (trackedNewest as unknown as { query: unknown }).query = vi.fn(async () => []);
    await loadOrgRiskTemplates(trackedNewest as unknown as GuardSql, 'org_cap_newest');
    expect(trackedNewest).not.toHaveBeenCalled();
  }, 20_000);

  it('sweeps expired entries ahead of the oldest-insertion fallback', async () => {
    vi.useFakeTimers();
    const sql = noopRiskTemplateSql() as unknown as GuardSql;
    for (let i = 0; i < GUARD_CACHE_MAX_ENTRIES; i++) {
      await loadOrgRiskTemplates(sql, `org_ttl_${i}`);
    }
    // Past the 30s risk-template TTL: every entry above is now expired.
    vi.advanceTimersByTime(31_000);
    // Pushing one more entry past the cap triggers the sweep, which removes
    // ALL now-expired entries (not just enough to reach the cap).
    await loadOrgRiskTemplates(sql, 'org_ttl_newest');

    const tracked = vi.fn(async () => []);
    (tracked as unknown as { query: unknown }).query = vi.fn(async () => []);
    await loadOrgRiskTemplates(tracked as unknown as GuardSql, 'org_ttl_0');
    expect(tracked).toHaveBeenCalled(); // expired long before the sweep ran
  }, 20_000);
});

// ─────────────────────────────────────────────────────────────────────────
// 3b. org deletion invalidates the guard caches
// ─────────────────────────────────────────────────────────────────────────

const { invalidateSpies } = vi.hoisted(() => ({
  invalidateSpies: {
    policy: vi.fn(),
    riskTemplate: vi.fn(),
    settings: vi.fn(),
    calibration: vi.fn(),
  },
}));
vi.mock('@/lib/guard/caches', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/guard/caches')>();
  return {
    ...actual,
    invalidateGuardPolicyCache: invalidateSpies.policy,
    invalidateGuardRiskTemplateCache: invalidateSpies.riskTemplate,
    invalidateGuardSettingsCache: invalidateSpies.settings,
    invalidateGuardCalibrationCache: invalidateSpies.calibration,
  };
});

function makeDeleteSqlMock(responses: unknown[][]): SqlTag {
  const queue = [...responses];
  const fn = vi.fn(async () => queue.shift() ?? []);
  (fn as unknown as { query: unknown }).query = vi.fn(async () => []);
  return fn as unknown as SqlTag;
}

describe('deleteHostedWorkspace invalidates the guard caches for the deleted org', () => {
  beforeEach(() => {
    invalidateSpies.policy.mockClear();
    invalidateSpies.riskTemplate.mockClear();
    invalidateSpies.settings.mockClear();
    invalidateSpies.calibration.mockClear();
  });

  it('calls all four invalidate*Cache functions with the deleted orgId', async () => {
    const sql = makeDeleteSqlMock([
      [{ hosted_mode: true }], // existence check
      [],                      // revoke keys
      [],                      // snapshot: queryLiveTrialFacts (no live row → snapshot short-circuits)
      [],                      // children catalog query
      [],                      // DELETE FROM organizations
    ]);
    await deleteHostedWorkspace(sql, 'org_del_1');
    expect(invalidateSpies.policy).toHaveBeenCalledWith('org_del_1');
    expect(invalidateSpies.riskTemplate).toHaveBeenCalledWith('org_del_1');
    expect(invalidateSpies.settings).toHaveBeenCalledWith('org_del_1');
    expect(invalidateSpies.calibration).toHaveBeenCalledWith('org_del_1');
  });

  it('does not invalidate when the delete refuses (claimed org)', async () => {
    const sql = makeDeleteSqlMock([
      [{ hosted_mode: true, claimed_at: '2026-08-09T00:00:00Z' }], // existence check
    ]);
    await expect(deleteHostedWorkspace(sql, 'org_del_2')).rejects.toThrow('claimed');
    expect(invalidateSpies.policy).not.toHaveBeenCalled();
  });
});
