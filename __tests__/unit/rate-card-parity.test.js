import { describe, it, expect } from 'vitest';
import { estimateCost } from '@/lib/billing.js';
import { PRICES_PER_MTOK, priceFor } from '@/lib/claude-code/pricing.js';

// billing.js is canonical for STORED cost (both action_records.cost_estimate and
// code_sessions.cost_usd run through estimateCost). claude-code/pricing.js is
// analytics-only (rules engine + per-message breakdown). They share one
// LiteLLM-generated price block; this test fails the build if they drift.

// Probe billing.js's effective 4-column rate via its real matching logic:
// 1M tokens on one axis → that axis's USD/MTok rate.
function billingRate(model) {
  const M = 1_000_000;
  return {
    input: estimateCost(M, 0, model),
    output: estimateCost(0, M, model),
    cache_write: estimateCost(0, 0, model, null, { cache_creation_tokens: M, cache_read_tokens: 0 }),
    cache_read: estimateCost(0, 0, model, null, { cache_creation_tokens: 0, cache_read_tokens: M }),
  };
}

describe('rate-card parity: billing.js ↔ claude-code/pricing.js', () => {
  const claudeKeys = Object.keys(PRICES_PER_MTOK);

  it('covers at least the current frontier Claude models', () => {
    expect(claudeKeys.length).toBeGreaterThanOrEqual(8);
  });

  it.each(claudeKeys)('agrees on all 4 columns for %s', (model) => {
    const p = priceFor(model);
    const b = billingRate(model);
    expect(b.input).toBeCloseTo(p.input, 6);
    expect(b.output).toBeCloseTo(p.output, 6);
    expect(b.cache_write).toBeCloseTo(p.cache_write, 6);
    expect(b.cache_read).toBeCloseTo(p.cache_read, 6);
  });

  // Reverse guard: a frontier model must be priced (non-zero) by billing.js too,
  // so an alias added only to one card can't silently fall back.
  it.each(['claude-fable-5', 'claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5'])(
    'billing.js prices %s (no $0 / Sonnet-fallback drift)',
    (model) => {
      expect(PRICES_PER_MTOK[model]).toBeDefined();
      expect(estimateCost(1_000_000, 0, model)).toBeGreaterThan(0);
    },
  );
});
