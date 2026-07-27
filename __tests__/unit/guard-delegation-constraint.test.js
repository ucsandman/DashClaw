import { describe, it, expect } from 'vitest';
import { evaluatePolicy } from '@/lib/guard.js';

const policy = { id: 'p_dc', name: 'DC', policy_type: 'delegation_constraint' };
const ev = (rules, context, risk = 0) => evaluatePolicy(policy, rules, context, null, 'org_1', risk);

describe('delegation_constraint evaluator', () => {
  const base = { parent: 'claude-code', child_types: ['*'], escalate_action: 'require_approval' };

  it('is a hard no-op for non-composed callers', async () => {
    expect(await ev({ ...base, max_risk_score: 0 }, { agent_id: 'claude-code', action_type: 'deploy' }, 99)).toBeNull();
  });

  it('parent mismatch → no-op; wildcard parent matches', async () => {
    expect(await ev({ ...base, max_risk_score: 0 }, { agent_id: 'codex:explore' }, 50)).toBeNull();
    expect(await ev({ ...base, parent: '*', max_risk_score: 0 }, { agent_id: 'codex:explore' }, 50)).not.toBeNull();
  });

  it('child_types filters; * matches any', async () => {
    const r = { ...base, child_types: ['explore'], max_risk_score: 0 };
    expect(await ev(r, { agent_id: 'claude-code:explore' }, 50)).not.toBeNull();
    expect(await ev(r, { agent_id: 'claude-code:builder' }, 50)).toBeNull();
  });

  it('depth: a:b passes max_depth 1, a:b:c trips it', async () => {
    const r = { ...base, max_depth: 1 };
    expect(await ev(r, { agent_id: 'claude-code:explore' }, 0)).toBeNull();
    const hit = await ev(r, { agent_id: 'claude-code:explore:sub' }, 0);
    expect(hit.action).toBe('require_approval');
    expect(hit.reason).toMatch(/depth/i);
  });

  it('risk ceiling: at boundary passes, above trips', async () => {
    const r = { ...base, max_risk_score: 60 };
    expect(await ev(r, { agent_id: 'claude-code:explore' }, 60)).toBeNull();
    expect((await ev(r, { agent_id: 'claude-code:explore' }, 61)).reason).toMatch(/risk/i);
  });

  it('blocked_action_types and allowed_action_types', async () => {
    expect((await ev({ ...base, blocked_action_types: ['deploy'] }, { agent_id: 'claude-code:x', action_type: 'deploy' }, 0)).reason).toMatch(/deploy/);
    expect(await ev({ ...base, allowed_action_types: ['read'] }, { agent_id: 'claude-code:x', action_type: 'read' }, 0)).toBeNull();
    expect((await ev({ ...base, allowed_action_types: ['read'] }, { agent_id: 'claude-code:x', action_type: 'write' }, 0)).reason).toMatch(/write/);
  });

  it('blocked_path_globs uses protected_path semantics on target + write_paths', async () => {
    const r = { ...base, blocked_path_globs: ['**/.env*', 'prod/**'] };
    expect((await ev(r, { agent_id: 'claude-code:x', target: 'apps/web/.env.local' }, 0)).reason).toMatch(/\.env/);
    expect((await ev(r, { agent_id: 'claude-code:x', write_paths: ['prod/deploy.sh'] }, 0)).reason).toMatch(/prod/);
    expect(await ev(r, { agent_id: 'claude-code:x', target: 'docs/readme.md' }, 0)).toBeNull();
  });

  it('require_verified_parent fails closed on unverified', async () => {
    const r = { ...base, require_verified_parent: true };
    expect((await ev(r, { agent_id: 'claude-code:x', verification_status: 'unverified' }, 0)).reason).toMatch(/verif/i);
    expect(await ev(r, { agent_id: 'claude-code:x', verification_status: 'verified' }, 0)).toBeNull();
  });

  it('escalate_action block is honored; default is require_approval', async () => {
    expect((await ev({ ...base, escalate_action: 'block', max_risk_score: 0 }, { agent_id: 'claude-code:x' }, 1)).action).toBe('block');
    expect((await ev({ parent: '*', child_types: ['*'], max_risk_score: 0 }, { agent_id: 'a:b' }, 1)).action).toBe('require_approval');
  });

  it('constrains a composed id that has no identity row (base-fallback cannot defeat it)', async () => {
    // Pure string matching — no sql involved at all; the null sql client IS the proof.
    expect(await ev({ ...base, max_risk_score: 0 }, { agent_id: 'claude-code:unpaired-family' }, 50)).not.toBeNull();
  });
});
