import { describe, it, expect } from 'vitest';
import { ratesForPattern, buildPricingTables, replaceBlock, REGISTRY } from '../../scripts/refresh-model-pricing.mjs';

// Fixture mirrors a real LiteLLM payload shape — per-token rates as floats,
// optional cache columns, the litellm_provider tag we don't currently use.
const FIXTURE = {
  'claude-fable-5': {
    input_cost_per_token: 0.00001,
    output_cost_per_token: 0.00005,
    cache_creation_input_token_cost: 0.0000125,
    cache_read_input_token_cost: 0.000001,
    litellm_provider: 'anthropic',
  },
  'gpt-5.5-2026-04-23': {
    input_cost_per_token: 0.000005,
    output_cost_per_token: 0.00003,
    cache_read_input_token_cost: 0.0000005,
    litellm_provider: 'openai',
  },
  'claude-opus-4-8': {
    input_cost_per_token: 0.000005,
    output_cost_per_token: 0.000025,
    cache_creation_input_token_cost: 0.00000625,
    cache_read_input_token_cost: 0.0000005,
    litellm_provider: 'anthropic',
  },
  'claude-opus-4-7': {
    input_cost_per_token: 0.000005,
    output_cost_per_token: 0.000025,
    cache_creation_input_token_cost: 0.00000625,
    cache_read_input_token_cost: 0.0000005,
    litellm_provider: 'anthropic',
  },
  'claude-opus-4-5': {
    input_cost_per_token: 0.000005,
    output_cost_per_token: 0.000025,
    cache_creation_input_token_cost: 0.00000625,
    cache_read_input_token_cost: 0.0000005,
    litellm_provider: 'anthropic',
  },
  'claude-opus-4-1-20250805': {
    input_cost_per_token: 0.000015,
    output_cost_per_token: 0.000075,
    cache_creation_input_token_cost: 0.00001875,
    cache_read_input_token_cost: 0.0000015,
    litellm_provider: 'anthropic',
  },
  'claude-sonnet-4-5': {
    input_cost_per_token: 0.000003,
    output_cost_per_token: 0.000015,
    cache_creation_input_token_cost: 0.00000375,
    cache_read_input_token_cost: 0.0000003,
    litellm_provider: 'anthropic',
  },
  'claude-haiku-4-5': {
    input_cost_per_token: 0.000001,
    output_cost_per_token: 0.000005,
    cache_creation_input_token_cost: 0.00000125,
    cache_read_input_token_cost: 0.0000001,
    litellm_provider: 'anthropic',
  },
  // OpenAI-shape entries don't have cache columns; the mapper must still
  // produce a valid row with cache rates of 0.
  'gpt-4o-2024-08-06': {
    input_cost_per_token: 0.0000025,
    output_cost_per_token: 0.00001,
    litellm_provider: 'openai',
  },
  // A bogus entry that should be skipped (zero rates → placeholder).
  'placeholder-embed-model': {
    input_cost_per_token: 0,
    output_cost_per_token: 0,
    litellm_provider: 'unknown',
  },
};

describe('refresh-model-pricing — ratesForPattern', () => {
  it('converts per-token to per-million and rounds to 4 decimals', () => {
    const r = ratesForPattern(FIXTURE, ['claude-opus-4-7']);
    expect(r).not.toBeNull();
    expect(r.input).toBe(5);
    expect(r.output).toBe(25);
    expect(r.cache_write).toBe(6.25);
    expect(r.cache_read).toBe(0.5);
    expect(r.sourceKey).toBe('claude-opus-4-7');
  });

  it('falls through to the next candidate when the first is missing', () => {
    const r = ratesForPattern(FIXTURE, ['claude-opus-4-99-doesnotexist', 'claude-opus-4-7']);
    expect(r.sourceKey).toBe('claude-opus-4-7');
  });

  it('skips placeholder entries with zero input AND zero output', () => {
    const r = ratesForPattern(FIXTURE, ['placeholder-embed-model']);
    expect(r).toBeNull();
  });

  it('returns null when no candidates match', () => {
    const r = ratesForPattern(FIXTURE, ['nope-1', 'nope-2']);
    expect(r).toBeNull();
  });

  it('handles entries with no cache columns by defaulting them to 0', () => {
    const r = ratesForPattern(FIXTURE, ['gpt-4o-2024-08-06']);
    expect(r.input).toBe(2.5);
    expect(r.output).toBe(10);
    expect(r.cache_write).toBe(0);
    expect(r.cache_read).toBe(0);
  });
});

describe('refresh-model-pricing — buildPricingTables', () => {
  it('produces a billing.js row per REGISTRY pattern that has a LiteLLM source', () => {
    const { billing, claudeCode, skipped } = buildPricingTables(FIXTURE);
    const opus47 = billing.find(b => b.pattern === 'opus-4-7');
    expect(opus47).toBeDefined();
    expect(opus47.input).toBe(5);
    expect(opus47.output).toBe(25);
    expect(opus47.cache_write).toBe(6.25);
    expect(opus47.cache_read).toBe(0.5);
    expect(opus47.label).toBe('Claude Opus 4.7');
    expect(opus47._source).toBe('claude-opus-4-7');

    // OpenAI entries land in billing.js, not in claude-code/pricing.js
    const gpt4o = billing.find(b => b.pattern === 'gpt-4o');
    expect(gpt4o).toBeDefined();
    expect(claudeCode['claude-gpt-4o']).toBeUndefined();

    // pricing.js gets the Anthropic 'claude-<pattern>' keys
    expect(claudeCode['claude-opus-4-7']).toBeDefined();
    expect(claudeCode['claude-opus-4-7'].input).toBe(5);

    // 1m mirror exists for opus-4-7
    expect(claudeCode['claude-opus-4-7[1m]']).toEqual(claudeCode['claude-opus-4-7']);

    // opus-4-8 is the current frontier Opus — it must be priced at the 4.x
    // family rate ($5/$25) with its own [1m] mirror, else heavy claude-code
    // usage falls through to the legacy 'opus' default ($15/$75) and inflates
    // 3x. Regression guard for the ~$15.5k spend bug.
    expect(claudeCode['claude-opus-4-8']).toBeDefined();
    expect(claudeCode['claude-opus-4-8'].input).toBe(5);
    expect(claudeCode['claude-opus-4-8'].output).toBe(25);
    expect(claudeCode['claude-opus-4-8[1m]']).toEqual(claudeCode['claude-opus-4-8']);

    // haiku-4-5 has a date-stamped mirror
    expect(claudeCode['claude-haiku-4-5-20251001']).toEqual(claudeCode['claude-haiku-4-5']);

    // fable-5 reaches the claude-code card too (the emission predicate must
    // include the fable family) with its own [1m] long-context mirror —
    // the in-the-wild id is `claude-fable-5[1m]`.
    expect(claudeCode['claude-fable-5']).toBeDefined();
    expect(claudeCode['claude-fable-5'].input).toBe(10);
    expect(claudeCode['claude-fable-5'].output).toBe(50);
    expect(claudeCode['claude-fable-5[1m]']).toEqual(claudeCode['claude-fable-5']);

    // gpt-5.5 lands in billing only, sourced from the date-stamped key.
    const gpt55 = billing.find(b => b.pattern === 'gpt-5.5');
    expect(gpt55).toBeDefined();
    expect(gpt55.input).toBe(5);
    expect(gpt55.output).toBe(30);
    expect(gpt55._source).toBe('gpt-5.5-2026-04-23');
    expect(claudeCode['claude-gpt-5.5']).toBeUndefined();

    // Patterns without a LiteLLM source land in `skipped`, not in `billing`.
    const skippedPatterns = new Set(skipped.map(s => s.pattern));
    expect(skipped.length).toBeGreaterThan(0);
    expect(skippedPatterns.has('gpt-4.1-nano')).toBe(true); // not in fixture
  });

  it('REGISTRY covers all the families that DashClaw prices today', () => {
    const patterns = Object.keys(REGISTRY);
    // Sanity: every family we surface in the UI is in the registry.
    expect(patterns).toContain('fable-5');
    expect(patterns).toContain('gpt-5.5');
    expect(patterns).toContain('gpt-5.4');
    // Ordering trap guard: estimateCost matches by ordered substring, so the
    // base pattern must come AFTER its pro/mini/nano variants.
    expect(patterns.indexOf('gpt-5.5-pro')).toBeLessThan(patterns.indexOf('gpt-5.5'));
    expect(patterns.indexOf('gpt-5.4-mini')).toBeLessThan(patterns.indexOf('gpt-5.4'));
    expect(patterns.indexOf('gpt-4.1-mini')).toBeLessThan(patterns.indexOf('gpt-4.1'));
    expect(patterns.indexOf('gpt-4o-mini')).toBeLessThan(patterns.indexOf('gpt-4o'));
    expect(patterns.indexOf('o3-mini')).toBeLessThan(patterns.indexOf('o3'));
    expect(patterns).toContain('opus-4-8');
    expect(patterns).toContain('opus-4-7');
    expect(patterns).toContain('opus-4-5');
    expect(patterns).toContain('opus-4-1');
    expect(patterns).toContain('sonnet-4-6');
    expect(patterns).toContain('haiku-4-5');
    expect(patterns).toContain('gpt-4o');
    expect(patterns).toContain('gemini-2.5-pro');
  });
});

describe('refresh-model-pricing — replaceBlock', () => {
  it('replaces only the block between the markers', () => {
    const src = [
      'before unchanged',
      '// MODEL_PRICING_GENERATED:BILLING:START',
      'old block',
      '// MODEL_PRICING_GENERATED:BILLING:END',
      'after unchanged',
    ].join('\n');
    const out = replaceBlock(src, 'BILLING', 'NEW BLOCK LINE');
    expect(out).toContain('before unchanged');
    expect(out).toContain('after unchanged');
    expect(out).toContain('NEW BLOCK LINE');
    expect(out).not.toContain('old block');
  });

  it('throws if markers are missing — refuses silent no-op', () => {
    expect(() => replaceBlock('no markers here', 'BILLING', 'x')).toThrow(/Markers/);
  });
});
