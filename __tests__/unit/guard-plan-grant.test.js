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

  // U2: the deny lookup fails CLOSED — unlike the fail-soft case above (which
  // was already require_approval before the throw), a throwing deny lookup
  // must RAISE an otherwise-allow decision to require_approval instead of
  // silently letting the action through.
  it('U2: a throwing deny lookup raises allow to require_approval with the failsafe reason', async () => {
    const sql = makeSql({
      policies: [], // no policy raises anything — decision would stay 'allow'
      throwOnPlansLookup: true,
    });
    const result = await evaluateGuard('org_1', {
      agent_id: 'agent-a', action_type: 'deploy', declared_goal: 'ship the release',
    }, sql);

    expect(result.decision).toBe('require_approval');
    expect(result.reasons.some((r) => r.includes('Plan-denial lookup unavailable'))).toBe(true);
    expect(result.matched_policies).toContain('builtin:plan_deny_failsafe');
  });

  // U1(a): the deny check must not be skippable by omitting agent_id — it
  // never matched on agent_id in the SQL anyway (findDeniedStepMatch is
  // deliberately org-wide), but the OLD entry guard gated the whole function
  // (including the deny half) on agent_id being present.
  it('U1a: a denied step still blocks when agent_id is absent', async () => {
    const sql = makeSql({
      policies: [],
      deniedRows: [{ step_id: 'ps_denied_noagent', plan_id: 'pa_plan5', reviewed_by: 'wes' }],
    });
    const result = await evaluateGuard('org_1', {
      action_type: 'deploy', declared_goal: 'ship the release',
    }, sql);

    expect(result.decision).toBe('block');
    expect(result.reasons.some((r) => r.includes('ps_denied_noagent'))).toBe(true);
  });

  // U1(b): the deny check must not be skippable by omitting declared_goal
  // when an act-hash binding is present — an empty declaredGoal simply fails
  // to match the SQL step_goal equality, it does not skip the lookup.
  it('U1b: a denied step still blocks when declared_goal is absent but the act hash matches', async () => {
    const sql = makeSql({
      policies: [],
      deniedRows: [{ step_id: 'ps_denied_noGoal', plan_id: 'pa_plan6', reviewed_by: 'wes' }],
    });
    const result = await evaluateGuard('org_1', {
      agent_id: 'agent-a', action_type: 'deploy', act: { kind: 'shell', command: 'rm -rf /' },
    }, sql);

    expect(result.decision).toBe('block');
    expect(result.reasons.some((r) => r.includes('ps_denied_noGoal'))).toBe(true);
  });

  // V2: the entry guard now runs when EITHER action_type or an act hash is
  // present — it used to require action_type unconditionally, so a step
  // denied only by its act hash could never even be checked once the
  // (self-asserted) caller simply omitted action_type on a later call.
  it('V2: a denied step still blocks on a hash-only match when action_type is absent', async () => {
    const sql = makeSql({
      policies: [],
      deniedRows: [{ step_id: 'ps_denied_hash_noaction', plan_id: 'pa_plan8', reviewed_by: 'wes' }],
    });
    const result = await evaluateGuard('org_1', {
      agent_id: 'agent-a', act: { kind: 'shell', command: 'rm -rf /' },
    }, sql);

    expect(result.decision).toBe('block');
    expect(result.reasons.some((r) => r.includes('ps_denied_hash_noaction'))).toBe(true);
  });

  // U1(c): consumption keeps the strict full-triple requirement — a matching
  // goal alone (no agent_id) must never consume a grant, even though the
  // deny half no longer requires agent_id.
  it('U1c: consumption still requires the full triple — no grant when agent_id is missing', async () => {
    const sql = makeSql({
      policies: [makePolicy('require_approval', { action_types: ['deploy'] })],
      consumeRows: [{
        step_id: 'ps_step_noagent', plan_id: 'pa_plan7', seq: 1,
        reviewed_by: 'wes', act_content_hash: null, preview_decision: 'require_approval', total_steps: 1,
      }],
    });
    const result = await evaluateGuard('org_1', {
      action_type: 'deploy', declared_goal: 'ship the release',
    }, sql);

    expect(result.decision).toBe('require_approval');
    const consumeUpdates = sql.taggedCalls.filter((c) => /^\s*UPDATE plan_authorization_steps/i.test(c.text));
    expect(consumeUpdates).toHaveLength(0);
  });

  // W2: an evaluation abandoned by the deadline must not consume a plan-step
  // grant when it eventually reaches the grants phase in the background —
  // its result is discarded (the deadline branch returns the degraded
  // snapshot), so burning the single-use grant only strands the operator's
  // approval for a result nobody will see.
  it('W2: an evaluation abandoned by the deadline does not consume a plan-step grant in the background', async () => {
    const originalDeadline = process.env.DASHCLAW_GUARD_DEADLINE_MS;
    process.env.DASHCLAW_GUARD_DEADLINE_MS = '10';
    try {
      // The webhook resolves (it isn't hung) but only after the deadline has
      // already fired — the background evaluation keeps running past it and
      // would reach the grants phase shortly after.
      mockDeliverGuardWebhook.mockImplementation(
        () => new Promise((resolve) => setTimeout(
          () => resolve({ success: true, response: { decision: 'allow', reasons: [], warnings: [] } }), 80,
        )),
      );
      const sql = makeSql({
        policies: [
          makePolicy('require_approval', { action_types: ['deploy'] }),
          makePolicy('webhook_check', { url: 'https://example.com' }, { id: 'gp_hook' }),
        ],
        consumeRows: [{
          step_id: 'ps_step1', plan_id: 'pa_plan1', seq: 1,
          reviewed_by: 'wes', act_content_hash: null, total_steps: 1,
        }],
      });

      const result = await evaluateGuard('org_1', {
        agent_id: 'agent-a', action_type: 'deploy', declared_goal: 'ship the release',
      }, sql);

      expect(result.degraded).toBe(true);

      // Give the abandoned evaluation time to reach (and, pre-fix, consume)
      // the grant phase in the background before asserting on it.
      await new Promise((resolve) => setTimeout(resolve, 150));

      const consumeUpdates = sql.taggedCalls.filter((c) => /^\s*UPDATE plan_authorization_steps/i.test(c.text));
      expect(consumeUpdates).toHaveLength(0);
    } finally {
      if (originalDeadline === undefined) delete process.env.DASHCLAW_GUARD_DEADLINE_MS;
      else process.env.DASHCLAW_GUARD_DEADLINE_MS = originalDeadline;
    }
  });

  // W4: matched_action_id is written as an honest NULL, not '', when the
  // evaluation context carries no action_id — '' previously read as "matched
  // but blank" instead of "nothing to match".
  it('W4: consumePlanStepGrant is called with matchedActionId: null when context.action_id is absent', async () => {
    const sql = makeSql({
      policies: [makePolicy('require_approval', { action_types: ['deploy'] })],
      consumeRows: [{
        step_id: 'ps_step1', plan_id: 'pa_plan1', seq: 1,
        reviewed_by: 'wes', act_content_hash: null, total_steps: 1,
      }],
    });
    await evaluateGuard('org_1', {
      agent_id: 'agent-a', action_type: 'deploy', declared_goal: 'ship the release',
    }, sql);

    const consumeUpdate = sql.taggedCalls.find((c) => /^\s*UPDATE plan_authorization_steps/i.test(c.text));
    expect(consumeUpdate).toBeTruthy();
    // matched_action_id is the SET clause's only interpolation — first value.
    expect(consumeUpdate.values[0]).toBeNull();
  });

  it('W4: consumePlanStepGrant is called with the stringified action_id when context.action_id is present', async () => {
    const sql = makeSql({
      policies: [makePolicy('require_approval', { action_types: ['deploy'] })],
      consumeRows: [{
        step_id: 'ps_step1', plan_id: 'pa_plan1', seq: 1,
        reviewed_by: 'wes', act_content_hash: null, total_steps: 1,
      }],
    });
    await evaluateGuard('org_1', {
      agent_id: 'agent-a', action_type: 'deploy', declared_goal: 'ship the release', action_id: 'act_gd_abc123',
    }, sql);

    const consumeUpdate = sql.taggedCalls.find((c) => /^\s*UPDATE plan_authorization_steps/i.test(c.text));
    expect(consumeUpdate.values[0]).toBe('act_gd_abc123');
  });

  // U3: the provenance object persisted with the decision (_plan_grant)
  // carries preview_decision and live_reasons_count so an operator can audit
  // TTL-window drift between what they approved and what the live
  // evaluation actually raised.
  it('U3: plan-grant provenance includes preview_decision and live_reasons_count', async () => {
    const sql = makeSql({
      policies: [makePolicy('require_approval', { action_types: ['deploy'] }, { name: 'Needs review' })],
      consumeRows: [{
        step_id: 'ps_step1', plan_id: 'pa_plan1', seq: 1,
        reviewed_by: 'wes@example.com', act_content_hash: null, preview_decision: 'allow', total_steps: 2,
      }],
    });
    const result = await evaluateGuard('org_1', {
      agent_id: 'agent-a', action_type: 'deploy', declared_goal: 'ship the release',
    }, sql);

    expect(result.decision).toBe('allow');
    const insertCall = sql.taggedCalls.find((c) => /INSERT INTO guard_decisions/i.test(c.text));
    // The persisted context row is JSON.stringify'd (persistence.ts) before
    // being interpolated — find it among the insert's values by parsing each
    // string value and checking for the _plan_grant marker.
    const contextJson = insertCall?.values.find((v) => {
      if (typeof v !== 'string') return false;
      try { return '_plan_grant' in JSON.parse(v); } catch { return false; }
    });
    const context = JSON.parse(contextJson);
    expect(context._plan_grant).toMatchObject({
      plan_id: 'pa_plan1', step_id: 'ps_step1', seq: 1,
      preview_decision: 'allow', live_reasons_count: 1,
    });
  });
});
