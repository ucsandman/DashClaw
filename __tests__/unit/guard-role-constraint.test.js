import { describe, it, expect } from 'vitest';
import { evaluatePolicy } from '@/lib/guard.js';

const policy = { id: 'p_rc', name: 'Reviewer', policy_type: 'role_constraint' };
const ev = (rules, context, risk = 0) => evaluatePolicy(policy, rules, context, null, 'org_1', risk);

describe('role_constraint evaluator', () => {
  it('empty rules are a no-op for any caller', async () => {
    expect(await ev({}, { agent_id: 'claude-code', action_type: 'deploy' }, 99)).toBeNull();
  });

  it('fires for plain top-level agents (no composed-id gate)', async () => {
    const hit = await ev({ max_risk_score: 0 }, { agent_id: 'claude-code', action_type: 'read' }, 50);
    expect(hit.action).toBe('require_approval');
    expect(hit.reason).toMatch(/risk/i);
  });

  it('blocked_action_types trips and names the role', async () => {
    const hit = await ev({ blocked_action_types: ['deploy'] }, { agent_id: 'a1', action_type: 'deploy' }, 0);
    expect(hit.reason).toMatch(/deploy/);
    expect(hit.reason).toMatch(/Reviewer/);
  });

  it('allowed_action_types: inside passes, outside escalates', async () => {
    const r = { allowed_action_types: ['file_read', 'code_review'] };
    expect(await ev(r, { agent_id: 'a1', action_type: 'file_read' }, 0)).toBeNull();
    const hit = await ev(r, { agent_id: 'a1', action_type: 'deploy' }, 0);
    expect(hit.action).toBe('require_approval');
    expect(hit.reason).toMatch(/allowlist/i);
  });

  it('missing action_type does not trip the allowlist', async () => {
    expect(await ev({ allowed_action_types: ['file_read'] }, { agent_id: 'a1' }, 0)).toBeNull();
  });

  it('risk ceiling: at boundary passes, above trips', async () => {
    const r = { max_risk_score: 60 };
    expect(await ev(r, { agent_id: 'a1' }, 60)).toBeNull();
    expect((await ev(r, { agent_id: 'a1' }, 61)).reason).toMatch(/ceiling/i);
  });

  it('blocked_path_globs uses protected_path semantics on target + write_paths', async () => {
    const r = { blocked_path_globs: ['**/.env*', 'infra/**'] };
    expect((await ev(r, { agent_id: 'a1', target: 'apps/web/.env.local' }, 0)).reason).toMatch(/\.env/);
    expect((await ev(r, { agent_id: 'a1', write_paths: ['infra/deploy.sh'] }, 0)).reason).toMatch(/infra/);
    expect(await ev(r, { agent_id: 'a1', target: 'docs/readme.md' }, 0)).toBeNull();
  });

  it('escalate_action block is honored; default is require_approval', async () => {
    expect((await ev({ escalate_action: 'block', max_risk_score: 0 }, { agent_id: 'a1' }, 1)).action).toBe('block');
    expect((await ev({ max_risk_score: 0 }, { agent_id: 'a1' }, 1)).action).toBe('require_approval');
  });

  it('also constrains composed callers (membership is row scoping, not evaluator matching)', async () => {
    expect((await ev({ blocked_action_types: ['deploy'] }, { agent_id: 'claude-code:sub', action_type: 'deploy' }, 0)).action).toBe('require_approval');
  });

  it('tighten-only: never returns allow/warn', async () => {
    const hit = await ev({ allowed_action_types: ['read'], escalate_action: 'block' }, { agent_id: 'a1', action_type: 'write' }, 0);
    expect(['require_approval', 'block']).toContain(hit.action);
  });
});
