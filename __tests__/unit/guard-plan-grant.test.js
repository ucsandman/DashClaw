import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockDeliverGuardWebhook, mockCheckSemantic, mockScanSensitiveData } = vi.hoisted(() => ({
  mockDeliverGuardWebhook: vi.fn(),
  mockCheckSemantic: vi.fn(),
  mockScanSensitiveData: vi.fn((text) => ({ findings: [], redacted: text, clean: true })),
}));

vi.mock('@/lib/webhooks.js', () => ({ deliverGuardWebhook: mockDeliverGuardWebhook }));
vi.mock('@/lib/llm.js', () => ({ checkSemanticGuardrail: mockCheckSemantic }));
vi.mock('@/lib/security.js', () => ({ scanSensitiveData: mockScanSensitiveData }));
// Predictive risk is dynamically imported in guard.js — mock to avoid consuming SQL mock responses
vi.mock('@/lib/predictive-risk.js', () => ({ getPredictiveRisk: vi.fn(async () => ({ statistical: null, llm: null, total_adjustment: 0 })) }));
vi.mock('@/lib/repositories/settings.repository.js', () => ({ getSettings: vi.fn(async () => []) }));

import { evaluateGuard, __resetGuardCaches } from '@/lib/guard.js';

function makePolicy(type, rules, overrides = {}) {
  return {
    id: `gp_${type}`,
    name: `Policy ${type}`,
    policy_type: type,
    rules: JSON.stringify(rules),
    ...overrides,
  };
}

// applyPlanStepGrant runs two plans-repository queries: findDeniedStepMatch
// (a SELECT against plan_authorization_steps) and consumePlanStepGrant (an
// UPDATE against plan_authorization_steps). Content-matching (rather than
// call-position) scripting is used so the mock stays correct regardless of
// how many other tagged calls (risk_templates, operator-approval grant,
// guard_decisions insert) happen to run before/after — those are internal
// implementation detail this test file shouldn't have to track positionally.
function makeSql({ policies = [], deniedRows = [], consumeRows = [], throwOnPlansLookup = false } = {}) {
  const taggedCalls = [];
  const queryCalls = [];
  const sql = (strings, ...values) => {
    const text = String.raw({ raw: strings }, ...Array(values.length).fill('?'));
    taggedCalls.push({ text, values });
    if (/FROM guard_policies/i.test(text)) return Promise.resolve(policies);
    if (/plan_authorization_steps/i.test(text)) {
      if (throwOnPlansLookup) return Promise.reject(new Error('plans lookup failed'));
      if (/^\s*UPDATE plan_authorization_steps/i.test(text)) return Promise.resolve(consumeRows);
      return Promise.resolve(deniedRows); // the findDeniedStepMatch SELECT
    }
    return Promise.resolve([]);
  };
  sql.query = async (text, params = []) => {
    queryCalls.push({ text, params });
    return [];
  };
  sql.taggedCalls = taggedCalls;
  sql.queryCalls = queryCalls;
  return sql;
}

describe('applyPlanStepGrant (via evaluateGuard)', () => {
  const originalGuardLlmKey = process.env.GUARD_LLM_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    __resetGuardCaches();
    mockScanSensitiveData.mockImplementation((text) => ({ findings: [], redacted: text, clean: true }));
    process.env.GUARD_LLM_KEY = 'mock-key-for-unit-tests';
  });

  afterEach(() => {
    if (originalGuardLlmKey === undefined) {
      delete process.env.GUARD_LLM_KEY;
    } else {
      process.env.GUARD_LLM_KEY = originalGuardLlmKey;
    }
  });

  it('downgrades require_approval to allow when an approved step matches', async () => {
    const sql = makeSql({
      policies: [makePolicy('require_approval', { action_types: ['deploy'] })],
      consumeRows: [{
        step_id: 'ps_step1',
        plan_id: 'pa_plan1',
        seq: 1,
        reviewed_by: 'wes@example.com',
        act_content_hash: null,
        total_steps: 2,
      }],
    });
    const result = await evaluateGuard('org_1', {
      agent_id: 'agent-a', action_type: 'deploy', declared_goal: 'ship the release',
    }, sql);

    expect(result.decision).toBe('allow');
    expect(result.matched_policies).toContain('builtin:plan_grant');
    expect(result.warnings.some((w) => w.includes('pa_plan1') && w.includes('step 1/2'))).toBe(true);

    // The consumption UPDATE really was issued.
    const consumeUpdates = sql.taggedCalls.filter((c) => /^\s*UPDATE plan_authorization_steps/i.test(c.text));
    expect(consumeUpdates).toHaveLength(1);
  });

  // T6: parity with applyOperatorApprovalGrant — the gating reasons (why the
  // action originally needed approval) survive the downgrade as warnings
  // instead of being discarded.
  it('T6: moves the gating reasons into warnings (prefixed) instead of discarding them on downgrade', async () => {
    const sql = makeSql({
      policies: [makePolicy('require_approval', { action_types: ['deploy'] }, { name: 'Needs review' })],
      consumeRows: [{
        step_id: 'ps_step1', plan_id: 'pa_plan1', seq: 1,
        reviewed_by: 'wes@example.com', act_content_hash: null, total_steps: 2,
      }],
    });
    const result = await evaluateGuard('org_1', {
      agent_id: 'agent-a', action_type: 'deploy', declared_goal: 'ship the release',
    }, sql);

    expect(result.decision).toBe('allow');
    expect(result.reasons).toHaveLength(0);
    expect(result.warnings.some((w) => w.startsWith('superseded by grant: ') && w.includes('Needs review'))).toBe(true);
  });

  it('never downgrades block', async () => {
    const sql = makeSql({
      policies: [makePolicy('block_action_type', { action_types: ['deploy'] })],
      // Even if a grant existed, block must never consume it.
      consumeRows: [{
        step_id: 'ps_step2', plan_id: 'pa_plan2', seq: 1,
        reviewed_by: 'wes', act_content_hash: null, total_steps: 1,
      }],
    });
    const result = await evaluateGuard('org_1', {
      agent_id: 'agent-a', action_type: 'deploy', declared_goal: 'ship the release',
    }, sql);

    expect(result.decision).toBe('block');
    const consumeUpdates = sql.taggedCalls.filter((c) => /^\s*UPDATE plan_authorization_steps/i.test(c.text));
    expect(consumeUpdates).toHaveLength(0);
    // Pin the early-return-before-any-query guarantee: block short-circuits
    // before findDeniedStepMatch's SELECT or consumePlanStepGrant's UPDATE.
    const planStepQueries = sql.taggedCalls.filter((c) => /plan_authorization_steps/i.test(c.text));
    expect(planStepQueries).toHaveLength(0);
  });

  it('raises to block when a denied step matches, even from allow', async () => {
    // No raising policy — the decision would be 'allow' without the deny-grant.
    const sql = makeSql({
      policies: [],
      deniedRows: [{ step_id: 'ps_denied1', plan_id: 'pa_plan3', reviewed_by: 'wes' }],
    });
    const result = await evaluateGuard('org_1', {
      agent_id: 'agent-a', action_type: 'deploy', declared_goal: 'ship the release',
    }, sql);

    expect(result.decision).toBe('block');
    expect(result.reasons.some((r) => r.includes('explicitly denied'))).toBe(true);
    expect(result.reasons.some((r) => r.includes('ps_denied1'))).toBe(true);
  });

  it('does not consume in simulate mode', async () => {
    const sql = makeSql({
      policies: [makePolicy('require_approval', { action_types: ['deploy'] })],
      consumeRows: [{
        step_id: 'ps_step3', plan_id: 'pa_plan4', seq: 1,
        reviewed_by: 'wes', act_content_hash: null, total_steps: 1,
      }],
    });
    const result = await evaluateGuard('org_1', {
      agent_id: 'agent-a', action_type: 'deploy', declared_goal: 'ship the release',
    }, sql, { simulate: true });

    // The require_approval-producing policy genuinely reached require_approval
    // — simulate skips BOTH grant passes, so nothing downgraded it.
    expect(result.decision).toBe('require_approval');

    const operatorGrantUpdates = sql.taggedCalls.filter(
      (c) => /UPDATE action_records/i.test(c.text) && /approval_grant_used_at/i.test(c.text),
    );
    expect(operatorGrantUpdates).toHaveLength(0);

    const planStepUpdates = sql.taggedCalls.filter((c) => /UPDATE plan_authorization_steps/i.test(c.text));
    expect(planStepUpdates).toHaveLength(0);
  });

  it('fails soft: a throwing plans lookup leaves require_approval intact', async () => {
    const sql = makeSql({
      policies: [makePolicy('require_approval', { action_types: ['deploy'] })],
      throwOnPlansLookup: true,
    });
    const result = await evaluateGuard('org_1', {
      agent_id: 'agent-a', action_type: 'deploy', declared_goal: 'ship the release',
    }, sql);

    expect(result.decision).toBe('require_approval');
  });
});
