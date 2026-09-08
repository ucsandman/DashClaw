import { describe, it, expect, vi, beforeEach } from 'vitest';

// Defensive mocks for the externally-effectful imports so a direct evaluatePolicy
// unit test never reaches the network/LLM. evaluateGuard's full pipeline is
// covered separately by guard-engine.test.js / guard-pipeline integration.
vi.mock('@/lib/webhooks.js', () => ({ deliverGuardWebhook: vi.fn() }));
vi.mock('@/lib/llm.js', () => ({ checkSemanticGuardrail: vi.fn(async () => null) }));

import { computeRiskScore, evaluatePolicy } from '@/lib/guard.js';
import { createSqlMock } from '../helpers.js';

function policy(type, rules, overrides = {}) {
  return { id: `gp_${type}`, name: `Policy ${type}`, policy_type: type, rules: JSON.stringify(rules), ...overrides };
}

// evaluatePolicy(policy, rules, context, sql, orgId, effectiveRiskScore)
function evalPolicy(type, rules, context, { sql, risk = 0 } = {}) {
  const p = policy(type, rules);
  return evaluatePolicy(p, rules, context, sql || createSqlMock({}), 'org_1', risk);
}

describe('computeRiskScore', () => {
  it('uses the per-action-type base score and falls back to other=20', () => {
    expect(computeRiskScore({ action_type: 'deploy' })).toBe(75);
    expect(computeRiskScore({ action_type: 'test' })).toBe(15);
    expect(computeRiskScore({ action_type: 'frobnicate' })).toBe(20); // unknown → other
    expect(computeRiskScore({})).toBe(20); // missing → other
  });

  it('adds 15 for irreversible actions', () => {
    expect(computeRiskScore({ action_type: 'test', reversible: false })).toBe(30);
    expect(computeRiskScore({ action_type: 'test', reversible: true })).toBe(15);
  });

  it('adds risk for high/moderate-risk systems touched', () => {
    expect(computeRiskScore({ action_type: 'test', systems_touched: ['production'] })).toBe(25); // +10
    expect(computeRiskScore({ action_type: 'test', systems_touched: ['shell'] })).toBe(20); // +5
    expect(computeRiskScore({ action_type: 'test', systems_touched: ['production', 'shell'] })).toBe(30); // +15
  });

  it('adds risk for destructive/deployment/secret goal patterns', () => {
    expect(computeRiskScore({ action_type: 'test', declared_goal: 'rm -rf /tmp' })).toBe(35); // +20
    expect(computeRiskScore({ action_type: 'test', declared_goal: 'deploy to prod' })).toBe(25); // +10
    expect(computeRiskScore({ action_type: 'test', declared_goal: 'read the .env secret' })).toBe(30); // +15
  });

  it('clamps the final score to 0..100', () => {
    expect(computeRiskScore({ action_type: 'security', reversible: false, systems_touched: ['production'], declared_goal: 'rm -rf and drop table' })).toBe(100);
    expect(computeRiskScore({ action_type: 'monitor' })).toBe(10);
  });
});

describe('evaluatePolicy dispatch', () => {
  beforeEach(() => vi.clearAllMocks());

  it('risk_threshold: blocks at/over threshold (uses effectiveRiskScore), else null', async () => {
    expect(await evalPolicy('risk_threshold', { threshold: 80 }, {}, { risk: 85 }))
      .toEqual({ action: 'block', reason: 'Risk score 85 >= threshold 80' });
    expect(await evalPolicy('risk_threshold', { threshold: 80, action: 'warn' }, {}, { risk: 80 }))
      .toEqual({ action: 'warn', reason: 'Risk score 80 >= threshold 80' });
    expect(await evalPolicy('risk_threshold', { threshold: 80 }, {}, { risk: 50 })).toBeNull();
  });

  it('risk_threshold: default threshold 80', async () => {
    expect(await evalPolicy('risk_threshold', {}, {}, { risk: 80 }))
      .toEqual({ action: 'block', reason: 'Risk score 80 >= threshold 80' });
  });

  it('require_approval / block_action_type: match by action_type', async () => {
    expect(await evalPolicy('require_approval', { action_types: ['deploy'] }, { action_type: 'deploy' }))
      .toEqual({ action: 'require_approval', reason: 'Action type "deploy" requires approval' });
    expect(await evalPolicy('require_approval', { action_types: ['deploy'] }, { action_type: 'test' })).toBeNull();
    expect(await evalPolicy('block_action_type', { action_types: ['delete'] }, { action_type: 'delete' }))
      .toEqual({ action: 'block', reason: 'Action type "delete" is blocked by policy' });
  });

  it('protected_path: matches target / write_paths, null when no paths', async () => {
    const hit = await evalPolicy('protected_path', { paths: ['app/secrets/**'] }, { target: 'app/secrets/x.ts' });
    expect(hit).toEqual({ action: 'require_approval', reason: 'Protected path touched: app/secrets/x.ts' });
    expect(await evalPolicy('protected_path', { paths: ['app/secrets/**'] }, { write_paths: ['app/secrets/y.ts'] }))
      .toEqual({ action: 'require_approval', reason: 'Protected path touched: app/secrets/y.ts' });
    expect(await evalPolicy('protected_path', { paths: [] }, { target: 'anything' })).toBeNull();
    expect(await evalPolicy('protected_path', { paths: ['app/secrets/**'] }, { target: 'README.md' })).toBeNull();
  });

  it('rate_limit: blocks/warns when count >= max (via sql.query)', async () => {
    const sql = createSqlMock({ queryResponses: [[{ cnt: '60' }], []] });
    expect(await evalPolicy('rate_limit', { max_actions: 50 }, { agent_id: 'agt_1' }, { sql }))
      .toEqual({ action: 'warn', reason: 'Agent made 60 guard evaluations in 60min (limit: 50)' });
    const sql2 = createSqlMock({ queryResponses: [[{ cnt: '5' }]] });
    expect(await evalPolicy('rate_limit', { max_actions: 50 }, { agent_id: 'agt_1' }, { sql: sql2 })).toBeNull();
    // No agent → null, no query
    expect(await evalPolicy('rate_limit', { max_actions: 50 }, {})).toBeNull();
  });

  it('rate_limit: cooldown suppresses repeat warns for the same episode', async () => {
    // Over the limit but warned recently for this policy+agent → suppressed.
    // (2026-09-08: without this, a runaway agent emitted ~1,800 warns per
    // 10-min episode — 34,760 firings/30d on rate_limit_runaway_safety.)
    const sql = createSqlMock({ queryResponses: [[{ cnt: '250' }], [{ '1': 1 }]] });
    expect(await evalPolicy('rate_limit', { max_actions: 50 }, { agent_id: 'agt_1' }, { sql })).toBeNull();
    expect(sql.queryCalls).toHaveLength(2);
    // Cooldown lookup targets this policy id and agent, default window = 60.
    expect(sql.queryCalls[1].params).toEqual(['org_1', 'agt_1', 'gp_rate_limit', 60]);

    // Over the limit, no recent warn → fires.
    const sql2 = createSqlMock({ queryResponses: [[{ cnt: '250' }], []] });
    expect(await evalPolicy('rate_limit', { max_actions: 50 }, { agent_id: 'agt_1' }, { sql: sql2 }))
      .toEqual({ action: 'warn', reason: 'Agent made 250 guard evaluations in 60min (limit: 50)' });

    // Custom cooldown_minutes is honored.
    const sql3 = createSqlMock({ queryResponses: [[{ cnt: '250' }], []] });
    await evalPolicy('rate_limit', { max_actions: 50, cooldown_minutes: 30 }, { agent_id: 'agt_1' }, { sql: sql3 });
    expect(sql3.queryCalls[1].params[3]).toBe(30);
  });

  it('rate_limit: cooldown never suppresses a block — enforcement is not noise', async () => {
    // A block-action rate_limit policy must keep firing on every over-limit
    // evaluation even when a recent warn exists for the policy: the cooldown
    // lookup is skipped entirely for non-warn emissions.
    const sql = createSqlMock({ queryResponses: [[{ cnt: '250' }]] });
    expect(await evalPolicy('rate_limit', { max_actions: 50, action: 'block' }, { agent_id: 'agt_1' }, { sql }))
      .toEqual({ action: 'block', reason: 'Agent made 250 guard evaluations in 60min (limit: 50)' });
    expect(sql.queryCalls).toHaveLength(1); // no cooldown lookup ran
  });

  it('webhook_check returns null (handled separately after the local loop)', async () => {
    expect(await evalPolicy('webhook_check', { url: 'https://x.com' }, { action_type: 'deploy' })).toBeNull();
  });

  it('green_contract: gates by observed vs required level', async () => {
    const rules = { action_types: ['deploy'], required_level: 'workspace' };
    expect(await evalPolicy('green_contract', rules, { action_type: 'deploy' }))
      .toEqual({ action: 'block', reason: 'Green contract: no test status reported, workspace required' });
    expect(await evalPolicy('green_contract', rules, { action_type: 'deploy', intel: { green: { observed_level: 'targeted' } } }))
      .toEqual({ action: 'block', reason: 'Green contract: observed targeted, required workspace' });
    expect(await evalPolicy('green_contract', rules, { action_type: 'deploy', intel: { green: { observed_level: 'merge_ready' } } })).toBeNull();
    expect(await evalPolicy('green_contract', rules, { action_type: 'test' })).toBeNull(); // type not covered
  });

  it('branch_freshness: blocks stale branches past max_commits_behind', async () => {
    const rules = { action_types: ['deploy'], freshness: ['stale'], max_commits_behind: 2 };
    expect(await evalPolicy('branch_freshness', rules, { action_type: 'deploy', intel: { branch: { freshness: 'stale', commits_behind: 5, name: 'feat' } } }))
      .toEqual({ action: 'block', reason: 'Branch feat is stale (5 commits behind)' });
    expect(await evalPolicy('branch_freshness', rules, { action_type: 'deploy', intel: { branch: { freshness: 'stale', commits_behind: 1 } } })).toBeNull();
    expect(await evalPolicy('branch_freshness', rules, { action_type: 'deploy', intel: { branch: { freshness: 'fresh', commits_behind: 9 } } })).toBeNull();
  });

  it('permission_escalation: blocks when tool permission outranks agent pairing level', async () => {
    const sql = createSqlMock({ taggedResponses: [[{ permission_level: 'readonly' }]] });
    const res = await evalPolicy('permission_escalation', { enforce: true }, { agent_id: 'agt_1', tool: { required_permission: 'danger' } }, { sql });
    expect(res).toEqual({ action: 'block', reason: 'Permission escalation: agent has readonly, tool requires danger' });
    // Not enforced → null
    expect(await evalPolicy('permission_escalation', { enforce: false }, { agent_id: 'agt_1', tool: { required_permission: 'danger' } })).toBeNull();
  });

  it('non_fabrication: fail-closed block when source-of-truth is missing/malformed', async () => {
    const res = await evalPolicy('non_fabrication', {}, { content: 'some claim', source_of_truth: null });
    expect(res?.action).toBe('block');
    expect(res?.reason).toContain('source-of-truth missing or malformed');
    expect(res?.nonFabrication).toMatchObject({ verdict: 'block' });
    // No content → policy does not apply
    expect(await evalPolicy('non_fabrication', {}, {})).toBeNull();
  });

  it('unknown policy type → null', async () => {
    expect(await evalPolicy('made_up_type', {}, { action_type: 'deploy' })).toBeNull();
  });

  it('catastrophe_floor: holds irreversible high-risk destructive acts regardless of θ', async () => {
    const rules = { action_types: ['delete', 'destroy'], min_risk: 85, require_irreversible: true, ungrantable: true };
    const ctx = { action_type: 'delete', reversible: false };
    const res = await evalPolicy('catastrophe_floor', rules, ctx, { risk: 95 });
    expect(res).toEqual({
      action: 'require_approval',
      reason: 'Catastrophe floor: delete at risk 95 ≥ 85 (irreversible) — held regardless of calibrated θ',
    });
  });

  it('catastrophe_floor: null when any gate misses', async () => {
    const rules = { action_types: ['delete', 'destroy'], min_risk: 85, require_irreversible: true };
    // below the floor
    expect(await evalPolicy('catastrophe_floor', rules, { action_type: 'delete', reversible: false }, { risk: 84 })).toBeNull();
    // wrong action type
    expect(await evalPolicy('catastrophe_floor', rules, { action_type: 'deploy', reversible: false }, { risk: 95 })).toBeNull();
    // reversible act
    expect(await evalPolicy('catastrophe_floor', rules, { action_type: 'delete', reversible: true }, { risk: 95 })).toBeNull();
  });

  it('catastrophe_floor: block action and declared-type fallback', async () => {
    const rules = { action_types: ['delete'], min_risk: 85, action: 'block' };
    const res = await evalPolicy('catastrophe_floor', rules, { declared_action_type: 'delete' }, { risk: 90 });
    expect(res?.action).toBe('block');
  });

  it('catastrophe_floor: defaults (min_risk 85, require_approval)', async () => {
    const res = await evalPolicy('catastrophe_floor', { action_types: ['destroy'] }, { action_type: 'destroy', reversible: false }, { risk: 85 });
    expect(res?.action).toBe('require_approval');
  });
});
