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

// Wire-format tolerance (2026-07-01): raw-HTTP integrators send the natural
// JSON shapes; the validator normalizes them to the stored forms instead of
// rejecting with "rules must be a string" / "active must be an integer".
describe('validatePolicy — wire-format tolerance', () => {
  it('accepts rules as a plain object and normalizes it to a JSON string', () => {
    const r = validatePolicy({
      name: 'T', policy_type: 'block_action_type',
      rules: { action_types: ['deploy'] },
    });
    expect(r.valid).toBe(true);
    expect(typeof r.data.rules).toBe('string');
    expect(JSON.parse(r.data.rules)).toEqual({ action_types: ['deploy'] });
  });

  it('accepts active as a boolean and normalizes to 0/1', () => {
    const on = validatePolicy({ name: 'T', policy_type: 'block_action_type', rules: '{"action_types":["x"]}', active: true });
    const off = validatePolicy({ name: 'T', policy_type: 'block_action_type', rules: '{"action_types":["x"]}', active: false });
    expect(on.valid).toBe(true);
    expect(on.data.active).toBe(1);
    expect(off.valid).toBe(true);
    expect(off.data.active).toBe(0);
  });

  it('accepts agent_ids as an array and normalizes to a JSON string', () => {
    const r = validatePolicy({
      name: 'T', policy_type: 'block_action_type',
      rules: { action_types: ['x'] }, agent_ids: ['agent-1', 'agent-2'],
    });
    expect(r.valid).toBe(true);
    expect(JSON.parse(r.data.agent_ids)).toEqual(['agent-1', 'agent-2']);
  });

  it('legacy string/integer forms still validate unchanged', () => {
    const r = validatePolicy({
      name: 'T', policy_type: 'block_action_type',
      rules: '{"action_types":["x"]}', active: 1, agent_ids: '["agent-1"]',
    });
    expect(r.valid).toBe(true);
    expect(r.data.rules).toBe('{"action_types":["x"]}');
    expect(r.data.active).toBe(1);
  });

  it('still rejects genuinely wrong types (rules as number, active as string)', () => {
    expect(validatePolicy({ name: 'T', policy_type: 'block_action_type', rules: 42 }).valid).toBe(false);
    expect(validatePolicy({ name: 'T', policy_type: 'block_action_type', rules: '{"action_types":["x"]}', active: 'yes' }).valid).toBe(false);
  });

  it('object rules still hit the per-type validators (bad shape rejected)', () => {
    const r = validatePolicy({ name: 'T', policy_type: 'block_action_type', rules: {} });
    expect(r.valid).toBe(false);
  });
});
