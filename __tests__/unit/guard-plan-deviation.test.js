// Plan deviation detection via evaluateGuard (RFC 2026-08-11-plan-deviation-events).
// Integration seams under test: the hasLivePlan pre-gate, the runDeviationCheck
// phase (fail-soft, simulate-skipped), the unconditional row insert (D1), and
// the warning line on the guard response. Same content-matched sql-mock
// approach as guard-plan-grant.test.js.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockDeliverGuardWebhook, mockCheckSemantic, mockScanSensitiveData } = vi.hoisted(() => ({
  mockDeliverGuardWebhook: vi.fn(),
  mockCheckSemantic: vi.fn(),
  mockScanSensitiveData: vi.fn((text) => ({ findings: [], redacted: text, clean: true })),
}));

vi.mock('@/lib/webhooks.js', () => ({ deliverGuardWebhook: mockDeliverGuardWebhook }));
vi.mock('@/lib/llm.js', () => ({ checkSemanticGuardrail: mockCheckSemantic }));
vi.mock('@/lib/security.js', () => ({
  scanSensitiveData: mockScanSensitiveData,
  // plan-deviations.repository redacts declared/observed through this
  redactAny: vi.fn((v) => v),
}));
vi.mock('@/lib/predictive-risk.js', () => ({ getPredictiveRisk: vi.fn(async () => ({ statistical: null, llm: null, total_adjustment: 0 })) }));
vi.mock('@/lib/repositories/settings.repository.js', () => ({ getSettings: vi.fn(async () => []) }));

import { evaluateGuard, __resetGuardCaches } from '@/lib/guard.js';
import { computeActContentHash } from '@/lib/act-content-hash';

// Content-matched (not positional) scripting, so internal call ordering stays
// an implementation detail. Distinguishers:
//  - hasLivePlan pre-gate:      SELECT 1 AS present FROM plan_authorizations
//  - getLivePlanForAgent plan:  SELECT plan_id FROM plan_authorizations
//  - getLivePlanForAgent steps: SELECT step_id, seq, ... (no st. alias)
//  - findDeniedStepMatch:       SELECT st.step_id ...
//  - deviation insert:          INSERT INTO plan_deviations
function makeSql({ policies = [], hasLivePlan = false, planSteps = [], throwOnSteps = false } = {}) {
  const taggedCalls = [];
  const sql = (strings, ...values) => {
    const text = String.raw({ raw: strings }, ...Array(values.length).fill('?'));
    taggedCalls.push({ text, values });
    if (/FROM guard_policies/i.test(text)) return Promise.resolve(policies);
    if (/SELECT 1 AS present FROM plan_authorizations/i.test(text)) {
      return Promise.resolve(hasLivePlan ? [{ present: 1 }] : []);
    }
    if (/SELECT plan_id FROM plan_authorizations/i.test(text)) {
      return Promise.resolve(hasLivePlan ? [{ plan_id: 'pa_live1' }] : []);
    }
    if (/SELECT step_id, seq/i.test(text)) {
      if (throwOnSteps) return Promise.reject(new Error('steps lookup failed'));
      return Promise.resolve(planSteps);
    }
    if (/INSERT INTO plan_deviations/i.test(text)) {
      return Promise.resolve([{ deviation_id: values[0], kind: 'echo' }]);
    }
    return Promise.resolve([]);
  };
  sql.query = async (text, params = []) => {
    taggedCalls.push({ text, values: params });
    return [];
  };
  sql.taggedCalls = taggedCalls;
  return sql;
}

const step = (over = {}) => ({
  step_id: 'ps_1', seq: 1, action_type: 'deploy', step_goal: 'deploy web to staging',
  act_content_hash: null, grant_status: 'approved', grant_used_at: null,
  declared_paths: null, declared_systems: null,
  ...over,
});

const deviationInserts = (sql) => sql.taggedCalls.filter((c) => /INSERT INTO plan_deviations/i.test(c.text));

describe('runDeviationCheck (via evaluateGuard)', () => {
  const originalGuardLlmKey = process.env.GUARD_LLM_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    __resetGuardCaches();
    mockScanSensitiveData.mockImplementation((text) => ({ findings: [], redacted: text, clean: true }));
    process.env.GUARD_LLM_KEY = 'mock-key-for-unit-tests';
  });

  afterEach(() => {
    if (originalGuardLlmKey === undefined) delete process.env.GUARD_LLM_KEY;
    else process.env.GUARD_LLM_KEY = originalGuardLlmKey;
  });

  it('D1: records an unplanned_action deviation on an ALLOW decision (grant pass never saw it)', async () => {
    const sql = makeSql({ hasLivePlan: true, planSteps: [step()] });
    const result = await evaluateGuard('org_1', {
      agent_id: 'agent-a', action_type: 'send_email', declared_goal: 'email the customer',
    }, sql);

    expect(result.decision).toBe('allow');
    expect(result.warnings.some((w) => w.includes('Plan deviation: unplanned_action'))).toBe(true);

    const inserts = deviationInserts(sql);
    expect(inserts).toHaveLength(1);
    // deviation_id, org, agent, ..., plan, step(null), kind, dimension, severity ride as values
    expect(inserts[0].values).toEqual(expect.arrayContaining(['unplanned_action', 'pa_live1', 'none']));
    // guard_decision_id is the real decision id (insert runs post-persist)
    expect(inserts[0].values.some((v) => typeof v === 'string' && v.startsWith('act_gd_'))).toBe(true);
  });

  it('records goal_drift when action_type matches a step but the goal differs', async () => {
    const sql = makeSql({ hasLivePlan: true, planSteps: [step()] });
    const result = await evaluateGuard('org_1', {
      agent_id: 'agent-a', action_type: 'deploy', declared_goal: 'deploy api to production',
    }, sql);

    expect(result.decision).toBe('allow');
    const inserts = deviationInserts(sql);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].values).toEqual(expect.arrayContaining(['goal_drift', 'ps_1']));
  });

  it('records act_substitution (high) when the live act hash differs from the act-bound step', async () => {
    const act = { kind: 'shell', command: 'npm run deploy:prod' };
    const sql = makeSql({
      hasLivePlan: true,
      planSteps: [step({ act_content_hash: 'sha256:not-the-live-hash' })],
    });
    await evaluateGuard('org_1', {
      agent_id: 'agent-a', action_type: 'deploy', declared_goal: 'deploy web to staging', act,
    }, sql);

    const inserts = deviationInserts(sql);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].values).toEqual(expect.arrayContaining(['act_substitution', 'high']));
    expect(computeActContentHash(act)).not.toBe('sha256:not-the-live-hash');
  });

  it('no live plan: the pre-gate answers from one EXISTS probe and nothing else runs', async () => {
    const sql = makeSql({ hasLivePlan: false });
    const result = await evaluateGuard('org_1', {
      agent_id: 'agent-a', action_type: 'send_email', declared_goal: 'email the customer',
    }, sql);

    expect(result.decision).toBe('allow');
    expect(deviationInserts(sql)).toHaveLength(0);
    expect(sql.taggedCalls.some((c) => /SELECT plan_id FROM plan_authorizations/i.test(c.text))).toBe(false);
    // 30s cache: a second evaluation must not re-issue the EXISTS probe
    const probes = () => sql.taggedCalls.filter((c) => /SELECT 1 AS present/i.test(c.text)).length;
    const before = probes();
    await evaluateGuard('org_1', { agent_id: 'agent-a', action_type: 'deploy', declared_goal: 'x' }, sql);
    expect(probes()).toBe(before);
  });

  it('simulate: detection is skipped entirely — no probe, no insert', async () => {
    const sql = makeSql({ hasLivePlan: true, planSteps: [step()] });
    const result = await evaluateGuard('org_1', {
      agent_id: 'agent-a', action_type: 'send_email', declared_goal: 'email the customer',
    }, sql, { simulate: true });

    expect(result.simulated).toBe(true);
    expect(sql.taggedCalls.some((c) => /SELECT 1 AS present/i.test(c.text))).toBe(false);
    expect(deviationInserts(sql)).toHaveLength(0);
  });

  it('D3: a broken steps lookup fails soft — decision unaffected, no insert, no throw', async () => {
    const sql = makeSql({ hasLivePlan: true, throwOnSteps: true });
    const result = await evaluateGuard('org_1', {
      agent_id: 'agent-a', action_type: 'send_email', declared_goal: 'email the customer',
    }, sql);

    expect(result.decision).toBe('allow');
    expect(deviationInserts(sql)).toHaveLength(0);
  });

  it('an on-plan action (type + goal match, unconsumed step) records nothing', async () => {
    const sql = makeSql({ hasLivePlan: true, planSteps: [step()] });
    const result = await evaluateGuard('org_1', {
      agent_id: 'agent-a', action_type: 'deploy', declared_goal: 'Deploy Web to  STAGING',
    }, sql);

    expect(result.decision).toBe('allow');
    expect(deviationInserts(sql)).toHaveLength(0);
  });
});

describe('deviation_response policy (via evaluateGuard)', () => {
  const originalGuardLlmKey = process.env.GUARD_LLM_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    __resetGuardCaches();
    mockScanSensitiveData.mockImplementation((text) => ({ findings: [], redacted: text, clean: true }));
    process.env.GUARD_LLM_KEY = 'mock-key-for-unit-tests';
  });

  afterEach(() => {
    if (originalGuardLlmKey === undefined) delete process.env.GUARD_LLM_KEY;
    else process.env.GUARD_LLM_KEY = originalGuardLlmKey;
  });

  const devPolicy = (rules, overrides = {}) => ({
    id: 'gp_deviation', name: 'Deviation response', policy_type: 'deviation_response',
    rules: JSON.stringify(rules), ...overrides,
  });

  it('on_kind raises an unplanned_action to require_approval and stamps policy_outcome on the row', async () => {
    const sql = makeSql({
      hasLivePlan: true, planSteps: [step()],
      policies: [devPolicy({ on_kind: { unplanned_action: 'require_approval' } })],
    });
    const result = await evaluateGuard('org_1', {
      agent_id: 'agent-a', action_type: 'send_email', declared_goal: 'email the customer',
    }, sql);

    expect(result.decision).toBe('require_approval');
    expect(result.matched_policies).toContain('gp_deviation');
    expect(result.reasons.some((r) => r.includes('plan deviation unplanned_action'))).toBe(true);
    const inserts = deviationInserts(sql);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].values).toEqual(expect.arrayContaining(['require_approval']));
  });

  it('min_severity filters below-threshold kinds (goal_drift is low; medium floor ignores it)', async () => {
    const sql = makeSql({
      hasLivePlan: true, planSteps: [step()],
      policies: [devPolicy({ on_kind: { goal_drift: 'require_approval' }, min_severity: 'medium' })],
    });
    const result = await evaluateGuard('org_1', {
      agent_id: 'agent-a', action_type: 'deploy', declared_goal: 'deploy api instead',
    }, sql);

    expect(result.decision).toBe('allow');
    // D1: still recorded — only the consequence is filtered
    const inserts = deviationInserts(sql);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].values).toEqual(expect.arrayContaining(['goal_drift', 'none']));
  });

  it('block requires the explicit escalate_action ceiling — the default clamps to require_approval', async () => {
    const clamped = makeSql({
      hasLivePlan: true, planSteps: [step()],
      policies: [devPolicy({ on_kind: { unplanned_action: 'block' } })],
    });
    const r1 = await evaluateGuard('org_1', {
      agent_id: 'agent-a', action_type: 'send_email', declared_goal: 'email the customer',
    }, clamped);
    expect(r1.decision).toBe('require_approval');

    __resetGuardCaches();
    const unclamped = makeSql({
      hasLivePlan: true, planSteps: [step()],
      policies: [devPolicy({ on_kind: { unplanned_action: 'block' }, escalate_action: 'block' })],
    });
    const r2 = await evaluateGuard('org_1', {
      agent_id: 'agent-a', action_type: 'send_email', declared_goal: 'email the customer',
    }, unclamped);
    expect(r2.decision).toBe('block');
  });

  it('tighten-only: an existing block is never lowered by a warn-level deviation consequence', async () => {
    const sql = makeSql({
      hasLivePlan: true, planSteps: [step()],
      policies: [
        { id: 'gp_block', name: 'Block emails', policy_type: 'block_action_type', rules: JSON.stringify({ action_types: ['send_email'] }) },
        devPolicy({ on_kind: { unplanned_action: 'warn' } }),
      ],
    });
    const result = await evaluateGuard('org_1', {
      agent_id: 'agent-a', action_type: 'send_email', declared_goal: 'email the customer',
    }, sql);

    expect(result.decision).toBe('block');
  });

  it('the transient finding stash never reaches the persisted decision context', async () => {
    const sql = makeSql({
      hasLivePlan: true, planSteps: [step()],
      policies: [devPolicy({ on_kind: { unplanned_action: 'require_approval' } })],
    });
    await evaluateGuard('org_1', {
      agent_id: 'agent-a', action_type: 'send_email', declared_goal: 'email the customer',
    }, sql);

    const decisionInserts = sql.taggedCalls.filter((c) => /INSERT INTO guard_decisions/i.test(c.text));
    expect(decisionInserts.length).toBeGreaterThan(0);
    const serialized = JSON.stringify(decisionInserts.map((c) => c.values));
    expect(serialized).not.toContain('_plan_deviation_finding');
    // the durable sibling echo IS there
    expect(serialized).toContain('_plan_deviation');
  });
});
