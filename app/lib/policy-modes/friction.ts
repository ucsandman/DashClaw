// Best-effort "friction preview" for a compiled mode pack: replay the mode's
// DETERMINISTIC policies against recent action history and report how many past
// actions would have been allowed / warned / paused / blocked.
//
// Honesty rules:
// - Only deterministic, side-effect-free policy types are simulated. Types that
//   need live LLM / webhook / embeddings / pairing / intel, or a per-action DB
//   count (rate_limit), are EXCLUDED and reported by name — never silently.
// - Zero history → { available: false, reason } (no fabricated numbers).
// - Never hard-fails: any error degrades to { available: false, reason }.

import { evaluatePolicy } from '../guard';
import { listActionsForSimulation } from '../repositories/actions.repository';
import type { CompiledModePolicy } from './compile';

type Sql = Parameters<typeof listActionsForSimulation>[0];

// Cheap, deterministic, no extra DB / live deps — safe to replay per action.
const SIMULATED_TYPES = new Set<string>([
  'risk_threshold',
  'require_approval',
  'block_action_type',
  'warn_action_type',
  'protected_path',
]);

const SEVERITY: Record<string, number> = { allow: 0, warn: 1, require_approval: 2, block: 3 };

export interface FrictionUnavailable {
  available: false;
  reason: string;
}

export interface FrictionResult {
  available: true;
  sample_size: number;
  window_days: number;
  summary: { total: number; allow: number; warn: number; require_approval: number; block: number };
  excluded_policy_types: string[];
}

export type FrictionPreview = FrictionUnavailable | FrictionResult;

/**
 * Simulate a compiled mode pack against recent action history.
 * Read-only; best-effort; degrades to { available: false } on no-history or error.
 */
export async function previewModeFriction(
  sql: Sql,
  orgId: string,
  policies: CompiledModePolicy[],
  days = 7,
): Promise<FrictionPreview> {
  try {
    const simulated = policies.filter((p) => SIMULATED_TYPES.has(p.policy_type));
    const excluded = [...new Set(policies.filter((p) => !SIMULATED_TYPES.has(p.policy_type)).map((p) => p.policy_type))];

    if (simulated.length === 0) {
      return { available: false, reason: 'This mode has no deterministically-simulable policies to preview.' };
    }

    const actions = await listActionsForSimulation(sql, orgId, days);
    if (!actions || actions.length === 0) {
      return { available: false, reason: 'No recent action history to simulate against yet.' };
    }

    const summary = { total: actions.length, allow: 0, warn: 0, require_approval: 0, block: 0 };

    for (const action of actions) {
      const context = {
        ...action,
        systems_touched:
          typeof action.systems_touched === 'string'
            ? JSON.parse(action.systems_touched)
            : action.systems_touched,
      };

      let worst = 'allow';
      for (const p of simulated) {
        const dummy = { id: 'preview', name: p.name, policy_type: p.policy_type };
        const result = await evaluatePolicy(
          dummy as unknown as Parameters<typeof evaluatePolicy>[0],
          p.rules,
          context as unknown as Parameters<typeof evaluatePolicy>[2],
          sql,
          orgId,
          undefined as unknown as number,
        );
        const action_ = result?.action;
        if (action_ && (SEVERITY[action_] ?? 0) > (SEVERITY[worst] ?? 0)) worst = action_;
      }
      summary[worst as 'allow' | 'warn' | 'require_approval' | 'block']++;
    }

    return { available: true, sample_size: actions.length, window_days: days, summary, excluded_policy_types: excluded };
  } catch (err) {
    return {
      available: false,
      reason: `Friction preview unavailable: ${(err as Error).message}`,
    };
  }
}
