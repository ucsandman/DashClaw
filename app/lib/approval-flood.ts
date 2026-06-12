// W3 interruption budget: no single policy (or the fleet) may generate
// unbounded approval interruptions. Detection over guard_decisions; state in
// a settings-key marker (drift-tick pattern). Collapses NOTIFICATIONS only —
// never resolves or suppresses the pending approvals themselves.
import { getSettings, upsertSetting } from './repositories/settings.repository';
import { getRecentApprovalCountsByPolicy, getPolicyNamesByIds } from './repositories/guardrails.repository';
import type { SqlTag } from './types/db';

export const APPROVAL_FLOOD_STATE_KEY = 'APPROVAL_FLOOD_STATE';
export const FLEET_KEY = '_fleet';

export interface FloodBudget { perPolicy: number; windowMin: number; fleetWide: number }
export interface FloodEntry { tripped_at: string; count: number }
export type FloodState = Record<string, FloodEntry>;

export interface FloodEvaluation {
  state: FloodState;
  /** policy ids currently tripped (plus FLEET_KEY when fleet budget exceeded) */
  suppressed: Set<string>;
  newlyTripped: Array<{ policy_id: string; count: number }>;
  fleetTripped: boolean;
  /** the evaluated window, so callers don't re-read settings for labels */
  windowMin: number;
}

const DEFAULTS: FloodBudget = { perPolicy: 10, windowMin: 15, fleetWide: 30 };

function num(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : fallback;
}

export async function getInterruptBudget(sql: SqlTag, orgId: string): Promise<FloodBudget> {
  try {
    const rows = (await getSettings(sql, orgId, {})) as Array<{ key?: string; value?: unknown }>;
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    return {
      perPolicy: num(byKey.DASHCLAW_INTERRUPT_BUDGET, DEFAULTS.perPolicy),
      windowMin: num(byKey.DASHCLAW_INTERRUPT_WINDOW_MIN, DEFAULTS.windowMin),
      fleetWide: num(byKey.DASHCLAW_INTERRUPT_BUDGET_FLEET, DEFAULTS.fleetWide),
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export async function getFloodState(sql: SqlTag, orgId: string): Promise<FloodState> {
  try {
    const rows = (await getSettings(sql, orgId, { key: APPROVAL_FLOOD_STATE_KEY })) as Array<{ value?: unknown }>;
    const parsed = JSON.parse(String(rows[0]?.value ?? '{}'));
    return parsed && typeof parsed === 'object' ? (parsed as FloodState) : {};
  } catch {
    return {};
  }
}

/**
 * Evaluate flood state for the org. Fail-open: any error returns an empty
 * evaluation so per-action notifications proceed (worst case = today's
 * behavior, never silence).
 */
export async function evaluateApprovalFlood(sql: SqlTag, orgId: string): Promise<FloodEvaluation> {
  const empty: FloodEvaluation = { state: {}, suppressed: new Set(), newlyTripped: [], fleetTripped: false, windowMin: DEFAULTS.windowMin };
  try {
    const budget = await getInterruptBudget(sql, orgId);
    const counts = await getRecentApprovalCountsByPolicy(sql as never, orgId, budget.windowMin);
    const state = await getFloodState(sql, orgId);
    const now = new Date().toISOString();
    const newlyTripped: FloodEvaluation['newlyTripped'] = [];
    let changed = false;

    for (const [policyId, count] of Object.entries(counts)) {
      if (count > budget.perPolicy && !state[policyId]) {
        state[policyId] = { tripped_at: now, count };
        newlyTripped.push({ policy_id: policyId, count });
        changed = true;
      } else if (state[policyId] && state[policyId].count !== count) {
        state[policyId].count = count;
        changed = true;
      }
    }

    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    if (total > budget.fleetWide && !state[FLEET_KEY]) {
      state[FLEET_KEY] = { tripped_at: now, count: total };
      newlyTripped.push({ policy_id: FLEET_KEY, count: total });
      changed = true;
    } else if (state[FLEET_KEY] && state[FLEET_KEY].count !== total) {
      state[FLEET_KEY].count = total;
      changed = true;
    }

    // Hysteresis: clear once the current window falls below half the budget.
    for (const key of Object.keys(state)) {
      const current = key === FLEET_KEY ? total : (counts[key] ?? 0);
      const bar = key === FLEET_KEY ? budget.fleetWide : budget.perPolicy;
      if (current < bar / 2) {
        delete state[key];
        changed = true;
      }
    }

    // Best-effort persistence: concurrent evaluations are last-writer-wins
    // (no claimed marker like drift-tick). Worst case is a duplicate flood
    // notification or a clear delayed one cycle — tolerable for suppression.
    if (changed) {
      try {
        await upsertSetting(sql, orgId, {
          key: APPROVAL_FLOOD_STATE_KEY,
          value: JSON.stringify(state),
          category: 'system',
        });
      } catch (err) {
        console.warn('[approval-flood] state write failed:', (err as Error)?.message);
      }
    }

    return { state, suppressed: new Set(Object.keys(state)), newlyTripped, fleetTripped: !!state[FLEET_KEY], windowMin: budget.windowMin };
  } catch (err) {
    console.warn('[approval-flood] evaluation failed — failing open:', (err as Error)?.message);
    return empty;
  }
}

/** Parse matched_policies off a guard decision (JSON text or array). */
export function matchedPolicyIds(guardDecision: { matched_policies?: unknown } | null | undefined): string[] {
  const raw = guardDecision?.matched_policies;
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === 'string' && raw.startsWith('[')) {
    try { return (JSON.parse(raw) as unknown[]).map(String); } catch { return []; }
  }
  return [];
}

/** One native notification per newly tripped budget (never throws). */
export async function notifyNewFloods(
  sql: SqlTag,
  orgId: string,
  newlyTripped: Array<{ policy_id: string; count: number }>,
  windowMin: number,
): Promise<void> {
  if (!newlyTripped.length) return;
  try {
    const { deliverNativeNotifications } = await import('./notification-adapters/index');
    const ids = newlyTripped.map((t) => t.policy_id).filter((id) => id !== FLEET_KEY);
    const names = await getPolicyNamesByIds(sql as never, orgId, ids);
    const signals = newlyTripped.map((t) => ({
      severity: 'red',
      label: t.policy_id === FLEET_KEY
        ? `Approval flood: fleet-wide (${t.count} interrupts in ${windowMin}m)`
        : `Approval flood: ${names[t.policy_id] ?? t.policy_id} (${t.count} interrupts in ${windowMin}m)`,
      detail: 'Per-action approval pings are paused for this source. Pending approvals are intact — review on /approvals: pause the rule or bulk-resolve.',
      help: 'A flood almost always means an over-broad require_approval rule, not N risky actions.',
    }));
    const settings = await getSettings(sql, orgId, { category: 'integration' });
    await deliverNativeNotifications(orgId, signals, settings as unknown as import('./notification-adapters/index').SettingRow[], sql);
  } catch (err) {
    console.warn('[approval-flood] flood notification failed:', (err as Error)?.message);
  }
}
