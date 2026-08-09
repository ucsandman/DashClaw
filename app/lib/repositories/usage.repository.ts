// Usage repository — per-org monthly metering rollup (hosted paid tier, G4;
// docs/decisions/2026-08-09-hosted-paid-tier.md). Read-only measurement:
// nothing enforces off these counters. The rollup is maintained inline by
// createActionRecord (the single funnel shared by POST /api/actions and
// POST /api/guard?record=true) and is exactly rebuildable from action_records
// via scripts/backfill-usage-rollups.mjs.
import type { SqlTag } from '../types/db';

/** Returns the given (default: current) instant's UTC period as 'YYYY-MM'. */
export function getCurrentPeriod(now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/**
 * Atomically bump the caller org's current-period counters. Every recorded
 * action counts as governed; blocked ones additionally count as blocked.
 * Metering must never break the action write path, so failures are logged
 * and swallowed — the backfill script reconciles any gap.
 */
export async function incrementUsageRollup(
  sql: SqlTag,
  orgId: string,
  options: { blocked?: boolean } = {},
): Promise<void> {
  const period = getCurrentPeriod();
  const blockedDelta = options.blocked ? 1 : 0;
  try {
    await sql`
      INSERT INTO usage_rollups (org_id, period, governed_actions, blocked_actions)
      VALUES (${orgId}, ${period}, 1, ${blockedDelta})
      ON CONFLICT (org_id, period) DO UPDATE SET
        governed_actions = usage_rollups.governed_actions + 1,
        blocked_actions = usage_rollups.blocked_actions + ${blockedDelta},
        updated_at = now()
    `;
  } catch (err) {
    console.warn('[usage] rollup increment failed (org=', orgId, '):', err);
  }
}

export interface UsageSummary {
  period: string;
  governed_actions: number;
  blocked_actions: number;
  seats: { users: number; active_api_keys: number };
  plan: string;
  hosted_mode: boolean;
  trial: { action_cap: number; actions_used: number } | null;
}

function toCount(value: unknown): number {
  const n = typeof value === 'string' ? parseInt(value, 10) : Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Current-period usage for one org: rollup counters plus live seat counts
 * (users + active API keys — both tiny per-org COUNTs, not action-table scans).
 */
export async function getUsageSummary(sql: SqlTag, orgId: string): Promise<UsageSummary> {
  const period = getCurrentPeriod();
  const [rollupRows, userRows, keyRows, orgRows] = await Promise.all([
    sql`
      SELECT governed_actions, blocked_actions
      FROM usage_rollups WHERE org_id = ${orgId} AND period = ${period}
    `,
    sql`SELECT COUNT(*)::int AS total FROM users WHERE org_id = ${orgId}`,
    sql`SELECT COUNT(*)::int AS total FROM api_keys WHERE org_id = ${orgId} AND revoked_at IS NULL`,
    sql`
      SELECT plan, hosted_mode, trial_action_cap, trial_actions_used
      FROM organizations WHERE id = ${orgId} LIMIT 1
    `,
  ]);

  const rollup = rollupRows[0] || {};
  const org = orgRows[0] || {};
  const trialCap = org.trial_action_cap;
  return {
    period,
    governed_actions: toCount(rollup.governed_actions),
    blocked_actions: toCount(rollup.blocked_actions),
    seats: {
      users: toCount(userRows[0]?.total),
      active_api_keys: toCount(keyRows[0]?.total),
    },
    plan: (org.plan as string) || 'free',
    hosted_mode: !!org.hosted_mode,
    trial: trialCap != null
      ? { action_cap: toCount(trialCap), actions_used: toCount(org.trial_actions_used) }
      : null,
  };
}

/** Recent monthly rollup rows for one org, newest period first. */
export async function getUsageHistory(
  sql: SqlTag,
  orgId: string,
  months: number = 12,
): Promise<Record<string, unknown>[]> {
  const rows = await sql`
    SELECT period, governed_actions, blocked_actions, updated_at
    FROM usage_rollups
    WHERE org_id = ${orgId}
    ORDER BY period DESC
    LIMIT ${months}
  `;
  return rows.map((row) => ({
    period: row.period,
    governed_actions: toCount(row.governed_actions),
    blocked_actions: toCount(row.blocked_actions),
    updated_at: row.updated_at,
  }));
}
