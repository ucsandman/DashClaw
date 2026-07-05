import { describe, it, expect } from 'vitest';
import {
  RULE_KINDS, decideSample, detectReloadLoops, detectFailureLoops,
  behaviorRuleToGuardPolicy, isEnforceable, ENFORCEABLE_KINDS,
} from '@/lib/behavior/policy-model.js';

const base = (over) => ({ event_id: 'e', ts: '2026-06-01T10:00:00Z', agent_id: 'a', tool: 'Bash', ...over });

describe('behavior/policy-model decideSample', () => {
  it('destructive_command: gates at/above the risk threshold, allows below', () => {
    const rule = { kind: RULE_KINDS.DESTRUCTIVE_COMMAND_APPROVAL, action: 'require_approval', risk_threshold: 70 };
    expect(decideSample(rule, base({ risk_score: 90 }))).toBe('require_approval');
    expect(decideSample(rule, base({ risk_score: 50 }))).toBe('allow');
  });

  it('protected_path: gates writes that match the globs', () => {
    const rule = { kind: RULE_KINDS.PROTECTED_PATH_APPROVAL, action: 'require_approval', paths: ['**/auth/**'] };
    expect(decideSample(rule, base({ tool: 'Write', write_paths: ['app/api/auth/route.js'] }))).toBe('require_approval');
    expect(decideSample(rule, base({ tool: 'Write', write_paths: ['app/page.js'] }))).toBe('allow');
  });

  it('model_task_mismatch: warns on cheap model + heavy task, allows otherwise', () => {
    const rule = { kind: RULE_KINDS.MODEL_TASK_MISMATCH_WARN, action: 'warn', min_tier: 'mid' };
    expect(decideSample(rule, base({ model: 'claude-haiku-4-5', declared_goal: 'refactor the module', action_type: 'refactor' }))).toBe('warn');
    expect(decideSample(rule, base({ model: 'claude-opus-4-8', declared_goal: 'refactor the module', action_type: 'refactor' }))).toBe('allow');
    expect(decideSample(rule, base({ model: null, declared_goal: 'refactor the module', action_type: 'refactor' }))).toBe('allow');
  });

  it('agent_allowlist: warns on an action type outside the envelope, allows inside', () => {
    const rule = { kind: RULE_KINDS.AGENT_ALLOWLIST, action: 'warn', allow: { tools: ['Read'], action_types: ['review', 'read'], command_verbs: [] } };
    expect(decideSample(rule, base({ action_type: 'deploy' }))).toBe('warn'); // novel → fires
    expect(decideSample(rule, base({ action_type: 'review' }))).toBe('allow'); // inside envelope
    expect(decideSample(rule, base({ action_type: undefined }))).toBe('allow'); // unknown → never flag
  });

  it('agent_allowlist: never fires when the envelope has no action types', () => {
    const rule = { kind: RULE_KINDS.AGENT_ALLOWLIST, action: 'warn', allow: { tools: ['Read'], action_types: [], command_verbs: [] } };
    expect(decideSample(rule, base({ action_type: 'deploy' }))).toBe('allow');
  });
});

describe('behavior/policy-model loop detectors', () => {
  it('detectReloadLoops flags repeated reads of the same file in-window', () => {
    const samples = [
      base({ event_id: 'r1', tool: 'Read', read_paths: ['x.js'], ts: '2026-06-01T10:00:00Z' }),
      base({ event_id: 'r2', tool: 'Read', read_paths: ['x.js'], ts: '2026-06-01T10:02:00Z' }),
      base({ event_id: 'r3', tool: 'Read', read_paths: ['x.js'], ts: '2026-06-01T10:04:00Z' }),
    ];
    const flagged = detectReloadLoops(samples, { maxReloads: 3, windowMinutes: 15 });
    expect(flagged.size).toBe(3);
  });

  it('detectReloadLoops resets after an intervening write to the file', () => {
    const samples = [
      base({ event_id: 'r1', tool: 'Read', read_paths: ['x.js'], ts: '2026-06-01T10:00:00Z' }),
      base({ event_id: 'r2', tool: 'Read', read_paths: ['x.js'], ts: '2026-06-01T10:02:00Z' }),
      base({ event_id: 'w1', tool: 'Write', write_paths: ['x.js'], ts: '2026-06-01T10:03:00Z' }),
      base({ event_id: 'r3', tool: 'Read', read_paths: ['x.js'], ts: '2026-06-01T10:04:00Z' }),
    ];
    const flagged = detectReloadLoops(samples, { maxReloads: 3, windowMinutes: 15 });
    expect(flagged.size).toBe(0);
  });

  it('detectFailureLoops flags repeated failures of the same command', () => {
    const samples = [
      base({ event_id: 'f1', command_shape: 'npm run build', outcome_status: 'failed', ts: '2026-06-01T10:00:00Z' }),
      base({ event_id: 'f2', command_shape: 'npm run build', outcome_status: 'failed', ts: '2026-06-01T10:05:00Z' }),
      base({ event_id: 'f3', command_shape: 'npm run build', outcome_status: 'failed', ts: '2026-06-01T10:10:00Z' }),
      base({ event_id: 'ok', command_shape: 'npm run build', outcome_status: 'completed', ts: '2026-06-01T10:11:00Z' }),
    ];
    const flagged = detectFailureLoops(samples, { maxFailures: 3, windowMinutes: 30 });
    expect(flagged.size).toBe(3);
    expect(flagged.has('ok')).toBe(false);
  });
});

describe('behavior/policy-model guard mapping', () => {
  it('maps destructive_command to a risk_threshold guard policy', () => {
    const rule = { kind: RULE_KINDS.DESTRUCTIVE_COMMAND_APPROVAL, action: 'require_approval', risk_threshold: 75 };
    const p = behaviorRuleToGuardPolicy(rule, { agentId: 'a' });
    expect(p.policy_type).toBe('risk_threshold');
    expect(p.rules).toEqual({ threshold: 75, action: 'require_approval' });
    expect(p.agent_ids).toBe('["a"]');
  });

  it('maps protected_path to a protected_path guard policy', () => {
    const rule = { kind: RULE_KINDS.PROTECTED_PATH_APPROVAL, action: 'require_approval', paths: ['**/auth/**'] };
    const p = behaviorRuleToGuardPolicy(rule, { agentId: 'a' });
    expect(p.policy_type).toBe('protected_path');
    expect(p.rules.paths).toEqual(['**/auth/**']);
  });

  it('maps agent_allowlist to an agent_allowlist guard policy', () => {
    const rule = { kind: RULE_KINDS.AGENT_ALLOWLIST, action: 'warn', allow: { tools: ['Read'], action_types: ['review', 'read'], command_verbs: [] } };
    const p = behaviorRuleToGuardPolicy(rule, { agentId: 'a' });
    expect(p.policy_type).toBe('agent_allowlist');
    expect(p.rules).toEqual({ allowed_action_types: ['review', 'read'], action: 'warn' });
    expect(p.agent_ids).toBe('["a"]');
  });

  it('returns null for advisory kinds (no guard policy in V1)', () => {
    expect(isEnforceable(RULE_KINDS.REPEATED_RELOAD_WARN)).toBe(false);
    expect(behaviorRuleToGuardPolicy({ kind: RULE_KINDS.REPEATED_RELOAD_WARN }, { agentId: 'a' })).toBe(null);
    expect(behaviorRuleToGuardPolicy({ kind: RULE_KINDS.FAILED_LOOP_WARN }, { agentId: 'a' })).toBe(null);
  });

  it('has three enforceable kinds (destructive, protected-path, agent-allowlist)', () => {
    expect(ENFORCEABLE_KINDS).toHaveLength(3);
    expect(isEnforceable(RULE_KINDS.AGENT_ALLOWLIST)).toBe(true);
    expect([...ENFORCEABLE_KINDS].sort()).toEqual(
      [RULE_KINDS.DESTRUCTIVE_COMMAND_APPROVAL, RULE_KINDS.PROTECTED_PATH_APPROVAL, RULE_KINDS.AGENT_ALLOWLIST].sort(),
    );
  });
});
