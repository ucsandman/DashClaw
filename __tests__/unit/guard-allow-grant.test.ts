import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mirror the proven guard-engine.test.js mock setup so evaluateGuard runs
// without external services and only the policy-load tagged query touches sql.
const { mockDeliverGuardWebhook, mockCheckSemantic, mockScanSensitiveData } =
  vi.hoisted(() => ({
    mockDeliverGuardWebhook: vi.fn(),
    mockCheckSemantic: vi.fn(),
    mockScanSensitiveData: vi.fn((text: string) => ({ findings: [], redacted: text, clean: true })),
  }));

vi.mock('@/lib/webhooks.js', () => ({ deliverGuardWebhook: mockDeliverGuardWebhook }));
vi.mock('@/lib/llm.js', () => ({ checkSemanticGuardrail: mockCheckSemantic }));
vi.mock('@/lib/security.js', () => ({ scanSensitiveData: mockScanSensitiveData }));
vi.mock('@/lib/predictive-risk.js', () => ({
  getPredictiveRisk: vi.fn(async () => ({ statistical: null, llm: null, total_adjustment: 0 })),
}));
vi.mock('@/lib/repositories/settings.repository.js', () => ({ getSettings: vi.fn(async () => []) }));

import { evaluateGuard, __resetGuardCaches } from '@/lib/guard.js';
import { createSqlMock } from '../helpers.js';

let orgN = 0;
const freshOrg = () => `org_grant_${++orgN}`;

function rows(policies: Array<{ policy_type: string; rules: Record<string, unknown>; name?: string; created_at?: string }>) {
  return policies.map((p, i) => ({
    id: `gp_t_${i}`,
    name: p.name ?? `P${i}`,
    policy_type: p.policy_type,
    rules: JSON.stringify(p.rules),
    agent_ids: null,
    // Grants without an explicit rules.expires_at age out from created_at
    // (F1 TTL); default the synthetic rows to "just created" so existing
    // expectations exercise the live-grant path.
    created_at: p.created_at ?? new Date().toISOString(),
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

describe('allow_grant risk ceiling', () => {
  beforeEach(() => __resetGuardCaches());

  // The evaluated score is max(server, client), so a client-declared score is
  // enough to drive the ceiling without hand-building a high-risk context.
  const at = (risk: number) => ({ ...CTX, risk_score: risk });
  const grantRows = (grant: Record<string, unknown>) => rows([
    { policy_type: 'require_approval', rules: { action_types: ['api'] } },
    { policy_type: 'allow_grant', name: 'Scratch grant', rules: { action_type: 'api', target_prefix: 'api.stripe.com', ...grant } },
  ]);

  it('downgrades below the ceiling', async () => {
    const sql = createSqlMock({ taggedResponses: [grantRows({})] });
    const res = await evaluateGuard(freshOrg(), at(69), sql);
    expect(res.decision).toBe('allow');
  });

  it('does NOT downgrade at the ceiling', async () => {
    const sql = createSqlMock({ taggedResponses: [grantRows({})] });
    const res = await evaluateGuard(freshOrg(), at(70), sql);
    expect(res.decision).toBe('require_approval');
  });

  it('does NOT downgrade above the ceiling', async () => {
    const sql = createSqlMock({ taggedResponses: [grantRows({})] });
    const res = await evaluateGuard(freshOrg(), at(90), sql);
    expect(res.decision).toBe('require_approval');
  });

  // A silent skip reads to the operator as "my grant stopped working".
  it('explains itself when it declines', async () => {
    const sql = createSqlMock({ taggedResponses: [grantRows({})] });
    const res = await evaluateGuard(freshOrg(), at(90), sql);
    expect((res.warnings || []).join(' ')).toMatch(/Scratch grant: grant does not cover risk 90 \(ceiling 70\)/);
  });

  it('honors an explicit lower ceiling', async () => {
    const sql = createSqlMock({ taggedResponses: [grantRows({ max_risk: 30 })] });
    const res = await evaluateGuard(freshOrg(), at(45), sql);
    expect(res.decision).toBe('require_approval');
  });

  it('honors an explicit higher ceiling', async () => {
    const sql = createSqlMock({ taggedResponses: [grantRows({ max_risk: 95 })] });
    const res = await evaluateGuard(freshOrg(), at(90), sql);
    expect(res.decision).toBe('allow');
  });

  // A grant the ceiling rejects must not consume the pass: a narrower grant
  // further down the list still gets its chance.
  it('a ceiling-rejected grant does not block a later matching one', async () => {
    const sql = createSqlMock({ taggedResponses: [rows([
      { policy_type: 'require_approval', rules: { action_types: ['api'] } },
      { policy_type: 'allow_grant', name: 'Tight', rules: { action_type: 'api', target_prefix: 'api.stripe.com', max_risk: 10 } },
      { policy_type: 'allow_grant', name: 'Loose', rules: { action_type: 'api', target_prefix: 'api.stripe.com', max_risk: 95 } },
    ])] });
    const res = await evaluateGuard(freshOrg(), at(50), sql);
    expect(res.decision).toBe('allow');
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

// F1 (governance gap audit 2026-08-05): grants silently nullified every
// require_approval policy in the audited org — no expiry, no mandatory scope,
// and reclassification let a grant on one action_type satisfy a policy
// written on another. Each guard below is the fix for one of those.
describe('allow_grant F1 guards', () => {
  beforeEach(() => __resetGuardCaches());

  const DAY = 24 * 60 * 60 * 1000;
  const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString();

  it('an EXPIRED grant (explicit expires_at) no longer downgrades', async () => {
    const sql = createSqlMock({ taggedResponses: [rows([
      { policy_type: 'require_approval', rules: { action_types: ['api'] } },
      { policy_type: 'allow_grant', rules: { action_type: 'api', target_prefix: 'api.stripe.com', expires_at: daysAgo(1) } },
    ])] });
    const res = await evaluateGuard(freshOrg(), CTX, sql);
    expect(res.decision).toBe('require_approval');
  });

  it('a legacy grant with no expires_at ages out from created_at (30d TTL)', async () => {
    const sql = createSqlMock({ taggedResponses: [rows([
      { policy_type: 'require_approval', rules: { action_types: ['api'] } },
      { policy_type: 'allow_grant', rules: { action_type: 'api' }, created_at: daysAgo(31) },
    ])] });
    const res = await evaluateGuard(freshOrg(), CTX, sql);
    expect(res.decision).toBe('require_approval');
  });

  it('a legacy grant inside the TTL still downgrades (no retroactive breakage)', async () => {
    const sql = createSqlMock({ taggedResponses: [rows([
      { policy_type: 'require_approval', rules: { action_types: ['api'] } },
      { policy_type: 'allow_grant', rules: { action_type: 'api' }, created_at: daysAgo(3) },
    ])] });
    const res = await evaluateGuard(freshOrg(), CTX, sql);
    expect(res.decision).toBe('allow');
  });

  it('no grant survives reclassification — the live 3-layer X-post repro', async () => {
    // The audit's specimen: an operator policy on `post`, an act the evidence
    // classifier derives as `api`, and a grant on `api`. The evaluation swaps
    // onto the derived type (so restrictive rules still match), and the grant
    // must NOT be able to satisfy the policy across that swap.
    const sql = createSqlMock({ taggedResponses: [rows([
      { policy_type: 'require_approval', rules: { action_types: ['post', 'social_post'] }, name: 'Require approval: social posts' },
      { policy_type: 'allow_grant', rules: { action_type: 'api', target_prefix: 'api.x.com' }, name: '[Grant] api → api.x.com' },
    ])] });
    const res = await evaluateGuard(freshOrg(), {
      agent_id: 'agent_1',
      action_type: 'post',
      declared_goal: 'post the launch note to X',
      act: { kind: 'http', request: { method: 'POST', url: 'https://api.x.com/2/tweets' } },
    }, sql);
    expect(res.decision).toBe('require_approval');
  });

  it('an UNGRANTABLE gating rule is never cleared, even by a matching grant', async () => {
    const sql = createSqlMock({ taggedResponses: [rows([
      { policy_type: 'require_approval', rules: { action_types: ['api'], ungrantable: true }, name: 'Protect the control plane' },
      { policy_type: 'allow_grant', rules: { action_type: 'api', target_prefix: 'api.stripe.com' } },
    ])] });
    const res = await evaluateGuard(freshOrg(), CTX, sql);
    expect(res.decision).toBe('require_approval');
    expect((res.warnings || []).join(' ')).toContain('ungrantable');
  });
});
