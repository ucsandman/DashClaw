// W3 interruption budget: no single policy (or the fleet) may generate
// unbounded approval interruptions. Detection over guard_decisions; state in
// a settings-key marker (drift-tick pattern). Collapses NOTIFICATIONS only —
// never resolves or suppresses the pending approvals themselves.
import { getSettings, upsertSetting } from './repositories/settings.repository';
import { getRecentApprovalCountsByPolicy } from './repositories/guardrails.repository';

export const APPROVAL_FLOOD_STATE_KEY = 'APPROVAL_FLOOD_STATE';
export const FLEET_KEY = '_fleet';

type SqlTag = unknown; // repositories own typing; this module just threads it

export interface FloodBudget { perPolicy: number; windowMin: number; fleetWide: number }
export interface FloodEntry { tripped_at: string; count: number }
export type FloodState = Record<string, FloodEntry>;

export interface FloodEvaluation {
  state: FloodState;
  /** policy ids currently tripped (plus FLEET_KEY when fleet budget exceeded) */
  suppressed: Set<string>;
  newlyTripped: Array<{ policy_id: string; count: number }>;
  fleetTripped: boolean;
}

const DEFAULTS: FloodBudget = { perPolicy: 10, windowMin: 15, fleetWide: 30 };

function num(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : fallback;
}

export async function getInterruptBudget(sql: SqlTag, orgId: string): Promise<FloodBudget> {
  try {
    const rows = (await getSettings(sql as never, orgId, {})) as Array<{ key?: string; value?: unknown }>;
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
    const rows = (await getSettings(sql as never, orgId, { key: APPROVAL_FLOOD_STATE_KEY })) as Array<{ value?: unknown }>;
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
  const empty: FloodEvaluation = { state: {}, suppressed: new Set(), newlyTripped: [], fleetTripped: false };
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

    if (changed) {
      try {
        await upsertSetting(sql as never, orgId, {
          key: APPROVAL_FLOOD_STATE_KEY,
          value: JSON.stringify(state),
          category: 'system',
        });
      } catch (err) {
        console.warn('[approval-flood] state write failed:', (err as Error)?.message);
      }
    }

    return { state, suppressed: new Set(Object.keys(state)), newlyTripped, fleetTripped: !!state[FLEET_KEY] };
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
