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
  it('accepts null target_prefix (treated as absent)', () => {
    const r = validatePolicy(base('allow_grant', { action_type: 'api', target_prefix: null }));
    expect(r.valid).toBe(true);
  });
});

// Regression: the policy_type chooses a validator via POLICY_TYPE_VALIDATORS[key]
// (CodeQL js/unvalidated-dynamic-method-call). An inherited Object/Function
// property name must never be invoked as a validator; such a policy_type is
// rejected as invalid and must not throw. (Defense-in-depth: the schema enum
// also rejects these; the own-property guard ensures the dynamic call is safe
// even if a non-enum value ever reached it.)
describe('validatePolicy — dynamic validator key allow-list', () => {
  for (const protoKey of ['constructor', 'toString', 'hasOwnProperty', '__proto__', 'valueOf']) {
    it(`rejects inherited property key "${protoKey}" without invoking it`, () => {
      let r;
      expect(() => { r = validatePolicy(base(protoKey, {})); }).not.toThrow();
      expect(r.valid).toBe(false);
    });
  }
});
