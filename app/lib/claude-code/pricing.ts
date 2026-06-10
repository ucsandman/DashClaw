/**
 * Claude Code session pricing — 4-column per-model rates (input, output,
 * cache_write, cache_read) in USD per 1M tokens.
 *
 * Distinct from `app/lib/billing.ts` which prices `action_records` rows with a
 * 2-column table and an unknown-model contract of $0. This module is
 * analytics-only and falls back to a Sonnet-tier rate for unknown models so the
 * Code Sessions surface can still show cache-aware totals. These intentional
 * differences are guarded by `__tests__/unit/rate-card-parity.test`.
 *
 * Ported from AgentLens (`src/pricing.js`) — CommonJS → ESM. No DB. No HTTP. No fs.
 */

import type { ModelPricingEntry } from '../types/pricing-finops';

// Pricing source: LiteLLM's community-maintained JSON, normalised by
// `npm run pricing:refresh`. The block between the GENERATED markers below
// is rewritten automatically — review the diff before committing. Anything
// outside the markers (FALLBACK below, surrounding logic) stays hand-curated.
export const PRICES_PER_MTOK: Readonly<Record<string, ModelPricingEntry>> = Object.freeze({
  // MODEL_PRICING_GENERATED:PRICING:START
  'claude-fable-5'                : { input: 10.00, output: 50.00, cache_write: 12.50, cache_read: 1.00 }, // claude-fable-5
  'claude-fable-5[1m]'            : { input: 10.00, output: 50.00, cache_write: 12.50, cache_read: 1.00 }, // claude-fable-5
  'claude-opus-4-8'               : { input: 5.00, output: 25.00, cache_write: 6.25, cache_read: 0.50 }, // claude-opus-4-8
  'claude-opus-4-8[1m]'           : { input: 5.00, output: 25.00, cache_write: 6.25, cache_read: 0.50 }, // claude-opus-4-8
  'claude-opus-4-7'               : { input: 5.00, output: 25.00, cache_write: 6.25, cache_read: 0.50 }, // claude-opus-4-7
  'claude-opus-4-7[1m]'           : { input: 5.00, output: 25.00, cache_write: 6.25, cache_read: 0.50 }, // claude-opus-4-7
  'claude-opus-4-6'               : { input: 5.00, output: 25.00, cache_write: 6.25, cache_read: 0.50 }, // claude-opus-4-6
  'claude-opus-4-5'               : { input: 5.00, output: 25.00, cache_write: 6.25, cache_read: 0.50 }, // claude-opus-4-5
  'claude-opus-4-1'               : { input: 15.00, output: 75.00, cache_write: 18.75, cache_read: 1.50 }, // claude-opus-4-1-20250805
  'claude-sonnet-4-6'             : { input: 3.00, output: 15.00, cache_write: 3.75, cache_read: 0.30 }, // claude-sonnet-4-6
  'claude-sonnet-4-5'             : { input: 3.00, output: 15.00, cache_write: 3.75, cache_read: 0.30 }, // claude-sonnet-4-5-20250929
  'claude-haiku-4-5'              : { input: 1.00, output: 5.00, cache_write: 1.25, cache_read: 0.10 }, // claude-haiku-4-5-20251001
  'claude-haiku-4-5-20251001'     : { input: 1.00, output: 5.00, cache_write: 1.25, cache_read: 0.10 }, // claude-haiku-4-5-20251001
// MODEL_PRICING_GENERATED:PRICING:END
});

export const FALLBACK: ModelPricingEntry = { input: 3.00, output: 15.00, cache_write: 3.75, cache_read: 0.30 };

export function priceFor(model: string | null | undefined): ModelPricingEntry {
  if (!model) return FALLBACK;
  const direct = PRICES_PER_MTOK[model];
  if (direct) return direct;
  const stripped = String(model).replace(/\[[^\]]*\]$/, '');
  return PRICES_PER_MTOK[stripped] || FALLBACK;
}

export interface CacheUsageInput {
  input_tokens?: number | string;
  output_tokens?: number | string;
  cache_creation_input_tokens?: number | string;
  cache_read_input_tokens?: number | string;
}

export function costForUsage(model: string | null | undefined, usage: CacheUsageInput | null | undefined): number {
  const p = priceFor(model);
  const i = Number(usage?.input_tokens) || 0;
  const o = Number(usage?.output_tokens) || 0;
  const cw = Number(usage?.cache_creation_input_tokens) || 0;
  const cr = Number(usage?.cache_read_input_tokens) || 0;
  return (
    (i * p.input + o * p.output + cw * (p.cache_write ?? 0) + cr * (p.cache_read ?? 0)) / 1_000_000
  );
}

export function cacheSavingsForUsage(model: string | null | undefined, usage: CacheUsageInput | null | undefined): number {
  const p = priceFor(model);
  const cr = Number(usage?.cache_read_input_tokens) || 0;
  return (cr * (p.input - (p.cache_read ?? 0))) / 1_000_000;
}

export function cacheHitRate(totals: { input_tokens?: number; cache_creation_tokens?: number; cache_read_tokens?: number }): number {
  const i = totals.input_tokens || 0;
  const cw = totals.cache_creation_tokens || 0;
  const cr = totals.cache_read_tokens || 0;
  const denom = i + cw + cr;
  if (!denom) return 0;
  return cr / denom;
}

export function formatUSD(n: number): string {
  return `$${(Math.round(n * 100) / 100).toFixed(2)}`;
}
