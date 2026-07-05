import { describe, it, expect } from 'vitest';
import { analyzeSamples } from '@/lib/behavior/analyzer.js';
import { RULE_KINDS } from '@/lib/behavior/policy-model.js';

let n = 0;
const ev = () => `bse_${(n++).toString(16).padStart(4, '0')}`;
const at = (min) => new Date(Date.UTC(2026, 5, 1, 10, min, 0)).toISOString();

function sample(over = {}) {
  return {
    schema_version: 1, event_id: ev(), ts: at(over._min ?? 0), source: 'claude-code',
    agent_id: 'agent-a', tool: 'Read', action_type: 'review', command_shape: null,
    bash_intent: null, read_paths: [], write_paths: [], risk_score: 10,
    reversible: true, guard_decision: 'allow', matched_policies: [],
    outcome_status: 'completed', model: null, ...over,
  };
}

// Eight unique benign reads so an agent always clears minSamples without
// tripping reload detection (distinct paths) for rule-isolation tests.
function filler(count = 8) {
  return Array.from({ length: count }, (_, i) => sample({ tool: 'Read', read_paths: [`file-${i}.js`], _min: i }));
}

const findType = (res, type) => res.suggestions.find((s) => s.type === type);

describe('behavior/analyzer suggestion generation', () => {
  it('emits a destructive_command_approval suggestion with a faithful risk_threshold draft', () => {
    n = 0;
    const samples = [
      ...filler(5),
      sample({ tool: 'Bash', bash_intent: 'destructive', command_shape: 'rm -rf <path>', risk_score: 90, _min: 10 }),
      sample({ tool: 'Bash', bash_intent: 'destructive', command_shape: 'git push --force', risk_score: 80, _min: 11 }),
      sample({ tool: 'Bash', bash_intent: 'destructive', command_shape: 'git reset --hard', risk_score: 75, _min: 12 }),
    ];
    const res = analyzeSamples(samples);
    const sug = findType(res, RULE_KINDS.DESTRUCTIVE_COMMAND_APPROVAL);
    expect(sug).toBeTruthy();
    expect(sug.enforceable).toBe(true);
    expect(sug.matching_sample_size).toBe(3);
    expect(sug.evidence_event_ids.length).toBe(3);
    expect(sug.draft_policy.policy_type).toBe('risk_threshold');
    const rules = JSON.parse(sug.draft_policy.rules);
    expect(rules.action).toBe('require_approval');
    expect(rules.threshold).toBeGreaterThanOrEqual(60);
    expect(rules.threshold).toBeLessThanOrEqual(85);
  });

  it('emits a protected_path_approval suggestion covering touched groups', () => {
    n = 0;
    const samples = [
      ...filler(5),
      sample({ tool: 'Write', action_type: 'apply', write_paths: ['app/api/auth/login/route.js'], _min: 10 }),
      sample({ tool: 'Write', action_type: 'apply', write_paths: ['app/api/billing/route.js'], _min: 11 }),
      sample({ tool: 'Edit', action_type: 'apply', write_paths: ['middleware.js'], _min: 12 }),
    ];
    const res = analyzeSamples(samples);
    const sug = findType(res, RULE_KINDS.PROTECTED_PATH_APPROVAL);
    expect(sug).toBeTruthy();
    expect(sug.enforceable).toBe(true);
    expect(sug.draft_policy.policy_type).toBe('protected_path');
    expect(sug.target).toContain('auth');
    const rules = JSON.parse(sug.draft_policy.rules);
    expect(Array.isArray(rules.paths)).toBe(true);
    expect(rules.paths.length).toBeGreaterThan(0);
  });

  it('emits an advisory repeated_reload_warn (no guard policy)', () => {
    n = 0;
    const samples = [
      ...filler(8),
      sample({ tool: 'Read', read_paths: ['hot.js'], _min: 20 }),
      sample({ tool: 'Read', read_paths: ['hot.js'], _min: 21 }),
      sample({ tool: 'Read', read_paths: ['hot.js'], _min: 22 }),
    ];
    const res = analyzeSamples(samples);
    const sug = findType(res, RULE_KINDS.REPEATED_RELOAD_WARN);
    expect(sug).toBeTruthy();
    expect(sug.advisory).toBe(true);
    expect(sug.draft_policy).toBe(null);
  });

  it('emits an advisory failed_loop_warn', () => {
    n = 0;
    const samples = [
      ...filler(8),
      sample({ tool: 'Bash', command_shape: 'npm run build', outcome_status: 'failed', risk_score: 25, _min: 20 }),
      sample({ tool: 'Bash', command_shape: 'npm run build', outcome_status: 'failed', risk_score: 25, _min: 22 }),
      sample({ tool: 'Bash', command_shape: 'npm run build', outcome_status: 'failed', risk_score: 25, _min: 24 }),
    ];
    const res = analyzeSamples(samples);
    const sug = findType(res, RULE_KINDS.FAILED_LOOP_WARN);
    expect(sug).toBeTruthy();
    expect(sug.advisory).toBe(true);
  });

  it('emits an advisory model_task_mismatch_warn when a cheap model does heavy work', () => {
    n = 0;
    const heavy = (min) => sample({
      tool: 'Edit', action_type: 'refactor', model: 'claude-haiku-4-5',
      declared_goal: 'refactor the auth module', write_paths: [`mod-${min}.js`], _min: min,
    });
    const samples = [...filler(6), heavy(20), heavy(21), heavy(22)];
    const res = analyzeSamples(samples);
    const sug = findType(res, RULE_KINDS.MODEL_TASK_MISMATCH_WARN);
    expect(sug).toBeTruthy();
    expect(sug.advisory).toBe(true);
    expect(sug.matching_sample_size).toBeGreaterThanOrEqual(3);
  });

  it('emits an ENFORCEABLE agent_allowlist suggestion describing the safe envelope', () => {
    n = 0;
    const res = analyzeSamples(filler(8));
    const sug = findType(res, RULE_KINDS.AGENT_ALLOWLIST);
    expect(sug).toBeTruthy();
    // v4.4: agent_allowlist is now enforceable (2/6 → 3/6) and carries a draft policy.
    expect(sug.enforceable).toBe(true);
    expect(sug.advisory).toBe(false);
    expect(sug.rule.allow.tools).toContain('Read');
    expect(sug.draft_policy).toBeTruthy();
    expect(sug.draft_policy.policy_type).toBe('agent_allowlist');
  });

  it('does not emit suggestions below the minimum sample count', () => {
    n = 0;
    const res = analyzeSamples([
      sample({ tool: 'Bash', bash_intent: 'destructive', risk_score: 90 }),
      sample({ tool: 'Bash', bash_intent: 'destructive', risk_score: 90 }),
    ]);
    expect(res.suggestions.length).toBe(0);
  });

  it('builds a per-agent operating envelope', () => {
    n = 0;
    const res = analyzeSamples(filler(8));
    expect(res.agents.length).toBe(1);
    expect(res.agents[0].agent_id).toBe('agent-a');
    expect(res.agents[0].sample_size).toBe(8);
    expect(res.agents[0].safe_envelope.tools).toContain('Read');
  });
});

describe('behavior/analyzer dismiss suppression', () => {
  const destructiveSamples = () => {
    n = 0;
    return [
      ...filler(5),
      sample({ tool: 'Bash', bash_intent: 'destructive', risk_score: 90, _min: 10 }),
      sample({ tool: 'Bash', bash_intent: 'destructive', risk_score: 90, _min: 11 }),
      sample({ tool: 'Bash', bash_intent: 'destructive', risk_score: 90, _min: 12 }),
    ];
  };

  it('suppresses a suggestion dismissed by exact signature', () => {
    const samples = destructiveSamples();
    const first = analyzeSamples(samples);
    const sug = first.suggestions.find((s) => s.type === RULE_KINDS.DESTRUCTIVE_COMMAND_APPROVAL);
    const after = analyzeSamples(samples, { dismissals: [{ signature: sug.id }] });
    expect(after.suggestions.find((s) => s.id === sug.id)).toBeUndefined();
    expect(after.dismissed).toBeGreaterThanOrEqual(1);
  });

  it('suppress_similar hides all suggestions of that type for the agent', () => {
    const samples = destructiveSamples();
    const after = analyzeSamples(samples, {
      dismissals: [{ agent_id: 'agent-a', type: RULE_KINDS.DESTRUCTIVE_COMMAND_APPROVAL, suppress_similar: true }],
    });
    expect(after.suggestions.find((s) => s.type === RULE_KINDS.DESTRUCTIVE_COMMAND_APPROVAL)).toBeUndefined();
  });

  it('is deterministic — same samples produce the same suggestion ids', () => {
    const a = analyzeSamples(destructiveSamples());
    const b = analyzeSamples(destructiveSamples());
    expect(a.suggestions.map((s) => s.id)).toEqual(b.suggestions.map((s) => s.id));
  });
});
