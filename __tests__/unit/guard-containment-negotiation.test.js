import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Full evaluateGuard integration for the containment finalize pass (RFC
// 2026-07-06-containment-verdicts, Task 5). Harness copied from
// __tests__/unit/guard-plan-grant.test.js.
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
import { buildPromotionAct } from '@/lib/guard/containment';

function makePolicy(type, rules, overrides = {}) {
  return {
    id: `gp_${type}`,
    name: `Policy ${type}`,
    policy_type: type,
    rules: JSON.stringify(rules),
    ...overrides,
  };
}

// Content-matching (rather than call-position) routing so the mock stays
// correct regardless of how many other tagged calls (risk_templates,
// operator-approval grant, guard_decisions insert) happen to run before/after.
function makeSql({ policies = [] } = {}) {
  const taggedCalls = [];
  const sql = (strings, ...values) => {
    const text = String.raw({ raw: strings }, ...Array(values.length).fill('?'));
    taggedCalls.push({ text, values });
    if (/FROM guard_policies/i.test(text)) return Promise.resolve(policies);
    return Promise.resolve([]);
  };
  sql.query = async () => [];
  sql.taggedCalls = taggedCalls;
  return sql;
}

const CONTAIN_RULES = { threshold: 80, action: 'require_approval', contain_above: 50 };
const fileAct = { kind: 'file', file: { path: 'src/foo.ts', content_excerpt: 'x' } };

function findInsertedDecision(sql) {
  const insertCall = sql.taggedCalls.find((c) => /INSERT INTO guard_decisions/i.test(c.text));
  expect(insertCall).toBeTruthy();
  // Column order in persistence.ts: id, org_id, agent_id, agent_name,
  // verification_status, replay_status, jti, act_status, act_hash, decision, ...
  return insertCall.values[9];
}

describe('containment negotiation (via evaluateGuard)', () => {
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

  it('negotiates allow_contained to a contained result when the caller advertises support', async () => {
    const sql = makeSql({ policies: [makePolicy('risk_threshold', CONTAIN_RULES)] });
    const result = await evaluateGuard('org_1', {
      agent_id: 'agent-a',
      act: fileAct,
      risk_score: 60,
      client_capabilities: ['allow_contained'],
    }, sql);

    expect(result.decision).toBe('allow_contained');
    expect(result.containment).toEqual({ status: 'contained', basis: 'file' });
    expect(findInsertedDecision(sql)).toBe('allow_contained');
  });

  it('downgrades allow_contained to require_approval when the caller does not advertise support', async () => {
    const sql = makeSql({ policies: [makePolicy('risk_threshold', CONTAIN_RULES)] });
    const result = await evaluateGuard('org_1', {
      agent_id: 'agent-a',
      act: fileAct,
      risk_score: 60,
    }, sql);

    expect(result.decision).toBe('require_approval');
    expect(result.risk_breakdown._containment.downgraded_to_interrupt).toBe(true);
    expect(findInsertedDecision(sql)).toBe('require_approval');
  });

  it('negotiates simulate previews too — a plan preview must not promise containment the caller cannot do', async () => {
    const sql = makeSql({ policies: [makePolicy('risk_threshold', CONTAIN_RULES)] });
    const result = await evaluateGuard('org_1', {
      agent_id: 'agent-a',
      act: fileAct,
      risk_score: 60,
    }, sql, { simulate: true });

    expect(result.simulated).toBe(true);
    expect(result.decision).toBe('require_approval');
  });

  it('always governs containment_promote: builtin raise fires with no covering grant', async () => {
    const sql = makeSql({ policies: [makePolicy('risk_threshold', CONTAIN_RULES)] });
    const result = await evaluateGuard('org_1', {
      agent_id: 'agent-a',
      action_type: 'containment_promote',
      declared_goal: 'promote staged containment result',
    }, sql);

    expect(result.decision).toBe('require_approval');
    expect(result.matched_policies).toContain('builtin:containment_promote');
  });

  it('always governs containment_promote with the act attached: the merge act must not swap the sentinel type out from under the raise (Task 8 finding)', async () => {
    const sql = makeSql({ policies: [makePolicy('risk_threshold', CONTAIN_RULES)] });
    const result = await evaluateGuard('org_1', {
      agent_id: 'agent-a',
      action_type: 'containment_promote',
      declared_goal: 'promote staged containment result',
      act: buildPromotionAct('dashclaw/contained-x'),
    }, sql);

    expect(result.decision).toBe('require_approval');
    expect(result.matched_policies).toContain('builtin:containment_promote');
  });

  it('the sentinel cannot be dodged by attaching a scarier act than the merge act', async () => {
    const sql = makeSql({ policies: [makePolicy('risk_threshold', CONTAIN_RULES)] });
    const result = await evaluateGuard('org_1', {
      agent_id: 'agent-a',
      action_type: 'containment_promote',
      declared_goal: 'promote staged containment result',
      act: { kind: 'shell', command: 'rm -rf /' },
    }, sql);

    expect(['require_approval', 'block']).toContain(result.decision);
    expect(result.matched_policies).toContain('builtin:containment_promote');
  });

  it('block-path unchanged: containment never touches an outright block', async () => {
    const sql = makeSql({ policies: [makePolicy('risk_threshold', { threshold: 90, action: 'block' })] });
    const result = await evaluateGuard('org_1', {
      agent_id: 'agent-a',
      act: fileAct,
      risk_score: 95,
      client_capabilities: ['allow_contained'],
    }, sql);

    expect(result.decision).toBe('block');
    expect(result.containment).toBeUndefined();
  });
});
