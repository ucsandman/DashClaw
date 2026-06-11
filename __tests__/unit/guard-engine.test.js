import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockDeliverGuardWebhook, mockCheckSemantic, mockIsEmbeddingsEnabled, mockGenerateEmbedding, mockScanSensitiveData } = vi.hoisted(() => ({
  mockDeliverGuardWebhook: vi.fn(),
  mockCheckSemantic: vi.fn(),
  mockIsEmbeddingsEnabled: vi.fn(() => false),
  mockGenerateEmbedding: vi.fn(),
  mockScanSensitiveData: vi.fn((text) => ({ findings: [], redacted: text, clean: true })),
}));

vi.mock('@/lib/webhooks.js', () => ({ deliverGuardWebhook: mockDeliverGuardWebhook }));
vi.mock('@/lib/llm.js', () => ({ checkSemanticGuardrail: mockCheckSemantic }));
vi.mock('@/lib/embeddings.js', () => ({ isEmbeddingsEnabled: mockIsEmbeddingsEnabled, generateActionEmbedding: mockGenerateEmbedding }));
vi.mock('@/lib/security.js', () => ({ scanSensitiveData: mockScanSensitiveData }));
// Predictive risk is dynamically imported in guard.js — mock to avoid consuming SQL mock responses
vi.mock('@/lib/predictive-risk.js', () => ({ getPredictiveRisk: vi.fn(async () => ({ statistical: null, llm: null, total_adjustment: 0 })) }));
vi.mock('@/lib/repositories/settings.repository.js', () => ({ getSettings: vi.fn(async () => []) }));

import { evaluateGuard, evaluatePolicy, __resetGuardCaches } from '@/lib/guard.js';
import { createSqlMock } from '../helpers.js';

function makeSql(policies) {
  return createSqlMock({ taggedResponses: [policies] });
}

function makePolicy(type, rules, overrides = {}) {
  return {
    id: `gp_${type}`,
    name: `Policy ${type}`,
    policy_type: type,
    rules: JSON.stringify(rules),
    ...overrides,
  };
}

describe('evaluateGuard', () => {
  // Capture the original GUARD_LLM_KEY at describe-block scope so we can restore it
  // in afterEach. This prevents the test file from leaking env state into neighboring
  // test files if Vitest ever shares a process across them.
  const originalGuardLlmKey = process.env.GUARD_LLM_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    // Guard hot-path caches (policies, predictive settings) persist at module
    // level; tests here reuse org_1 with different policies per case.
    __resetGuardCaches();
    mockScanSensitiveData.mockImplementation((text) => ({ findings: [], redacted: text, clean: true }));
    // Bypass the no-LLM-key short-circuit added to `app/lib/guard.js` by commit
    // b8706570 (BUG-01 fix). In a real instance with no OPENAI_API_KEY / GUARD_LLM_KEY,
    // semantic_check policies now return `require_approval` as a safe middle-path
    // fallback. In this test file we're simulating a configured instance — the actual
    // LLM call is mocked via `mockCheckSemantic` — so we set a placeholder key to
    // satisfy the pre-check and let the mock govern the decision path.
    process.env.GUARD_LLM_KEY = 'mock-key-for-unit-tests';
  });

  afterEach(() => {
    if (originalGuardLlmKey === undefined) {
      delete process.env.GUARD_LLM_KEY;
    } else {
      process.env.GUARD_LLM_KEY = originalGuardLlmKey;
    }
  });

  // --- risk_threshold ---

  it('blocks when risk_score >= threshold', async () => {
    const sql = makeSql([makePolicy('risk_threshold', { threshold: 80 })]);
    const result = await evaluateGuard('org_1', { risk_score: 85 }, sql);
    expect(result.decision).toBe('block');
    expect(result.reasons[0]).toContain('Risk score 85 >= threshold 80');
  });

  it('allows when risk_score < threshold', async () => {
    const sql = makeSql([makePolicy('risk_threshold', { threshold: 80 })]);
    const result = await evaluateGuard('org_1', { risk_score: 50 }, sql);
    expect(result.decision).toBe('allow');
  });

  it('uses default threshold of 80', async () => {
    const sql = makeSql([makePolicy('risk_threshold', {})]);
    const result = await evaluateGuard('org_1', { risk_score: 80 }, sql);
    expect(result.decision).toBe('block');
  });

  it('clamps risk_score to 0-100', async () => {
    const sql = makeSql([makePolicy('risk_threshold', { threshold: 80 })]);
    const result = await evaluateGuard('org_1', { risk_score: 150 }, sql);
    expect(result.decision).toBe('block');
    expect(result.reasons[0]).toContain('Risk score 100');
  });

  it('treats negative agent risk_score as 0 and uses server-computed score', async () => {
    // Server computes score from action_type (defaults to 'other' = 20).
    // Agent-supplied -50 is clamped to 0, so effective = max(20, 0) = 20.
    // Threshold 1 → 20 >= 1 → block.
    const sql = makeSql([makePolicy('risk_threshold', { threshold: 1 })]);
    const result = await evaluateGuard('org_1', { risk_score: -50 }, sql);
    expect(result.decision).toBe('block');
    expect(result.agent_risk_score).toBe(-50);
    expect(result.risk_score).toBe(20);
  });

  // --- require_approval ---

  it('requires approval for matching action_type', async () => {
    const sql = makeSql([makePolicy('require_approval', { action_types: ['deploy', 'migrate'] })]);
    const result = await evaluateGuard('org_1', { action_type: 'deploy' }, sql);
    expect(result.decision).toBe('require_approval');
  });

  it('allows non-matching action_type for require_approval', async () => {
    const sql = makeSql([makePolicy('require_approval', { action_types: ['deploy'] })]);
    const result = await evaluateGuard('org_1', { action_type: 'read' }, sql);
    expect(result.decision).toBe('allow');
  });

  it('fires identically for a custom action_type whether authored via the form or imported via YAML', async () => {
    // Regression guard for the "New policy form can only target preset tags" trap:
    // the form now lets operators TYPE arbitrary action types (e.g. marketplace_publish).
    // The form compiles rules to { action_types, action } while Import/YAML compiles to
    // { action_types, require, tests }. The require_approval guard reads ONLY
    // rules.action_types (guard.js: actionTypes.includes(context.action_type)), so both
    // shapes must produce the SAME decision for the same custom action type.
    const formShape = makePolicy('require_approval', { action_types: ['marketplace_publish'], action: 'require_approval' });
    const importShape = makePolicy('require_approval', { action_types: ['marketplace_publish'], require: 'approval', tests: [] });

    const fromForm = await evaluateGuard('org_1', { action_type: 'marketplace_publish' }, makeSql([formShape]));
    const fromImport = await evaluateGuard('org_1', { action_type: 'marketplace_publish' }, makeSql([importShape]));

    expect(fromForm.decision).toBe('require_approval');
    expect(fromImport.decision).toBe('require_approval');
    expect(fromForm.decision).toBe(fromImport.decision);
  });

  // --- block_action_type ---

  it('blocks matching action_type', async () => {
    const sql = makeSql([makePolicy('block_action_type', { action_types: ['delete'] })]);
    const result = await evaluateGuard('org_1', { action_type: 'delete' }, sql);
    expect(result.decision).toBe('block');
  });

  it('allows non-matching action_type for block', async () => {
    const sql = makeSql([makePolicy('block_action_type', { action_types: ['delete'] })]);
    const result = await evaluateGuard('org_1', { action_type: 'read' }, sql);
    expect(result.decision).toBe('allow');
  });

  // --- rate_limit ---

  it('warns when rate limit exceeded', async () => {
    const sql = createSqlMock({
      taggedResponses: [[makePolicy('rate_limit', { max_actions: 5, window_minutes: 60 })]],
      queryResponses: [[{ cnt: '6' }]],
    });
    const result = await evaluateGuard('org_1', { agent_id: 'a1', action_type: 'deploy' }, sql);
    expect(result.decision).toBe('warn');
  });

  it('allows under rate limit', async () => {
    const sql = createSqlMock({
      taggedResponses: [[makePolicy('rate_limit', { max_actions: 10, window_minutes: 60 })]],
      queryResponses: [[{ cnt: '3' }]],
    });
    const result = await evaluateGuard('org_1', { agent_id: 'a1', action_type: 'deploy' }, sql);
    expect(result.decision).toBe('allow');
  });

  it('skips rate_limit without agent_id', async () => {
    const sql = createSqlMock({
      taggedResponses: [[makePolicy('rate_limit', { max_actions: 1, window_minutes: 1 })]],
    });
    const result = await evaluateGuard('org_1', { action_type: 'deploy' }, sql);
    expect(result.decision).toBe('allow');
  });

  // --- semantic_check ---

  it('blocks on semantic check violation', async () => {
    mockCheckSemantic.mockResolvedValue({ allowed: false, reason: 'Violates safety policy' });
    const sql = makeSql([makePolicy('semantic_check', { instruction: 'Check safety' })]);
    const result = await evaluateGuard('org_1', { action_type: 'deploy' }, sql);
    expect(result.decision).toBe('block');
    expect(result.reasons[0]).toContain('Semantic Violation');
  });

  it('allows on semantic check pass', async () => {
    mockCheckSemantic.mockResolvedValue({ allowed: true, reason: 'OK' });
    const sql = makeSql([makePolicy('semantic_check', { instruction: 'Check safety' })]);
    const result = await evaluateGuard('org_1', { action_type: 'deploy' }, sql);
    expect(result.decision).toBe('allow');
  });

  it('falls back to allow when semantic check fails (default fail-open)', async () => {
    mockCheckSemantic.mockResolvedValue(null);
    const sql = makeSql([makePolicy('semantic_check', { instruction: 'Check' })]);
    const result = await evaluateGuard('org_1', { action_type: 'deploy' }, sql);
    expect(result.decision).toBe('allow');
  });

  it('falls back to block when semantic check fails and fallback=block', async () => {
    mockCheckSemantic.mockResolvedValue(null);
    const sql = makeSql([makePolicy('semantic_check', { instruction: 'Check', fallback: 'block' })]);
    const result = await evaluateGuard('org_1', { action_type: 'deploy' }, sql);
    expect(result.decision).toBe('block');
  });

  // --- behavioral_anomaly ---

  it('skips behavioral_anomaly when embeddings disabled', async () => {
    mockIsEmbeddingsEnabled.mockReturnValue(false);
    const sql = makeSql([makePolicy('behavioral_anomaly', { similarity_threshold: 0.75 })]);
    const result = await evaluateGuard('org_1', { agent_id: 'a1', action_type: 'deploy' }, sql);
    expect(result.decision).toBe('allow');
  });

  // --- webhook_check ---

  it('escalates decision on webhook response', async () => {
    mockDeliverGuardWebhook.mockResolvedValue({
      success: true,
      response: { decision: 'block', reasons: ['Blocked by webhook'], warnings: [] },
    });
    const sql = makeSql([makePolicy('webhook_check', { url: 'https://example.com/hook', timeout_ms: 5000 })]);
    const result = await evaluateGuard('org_1', { action_type: 'deploy' }, sql);
    expect(result.decision).toBe('block');
  });

  it('does not downgrade decision from webhook', async () => {
    mockDeliverGuardWebhook.mockResolvedValue({
      success: true,
      response: { decision: 'allow', reasons: [], warnings: [] },
    });
    const sql = createSqlMock({
      taggedResponses: [[
        makePolicy('block_action_type', { action_types: ['deploy'] }),
        makePolicy('webhook_check', { url: 'https://example.com/hook' }),
      ]],
    });
    const result = await evaluateGuard('org_1', { action_type: 'deploy' }, sql);
    expect(result.decision).toBe('block');
  });

  it('applies on_timeout=block when webhook times out', async () => {
    mockDeliverGuardWebhook.mockResolvedValue({ success: false, response: null });
    const sql = makeSql([makePolicy('webhook_check', { url: 'https://example.com', on_timeout: 'block' })]);
    const result = await evaluateGuard('org_1', { action_type: 'deploy' }, sql);
    expect(result.decision).toBe('block');
  });

  it('applies on_timeout=allow (fail-open) when webhook times out', async () => {
    mockDeliverGuardWebhook.mockResolvedValue({ success: false, response: null });
    const sql = makeSql([makePolicy('webhook_check', { url: 'https://example.com', on_timeout: 'allow' })]);
    const result = await evaluateGuard('org_1', { action_type: 'deploy' }, sql);
    expect(result.decision).toBe('allow');
  });

  // --- Severity escalation ---

  it('highest severity wins across multiple policies', async () => {
    const sql = makeSql([
      makePolicy('require_approval', { action_types: ['deploy'] }),
      makePolicy('block_action_type', { action_types: ['deploy'] }),
    ]);
    const result = await evaluateGuard('org_1', { action_type: 'deploy' }, sql);
    expect(result.decision).toBe('block');
  });

  // --- Redaction ---

  it('redacts sensitive data from logged context', async () => {
    mockScanSensitiveData.mockImplementation((text) => {
      if (typeof text === 'string' && text.includes('secret')) {
        return { findings: [{ pattern: 'api_key_generic', category: 'api_key', severity: 'critical', preview: 'sec***' }], redacted: '[REDACTED]', clean: false };
      }
      return { findings: [], redacted: text, clean: true };
    });
    const sql = makeSql([]);
    const result = await evaluateGuard('org_1', { declared_goal: 'secret_key_here' }, sql);
    expect(result.decision).toBe('allow');
    expect(mockScanSensitiveData).toHaveBeenCalled();
  });

  // --- Malformed rules ---

  it('skips policies with malformed JSON rules', async () => {
    const sql = createSqlMock({
      taggedResponses: [[{ id: 'gp_bad', name: 'Bad', policy_type: 'risk_threshold', rules: 'not{json' }]],
    });
    const result = await evaluateGuard('org_1', { risk_score: 99 }, sql);
    expect(result.decision).toBe('allow');
  });

  // --- Signal integration ---

  it('includes signal warnings when includeSignals is true', async () => {
    const sql = makeSql([]);
    const mockCompute = vi.fn().mockResolvedValue([{ type: 'autonomy_spike', label: 'Too fast' }]);
    const result = await evaluateGuard('org_1', { agent_id: 'a1' }, sql, {
      includeSignals: true,
      computeSignals: mockCompute,
    });
    expect(result.warnings.some(w => w.includes('autonomy_spike'))).toBe(true);
  });

  // --- Return shape ---

  it('returns correct result shape', async () => {
    const sql = makeSql([]);
    const result = await evaluateGuard('org_1', { action_type: 'read' }, sql);
    expect(result).toHaveProperty('decision');
    expect(result).toHaveProperty('reasons');
    expect(result).toHaveProperty('warnings');
    expect(result).toHaveProperty('matched_policies');
    expect(result).toHaveProperty('evaluated_at');
    // Server always computes a risk score; 'read' is unknown so defaults to 'other' (20)
    expect(result.risk_score).toBe(20);
    expect(result.agent_risk_score).toBeNull();
  });
});

// --- Phase 2c: action-binding block wiring (issue #121) ---

describe('evaluateGuard — action binding', () => {
  afterEach(() => { delete process.env.DASHCLAW_ACT_BINDING; });

  it('blocks a mismatch under best_effort and records act_status on the row', async () => {
    process.env.DASHCLAW_ACT_BINDING = 'best_effort';
    const sql = makeSql([]);
    const result = await evaluateGuard('org_1', { action_type: 'read', act_status: 'mismatch' }, sql);
    expect(result.decision).toBe('block');
    expect(result.reasons.some(r => r.includes('Action-binding mismatch'))).toBe(true);
  });

  it('does NOT block a mismatch when mode is off (records only)', async () => {
    process.env.DASHCLAW_ACT_BINDING = 'off';
    const sql = makeSql([]);
    const result = await evaluateGuard('org_1', { action_type: 'read', act_status: 'mismatch' }, sql);
    expect(result.decision).toBe('allow');
    expect(result.reasons.some(r => r.includes('Action-binding'))).toBe(false);
  });

  it('blocks not_present under required', async () => {
    process.env.DASHCLAW_ACT_BINDING = 'required';
    const sql = makeSql([]);
    const result = await evaluateGuard('org_1', { action_type: 'read', act_status: 'not_present' }, sql);
    expect(result.decision).toBe('block');
    expect(result.reasons.some(r => r.includes('not_present'))).toBe(true);
  });

  it('does NOT block not_present under best_effort', async () => {
    process.env.DASHCLAW_ACT_BINDING = 'best_effort';
    const sql = makeSql([]);
    const result = await evaluateGuard('org_1', { action_type: 'read', act_status: 'not_present' }, sql);
    expect(result.decision).toBe('allow');
  });

  it('allows a match even under required', async () => {
    process.env.DASHCLAW_ACT_BINDING = 'required';
    const sql = makeSql([]);
    const result = await evaluateGuard('org_1', { action_type: 'read', act_status: 'match' }, sql);
    expect(result.decision).toBe('allow');
  });
});

// Regression: evaluatePolicy must not treat an inherited Object/Function
// property name as a registered evaluator (CodeQL js/unvalidated-dynamic-method-call).
// Before the own-property guard, POLICY_EVALUATORS['constructor'] resolved to the
// Object constructor and was *invoked*, returning a truthy object instead of null.
describe('evaluatePolicy — dynamic key allow-list', () => {
  for (const protoKey of ['constructor', 'toString', 'hasOwnProperty', '__proto__', 'valueOf']) {
    it(`returns null for inherited property key "${protoKey}" instead of invoking it`, async () => {
      const policy = { id: 'p', name: 'p', policy_type: protoKey };
      const result = await evaluatePolicy(policy, {}, { action_type: 'read' }, makeSql([]), 'org_1', 0);
      expect(result).toBeNull();
    });
  }

  it('still dispatches a genuine registered policy type', async () => {
    const policy = { id: 'p', name: 'p', policy_type: 'risk_threshold' };
    const result = await evaluatePolicy(policy, { threshold: 50 }, { action_type: 'read' }, makeSql([]), 'org_1', 80);
    expect(result).toMatchObject({ action: 'block' });
  });
});
