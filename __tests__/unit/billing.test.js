import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { estimateCost } from '@/lib/billing.js';

describe('estimateCost', () => {
  let warnSpy;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('returns 0 when model is missing (null/undefined/empty)', () => {
    // If we don't know the model we refuse to guess rather than invent a number —
    // a wrong guess retroactively prices every null-model row and poisons analytics.
    expect(estimateCost(1_000_000, 1_000_000, null)).toBe(0);
    expect(estimateCost(1_000_000, 1_000_000, undefined)).toBe(0);
    expect(estimateCost(1_000_000, 1_000_000, '')).toBe(0);
  });

  it('prices known models via the default pricing table', () => {
    // Opus 4.x family per Anthropic: $5 input + $25 output per 1M.
    expect(estimateCost(1_000_000, 1_000_000, 'claude-opus-4-6')).toBeCloseTo(30, 5);
    expect(estimateCost(1_000_000, 1_000_000, 'claude-sonnet-4-6')).toBeCloseTo(18, 5);
    // Haiku 4.5: $1 input + $5 output per 1M (was previously $0.80/$4 — corrected).
    expect(estimateCost(1_000_000, 1_000_000, 'haiku-4-5')).toBeCloseTo(6, 5);
  });

  it('prices Opus 4.8 at the current $5/$25 rate, not the legacy $15/$75 default', () => {
    // Regression: opus-4-8 was missing from DEFAULT_PRICING, so the lowercase
    // `includes('opus')` match fell through to the unversioned 'opus' legacy
    // default ($15/$75) — a 3x overcharge that inflated the claude-code agent's
    // 30d spend to ~$15.5k. Opus 4.x family rate is $5 input + $25 output / 1M.
    expect(estimateCost(1_000_000, 1_000_000, 'claude-opus-4-8')).toBeCloseTo(30, 5);
    expect(estimateCost(1_000_000, 1_000_000, 'claude-opus-4-8[1m]')).toBeCloseTo(30, 5);
  });

  it('returns 0 for unknown-but-present models and warns once per model', () => {
    // Prior behavior priced unknown models at Opus-tier rates as a "conservative
    // over-estimate", which inflated cheap open-source models ~1000x and poisoned
    // cost dashboards. Unknown now surfaces as $0 + an observable warn.
    expect(estimateCost(1_000_000, 1_000_000, 'some-future-model-2099')).toBe(0);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][1]).toBe('some-future-model-2099');
    // Second call for the same model should not re-warn.
    expect(estimateCost(500, 500, 'some-future-model-2099')).toBe(0);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('respects org-level custom pricing over defaults', () => {
    const custom = [{ pattern: 'my-model', input: 1, output: 2 }];
    expect(estimateCost(1_000_000, 1_000_000, 'my-model', custom)).toBeCloseTo(3, 5);
  });

  it('prices Claude Fable 5 at $10/$50 (LiteLLM claude-fable-5), incl. [1m] and datestamped ids', () => {
    // Regression: claude-fable-5 ran the whole fleet at $0 (3,218 actions /
    // 177M tokens uncosted) because no fable row existed anywhere.
    expect(estimateCost(1_000_000, 1_000_000, 'claude-fable-5')).toBeCloseTo(60, 5);
    expect(estimateCost(1_000_000, 1_000_000, 'claude-fable-5[1m]')).toBeCloseTo(60, 5);
    // Family fallback: a future point release matches the hand-curated
    // 'fable' family default instead of pricing at $0.
    expect(estimateCost(1_000_000, 1_000_000, 'claude-fable-6-20270101')).toBeCloseTo(60, 5);
  });

  it('prices GPT-5.5 at $5/$30 and keeps variants off the base rate', () => {
    expect(estimateCost(1_000_000, 1_000_000, 'gpt-5.5')).toBeCloseTo(35, 5);
    expect(estimateCost(1_000_000, 1_000_000, 'gpt-5.5-2026-04-23')).toBeCloseTo(35, 5);
    // Ordered substring matching: the pro row precedes the base row, so the
    // pro id must NOT price at the base $5/$30.
    expect(estimateCost(1_000_000, 1_000_000, 'gpt-5.5-pro')).toBeCloseTo(210, 5);
  });

  it('prices the gpt-5.4 family with mini/nano/pro resolved before the base pattern', () => {
    expect(estimateCost(1_000_000, 1_000_000, 'gpt-5.4')).toBeCloseTo(17.5, 5);
    expect(estimateCost(1_000_000, 1_000_000, 'gpt-5.4-mini-2026-03-17')).toBeCloseTo(5.25, 5);
    expect(estimateCost(1_000_000, 1_000_000, 'gpt-5.4-nano')).toBeCloseTo(1.45, 5);
    expect(estimateCost(1_000_000, 1_000_000, 'gpt-5.4-pro')).toBeCloseTo(210, 5);
  });

  it('resolves gpt-4.1 / gpt-4o / o3 variants to their own rates, not the base family row', () => {
    // Regression: REGISTRY previously listed base patterns before their
    // mini/nano variants, so 'gpt-4.1-mini' matched the 'gpt-4.1' row.
    expect(estimateCost(1_000_000, 1_000_000, 'gpt-4.1-mini')).toBeCloseTo(2, 5);
    expect(estimateCost(1_000_000, 1_000_000, 'gpt-4o-mini')).toBeCloseTo(0.75, 5);
    expect(estimateCost(1_000_000, 1_000_000, 'o3-mini')).toBeCloseTo(5.5, 5);
    expect(estimateCost(1_000_000, 1_000_000, 'o3-pro')).toBeCloseTo(100, 5);
  });
});
