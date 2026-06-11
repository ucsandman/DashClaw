import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mirror the proven guard-engine.test.js mock setup so evaluateGuard runs
// without external services and only the policy-load tagged query touches sql.
const { mockDeliverGuardWebhook, mockCheckSemantic, mockIsEmbeddingsEnabled, mockGenerateEmbedding, mockScanSensitiveData } =
  vi.hoisted(() => ({
    mockDeliverGuardWebhook: vi.fn(),
    mockCheckSemantic: vi.fn(),
    mockIsEmbeddingsEnabled: vi.fn(() => false),
    mockGenerateEmbedding: vi.fn(),
    mockScanSensitiveData: vi.fn((text: string) => ({ findings: [], redacted: text, clean: true })),
  }));

vi.mock('@/lib/webhooks.js', () => ({ deliverGuardWebhook: mockDeliverGuardWebhook }));
vi.mock('@/lib/llm.js', () => ({ checkSemanticGuardrail: mockCheckSemantic }));
vi.mock('@/lib/embeddings.js', () => ({
  isEmbeddingsEnabled: mockIsEmbeddingsEnabled,
  generateActionEmbedding: mockGenerateEmbedding,
}));
vi.mock('@/lib/security.js', () => ({ scanSensitiveData: mockScanSensitiveData }));
vi.mock('@/lib/predictive-risk.js', () => ({
  getPredictiveRisk: vi.fn(async () => ({ statistical: null, llm: null, total_adjustment: 0 })),
}));
vi.mock('@/lib/repositories/settings.repository.js', () => ({ getSettings: vi.fn(async () => []) }));

import { evaluateGuard, __resetGuardCaches } from '@/lib/guard.js';
import { createSqlMock } from '../helpers.js';

let orgN = 0;
const freshOrg = () => `org_grant_${++orgN}`;

function rows(policies: Array<{ policy_type: string; rules: Record<string, unknown>; name?: string }>) {
  return policies.map((p, i) => ({
    id: `gp_t_${i}`,
    name: p.name ?? `P${i}`,
    policy_type: p.policy_type,
    rules: JSON.stringify(p.rules),
    agent_ids: null,
  }));
}

const CTX = {
  agent_id: 'agent_1',
  action_type: 'api',
  declared_goal: 'call stripe',
  target: 'https://api.stripe.com/v1/charges',
};

describe('warn_action_type evaluator', () => {
  beforeEach(() => __resetGuardCaches());
  it('warns (does not gate) on a matching action type', async () => {
    const sql = createSqlMock({ taggedResponses: [rows([
      { policy_type: 'warn_action_type', rules: { action_types: ['api'] } },
    ])] });
    const res = await evaluateGuard(freshOrg(), CTX, sql);
    expect(res.decision).toBe('warn');
  });
});

describe('allow_grant post-pass', () => {
  beforeEach(() => __resetGuardCaches());

  it('downgrades warn → allow when a grant matches', async () => {
    const sql = createSqlMock({ taggedResponses: [rows([
      { policy_type: 'warn_action_type', rules: { action_types: ['api'] } },
      { policy_type: 'allow_grant', rules: { action_type: 'api', target_prefix: 'api.stripe.com' } },
    ])] });
    const res = await evaluateGuard(freshOrg(), CTX, sql);
    expect(res.decision).toBe('allow');
  });

  it('downgrades require_approval → allow when a grant matches', async () => {
    const sql = createSqlMock({ taggedResponses: [rows([
      { policy_type: 'require_approval', rules: { action_types: ['api'] } },
      { policy_type: 'allow_grant', rules: { action_type: 'api' } },
    ])] });
    const res = await evaluateGuard(freshOrg(), CTX, sql);
    expect(res.decision).toBe('allow');
  });

  it('NEVER downgrades block', async () => {
    const sql = createSqlMock({ taggedResponses: [rows([
      { policy_type: 'block_action_type', rules: { action_types: ['api'] } },
      { policy_type: 'allow_grant', rules: { action_type: 'api' } },
    ])] });
    const res = await evaluateGuard(freshOrg(), CTX, sql);
    expect(res.decision).toBe('block');
  });

  it('does not downgrade when the grant shape does not match', async () => {
    const sql = createSqlMock({ taggedResponses: [rows([
      { policy_type: 'require_approval', rules: { action_types: ['api'] } },
      { policy_type: 'allow_grant', rules: { action_type: 'api', target_prefix: 'github.com' } },
    ])] });
    const res = await evaluateGuard(freshOrg(), CTX, sql);
    expect(res.decision).toBe('require_approval');
  });
});
