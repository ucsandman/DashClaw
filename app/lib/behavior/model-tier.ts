/**
 * Deterministic model → capability-tier classification for the
 * model/task-mismatch analyzer rule. Tiers, cheapest first:
 *   cheap   (haiku / *-mini / *-nano / *-flash)
 *   mid     (sonnet / gpt-4o)
 *   frontier(opus / o3 / gpt-4.1)
 *   unknown (not recognized — never flagged, to avoid false positives)
 *
 * Uses the pricing registry as a tiebreaker for recognized-but-unnamed models,
 * but a model absent from the registry stays `unknown` rather than inheriting
 * the sonnet-shaped FALLBACK, so we never warn on a model we can't price.
 */

import { PRICES_PER_MTOK } from '../claude-code/pricing';

export type ModelTier = 'unknown' | 'cheap' | 'mid' | 'frontier';

export const TIER_RANK: Readonly<Record<ModelTier, number>> = Object.freeze({
  unknown: 0,
  cheap: 1,
  mid: 2,
  frontier: 3,
});

/** Strip a model alias suffix like `[1m]`. */
function stripAlias(model: unknown): string {
  return String(model || '').replace(/\[[^\]]*\]$/, '').trim();
}

/** Classify a model string into a capability tier. */
export function modelTier(model: unknown): ModelTier {
  const m = stripAlias(model).toLowerCase();
  if (!m) return 'unknown';

  // Name heuristics first — they are the strongest signal and provider-agnostic.
  if (/haiku|-mini|-nano|flash/.test(m)) return 'cheap';
  if (/opus|gpt-4\.1(?!-mini|-nano)|(^|[^a-z])o3([^a-z]|$)/.test(m)) return 'frontier';
  if (/sonnet|gpt-4o(?!-mini)/.test(m)) return 'mid';

  // Recognized-but-unnamed model: lean on its output price.
  const stripped = stripAlias(model);
  const price = PRICES_PER_MTOK[stripped] || PRICES_PER_MTOK[m];
  if (price) {
    if (price.output >= 20) return 'frontier';
    if (price.output >= 10) return 'mid';
    return 'cheap';
  }
  return 'unknown';
}

export function tierRank(model: unknown): number {
  return TIER_RANK[modelTier(model)] ?? 0;
}

/**
 * True when `model` is a known tier strictly below `minTier`. Unknown models
 * return false (never flagged).
 */
export function isBelowTier(model: unknown, minTier: ModelTier = 'mid'): boolean {
  const rank = tierRank(model);
  if (rank === 0) return false; // unknown — do not flag
  return rank < (TIER_RANK[minTier] ?? TIER_RANK.mid);
}
