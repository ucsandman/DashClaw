import { describe, expect, it } from 'vitest';
import { validatePolicy } from '@/lib/validate.js';

const base = (policy_type, rules) => ({
  name: 'T',
  policy_type,
  rules: JSON.stringify(rules),
});

describe('validatePolicy — warn_action_type', () => {
  it('accepts a valid action_types array', () => {
    const r = validatePolicy(base('warn_action_type', { action_types: ['api', 'sync'] }));
    expect(r.valid).toBe(true);
  });
  it('rejects a missing action_types array', () => {
    const r = validatePolicy(base('warn_action_type', {}));
    expect(r.valid).toBe(false);
  });
});

describe('validatePolicy — allow_grant', () => {
  it('accepts action_type with target_prefix', () => {
    const r = validatePolicy(base('allow_grant', { action_type: 'api', target_prefix: 'stripe.com' }));
    expect(r.valid).toBe(true);
  });
  it('accepts action_type without target_prefix', () => {
    const r = validatePolicy(base('allow_grant', { action_type: 'sync' }));
    expect(r.valid).toBe(true);
  });
  it('rejects missing action_type', () => {
    const r = validatePolicy(base('allow_grant', { target_prefix: 'x' }));
    expect(r.valid).toBe(false);
  });
  it('rejects empty target_prefix', () => {
    const r = validatePolicy(base('allow_grant', { action_type: 'api', target_prefix: '' }));
    expect(r.valid).toBe(false);
  });
});
