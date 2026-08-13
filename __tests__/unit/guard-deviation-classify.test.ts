// Plan deviation classifier (docs/rfcs/2026-08-11-plan-deviation-events.md §5).
// Pure-function matrix: no IO, no guard plumbing — every kind, the clean
// paths, severity bumps, and confidence values.
import { describe, it, expect } from 'vitest';
import { classifyDeviation, normalizeGoal } from '../../app/lib/guard/deviation';
import type { LivePlanStep } from '../../app/lib/guard/deviation';

const step = (over: Partial<LivePlanStep> = {}): LivePlanStep => ({
  step_id: 'ps_1', seq: 1, action_type: 'deploy', step_goal: 'deploy web to staging',
  act_content_hash: null, grant_status: 'approved', grant_used_at: null,
  declared_paths: null, declared_systems: null,
  ...over,
});

const observed = (over: Partial<Parameters<typeof classifyDeviation>[0]['observed']> = {}) => ({
  action_type: 'deploy', declared_goal: 'deploy web to staging', act_hash: null,
  target: null, write_paths: [], systems_touched: [], act_summary: null,
  ...over,
});

const input = (over: Partial<Parameters<typeof classifyDeviation>[0]> = {}) => ({
  planId: 'pa_1', steps: [step()], observed: observed(), grantedStepId: null,
  ...over,
});

describe('normalizeGoal', () => {
  it('lowercases, trims, collapses whitespace; null for empty/non-string', () => {
    expect(normalizeGoal('  Deploy  Web\tto STAGING ')).toBe('deploy web to staging');
    expect(normalizeGoal('')).toBeNull();
    expect(normalizeGoal(null)).toBeNull();
    expect(normalizeGoal(42)).toBeNull();
  });
});

describe('classifyDeviation', () => {
  it('returns null when the action exactly matches an approved unconsumed step', () => {
    expect(classifyDeviation(input())).toBeNull();
  });

  it('returns null for a granted step with no scope declarations (grant pass already matched)', () => {
    expect(classifyDeviation(input({ grantedStepId: 'ps_1' }))).toBeNull();
  });

  it('act_substitution: type+goal match but live act hash differs from the declared one — high, conf 90', () => {
    const f = classifyDeviation(input({
      steps: [step({ act_content_hash: 'sha256:AAA' })],
      observed: observed({ act_hash: 'sha256:BBB', act_summary: 'shell: npm run deploy:prod' }),
    }))!;
    expect(f.kind).toBe('act_substitution');
    expect(f.dimension).toBe('act');
    expect(f.severity).toBe('high');
    expect(f.step_id).toBe('ps_1');
    expect(f.match_confidence).toBe(90);
    expect(f.declared.act_content_hash).toBe('sha256:AAA');
    expect(f.observed.act_content_hash).toBe('sha256:BBB');
  });

  it('budget_overrun: exact match against an already-consumed step — low', () => {
    const f = classifyDeviation(input({
      steps: [step({ grant_used_at: '2026-08-13T00:00:00Z' })],
    }))!;
    expect(f.kind).toBe('budget_overrun');
    expect(f.dimension).toBe('existence');
    expect(f.severity).toBe('low');
  });

  it('scope_escape: matched step but observed path outside declared_paths — high', () => {
    const f = classifyDeviation(input({
      steps: [step({ declared_paths: ['app/web/**'] })],
      observed: observed({ target: 'infra/prod.tf', write_paths: ['infra/prod.tf'] }),
    }))!;
    expect(f.kind).toBe('scope_escape');
    expect(f.dimension).toBe('path');
    expect(f.severity).toBe('high');
  });

  it('scope_escape on a GRANTED step: undeclared system touched — dimension system', () => {
    const f = classifyDeviation(input({
      grantedStepId: 'ps_1',
      steps: [step({ declared_systems: ['staging'] })],
      observed: observed({ systems_touched: ['production'] }),
    }))!;
    expect(f.kind).toBe('scope_escape');
    expect(f.dimension).toBe('system');
  });

  it('goal_drift: action_type matches a step but goal differs — low, conf 60, bumped to medium on undeclared system', () => {
    const drift = classifyDeviation(input({
      observed: observed({ declared_goal: 'deploy api to staging' }),
    }))!;
    expect(drift.kind).toBe('goal_drift');
    expect(drift.dimension).toBe('goal');
    expect(drift.severity).toBe('low');
    expect(drift.match_confidence).toBe(60);

    const bumped = classifyDeviation(input({
      steps: [step({ declared_systems: ['staging'] })],
      observed: observed({ declared_goal: 'deploy api to staging', systems_touched: ['production'] }),
    }))!;
    expect(bumped.kind).toBe('goal_drift');
    expect(bumped.severity).toBe('medium');
  });

  it('goal_drift matches case- and whitespace-insensitively (no deviation on benign reformatting)', () => {
    expect(classifyDeviation(input({
      observed: observed({ declared_goal: '  Deploy WEB to   Staging ' }),
    }))).toBeNull();
  });

  it('unplanned_action: no step matches the action_type — medium, conf 0, null step', () => {
    const f = classifyDeviation(input({
      observed: observed({ action_type: 'send_email', declared_goal: 'email the customer' }),
    }))!;
    expect(f.kind).toBe('unplanned_action');
    expect(f.dimension).toBe('existence');
    expect(f.severity).toBe('medium');
    expect(f.step_id).toBeNull();
    expect(f.match_confidence).toBe(0);
  });

  it('returns null when the plan has no steps to measure against', () => {
    expect(classifyDeviation(input({ steps: [] }))).toBeNull();
  });

  it('hash match on an act-bound step is clean (conf-100 path)', () => {
    expect(classifyDeviation(input({
      steps: [step({ act_content_hash: 'sha256:AAA' })],
      observed: observed({ act_hash: 'sha256:AAA' }),
    }))).toBeNull();
  });

  it('denied steps are not deviation anchors: an action matching only a denied step is unplanned', () => {
    const f = classifyDeviation(input({
      steps: [step({ grant_status: 'denied' })],
      observed: observed({ declared_goal: 'something else entirely' }),
    }))!;
    expect(f.kind).toBe('unplanned_action');
  });
});
