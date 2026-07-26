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
import { createSqlMock } from '../helpers.js';

// createSqlMock records tagged-template calls on `.taggedCalls` and .query()
// calls on `.queryCalls` (see __tests__/helpers.js) — not a single `.calls`
// array. Both guard_decisions INSERT and the operator-grant UPDATE go through
// tagged template calls, so we assert against `sql.taggedCalls`.
describe('evaluateGuard simulate mode', () => {
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

  it('returns a decision without persisting guard_decisions', async () => {
    const sql = createSqlMock(); // default empty result sets
    const result = await evaluateGuard('org_1', {
      agent_id: 'agent-a', action_type: 'deploy', declared_goal: 'deploy the thing', risk_score: 90,
    }, sql, { simulate: true });
    expect(result.simulated).toBe(true);
    expect(['allow', 'warn', 'require_approval', 'block']).toContain(result.decision);
    // No INSERT INTO guard_decisions was issued:
    const inserts = sql.taggedCalls.filter((c) => /INSERT INTO guard_decisions/i.test(c.text));
    expect(inserts).toHaveLength(0);
  });

  it('never runs the operator-grant consumption UPDATE in simulate mode', async () => {
    const sql = createSqlMock();
    await evaluateGuard('org_1', {
      agent_id: 'agent-a', action_type: 'deploy', declared_goal: 'deploy the thing', risk_score: 90,
    }, sql, { simulate: true });
    const grantUpdates = sql.taggedCalls.filter((c) => /UPDATE action_records/i.test(c.text) && /approval_grant_used_at/i.test(c.text));
    expect(grantUpdates).toHaveLength(0);
  });
});
