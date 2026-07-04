import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { validateX402Purchase, validatePolicy, POLICY_TYPES } from '@/lib/validate.js';

const base = {
  agent_id: 'a1', provider: 'exa', declared_goal: 'research',
  purchase_reason: 'gap', context_gap: 'no data', expected_value: 'fresh sources',
};

describe('validateX402Purchase (R4)', () => {
  it('accepts a well-formed purchase and surfaces a clean numeric spend_amount', () => {
    const r = validateX402Purchase({ ...base, cost_estimate: 0.05, currency: 'usdc' });
    expect(r.valid).toBe(true);
    expect(r.data.spend_amount).toBe(0.05);
    expect(r.data.currency).toBe('USDC');
  });

  it('rejects missing required rationale fields', () => {
    const r = validateX402Purchase({ agent_id: 'a1', provider: 'exa' });
    expect(r.valid).toBe(false);
    expect(r.errors.join(' ')).toMatch(/declared_goal|purchase_reason|context_gap|expected_value/);
  });

  it('rejects a negative spend amount', () => {
    const r = validateX402Purchase({ ...base, cost_estimate: -5 });
    expect(r.valid).toBe(false);
    expect(r.errors.join(' ')).toMatch(/non-negative/i);
  });

  it('rejects Infinity and NaN spend amounts', () => {
    expect(validateX402Purchase({ ...base, spend_amount: Infinity }).valid).toBe(false);
    expect(validateX402Purchase({ ...base, spend_amount: 'not-a-number' }).valid).toBe(false);
  });

  it('rejects a malformed/oversized currency', () => {
    expect(validateX402Purchase({ ...base, cost_estimate: 1, currency: "'; DROP TABLE x402_purchases; --" }).valid).toBe(false);
  });

  it('rejects an oversized free-text field', () => {
    const r = validateX402Purchase({ ...base, cost_estimate: 1, purchase_reason: 'x'.repeat(5000) });
    expect(r.valid).toBe(false);
  });

  it('rejects a client risk_score outside 0-100', () => {
    expect(validateX402Purchase({ ...base, cost_estimate: 1, risk_score: 9999 }).valid).toBe(false);
  });
});

describe('x402 currency allow-list (v3.7 5b)', () => {
  beforeEach(() => { delete process.env.DASHCLAW_X402_CURRENCIES; });
  afterEach(() => { delete process.env.DASHCLAW_X402_CURRENCIES; });

  it('default allow-list accepts USDC in any case', () => {
    const r = validateX402Purchase({ ...base, cost_estimate: 1, currency: 'usdc' });
    expect(r.valid).toBe(true);
    expect(r.data.currency).toBe('USDC');
  });

  it('default allow-list rejects an unknown currency', () => {
    const r = validateX402Purchase({ ...base, cost_estimate: 1, currency: 'ZZ' });
    expect(r.valid).toBe(false);
    expect(r.errors.join(' ')).toMatch(/currency must be one of/i);
  });

  it('default allow-list rejects junk/injection strings', () => {
    const r = validateX402Purchase({ ...base, cost_estimate: 1, currency: "'; DROP TABLE x402_purchases; --" });
    expect(r.valid).toBe(false);
  });

  it('DASHCLAW_X402_CURRENCIES extends the allowed set', () => {
    process.env.DASHCLAW_X402_CURRENCIES = 'USDC,EUR';
    const r = validateX402Purchase({ ...base, cost_estimate: 1, currency: 'eur' });
    expect(r.valid).toBe(true);
    expect(r.data.currency).toBe('EUR');
  });

  it('DASHCLAW_X402_CURRENCIES with spaces around entries is handled', () => {
    process.env.DASHCLAW_X402_CURRENCIES = ' USDC , EUR , gbp ';
    expect(validateX402Purchase({ ...base, cost_estimate: 1, currency: 'gbp' }).valid).toBe(true);
    expect(validateX402Purchase({ ...base, cost_estimate: 1, currency: 'jpy' }).valid).toBe(false);
  });

  it('DASHCLAW_X402_CURRENCIES replaces (not appends to) the default set', () => {
    process.env.DASHCLAW_X402_CURRENCIES = 'EUR';
    expect(validateX402Purchase({ ...base, cost_estimate: 1, currency: 'usdc' }).valid).toBe(false);
    expect(validateX402Purchase({ ...base, cost_estimate: 1, currency: 'eur' }).valid).toBe(true);
  });
});

describe('x402 purchase idempotency_key (v3.7 5d)', () => {
  it('accepts an idempotency_key within the length cap', () => {
    const r = validateX402Purchase({ ...base, cost_estimate: 1, idempotency_key: 'key-123' });
    expect(r.valid).toBe(true);
    expect(r.data.idempotency_key).toBe('key-123');
  });

  it('rejects an idempotency_key exceeding the 256-char cap', () => {
    const r = validateX402Purchase({ ...base, cost_estimate: 1, idempotency_key: 'x'.repeat(257) });
    expect(r.valid).toBe(false);
  });

  it('is optional — a purchase without one validates as before', () => {
    const r = validateX402Purchase({ ...base, cost_estimate: 1 });
    expect(r.valid).toBe(true);
    expect(r.data.idempotency_key).toBeUndefined();
  });
});

describe('x402_spend_limit is an authorable policy type (B5)', () => {
  it('POLICY_TYPES includes x402_spend_limit', () => {
    expect(POLICY_TYPES).toContain('x402_spend_limit');
  });

  it('validatePolicy accepts a well-formed x402_spend_limit policy', () => {
    const r = validatePolicy({
      name: 'cap',
      policy_type: 'x402_spend_limit',
      rules: JSON.stringify({ max_spend_usd: 10, approval_threshold: 5, allowed_providers: ['exa'], blocked_providers: [] }),
    });
    expect(r.valid).toBe(true);
  });

  it('validatePolicy rejects x402_spend_limit with a non-numeric max_spend_usd', () => {
    const r = validatePolicy({
      name: 'bad',
      policy_type: 'x402_spend_limit',
      rules: JSON.stringify({ max_spend_usd: 'lots' }),
    });
    expect(r.valid).toBe(false);
  });
});

// Cumulative budget tier fields (owner roadmap item 2).
describe('x402_spend_limit budget rules validation', () => {
  const policyWith = (rules) => validatePolicy({ name: 'budget', policy_type: 'x402_spend_limit', rules: JSON.stringify(rules) });

  it('accepts a full budget rule set alongside the per-purchase caps', () => {
    const r = policyWith({
      max_spend_usd: 10, approval_threshold: 5,
      budget_usd: 50, budget_approval_threshold: 25, budget_window_days: 30, budget_scope: 'agent', on_failure: 'block',
    });
    expect(r.valid).toBe(true);
  });

  it('accepts budget_usd 0 (hard spend freeze)', () => {
    expect(policyWith({ budget_usd: 0 }).valid).toBe(true);
  });

  it('rejects negative / non-finite budget amounts', () => {
    expect(policyWith({ budget_usd: -1 }).valid).toBe(false);
    expect(policyWith({ budget_approval_threshold: 'lots' }).valid).toBe(false);
  });

  it('rejects budget_window_days outside 1-365 or non-integer', () => {
    expect(policyWith({ budget_usd: 5, budget_window_days: 0 }).valid).toBe(false);
    expect(policyWith({ budget_usd: 5, budget_window_days: 366 }).valid).toBe(false);
    expect(policyWith({ budget_usd: 5, budget_window_days: 7.5 }).valid).toBe(false);
    expect(policyWith({ budget_usd: 5, budget_window_days: 7 }).valid).toBe(true);
  });

  it('rejects an unknown budget_scope', () => {
    expect(policyWith({ budget_usd: 5, budget_scope: 'fleet' }).valid).toBe(false);
    expect(policyWith({ budget_usd: 5, budget_scope: 'org' }).valid).toBe(true);
  });

  it('rejects on_failure values outside the degradation contract (warn is not a degradation target)', () => {
    expect(policyWith({ budget_usd: 5, on_failure: 'warn' }).valid).toBe(false);
    expect(policyWith({ budget_usd: 5, on_failure: 'require_approval' }).valid).toBe(true);
  });
});
