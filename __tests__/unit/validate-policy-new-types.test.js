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

describe('validatePolicy — delegation_constraint', () => {
  it('accepts a full valid rules object', () => {
    const r = validatePolicy(base('delegation_constraint', {
      parent: 'claude-code',
      child_types: ['explore', 'builder'],
      max_risk_score: 60,
      allowed_action_types: ['read'],
      blocked_action_types: ['deploy'],
      blocked_path_globs: ['**/.env*', 'prod/**'],
      max_depth: 2,
      escalate_action: 'require_approval',
      require_verified_parent: true,
    }));
    expect(r.valid).toBe(true);
  });

  it('accepts an empty rules object (every field optional)', () => {
    const r = validatePolicy(base('delegation_constraint', {}));
    expect(r.valid).toBe(true);
  });

  it('rejects escalate_action: allow (attenuation only tightens)', () => {
    const r = validatePolicy(base('delegation_constraint', { escalate_action: 'allow' }));
    expect(r.valid).toBe(false);
  });

  it('rejects max_risk_score above 100', () => {
    const r = validatePolicy(base('delegation_constraint', { max_risk_score: 101 }));
    expect(r.valid).toBe(false);
  });

  it('rejects max_risk_score below 0', () => {
    const r = validatePolicy(base('delegation_constraint', { max_risk_score: -1 }));
    expect(r.valid).toBe(false);
  });

  it('rejects blocked_path_globs containing a non-string', () => {
    const r = validatePolicy(base('delegation_constraint', { blocked_path_globs: ['prod/**', 123] }));
    expect(r.valid).toBe(false);
  });

  it('rejects child_types: [] (must be non-empty when present)', () => {
    const r = validatePolicy(base('delegation_constraint', { child_types: [] }));
    expect(r.valid).toBe(false);
  });

  it('leaves unknown-type behavior unchanged (a genuinely unknown policy_type still 400s)', () => {
    const r = validatePolicy(base('not_a_real_policy_type', { parent: '*' }));
    expect(r.valid).toBe(false);
  });
});
