import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mirror the guard-allow-grant.test.ts mock setup so evaluateGuard runs
// without external services.
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

let orgN = 0;
const freshOrg = () => `org_opapproval_${++orgN}`;

function policyRows(policies: Array<{ policy_type: string; rules: Record<string, unknown>; name?: string }>) {
  return policies.map((p, i) => ({
    id: `gp_t_${i}`,
    name: p.name ?? `P${i}`,
    policy_type: p.policy_type,
    rules: JSON.stringify(p.rules),
    agent_ids: null,
  }));
}

type GuardSqlParam = Parameters<typeof evaluateGuard>[2];

type RoutedSql = GuardSqlParam & { taggedCalls: Array<{ text: string }> };

/**
 * SQL mock that routes responses by query TEXT, not call order — the
 * operator-approval lookup is conditional (only fires on require_approval),
 * so ordered queues would be brittle (see signals tests for the same
 * pattern). Unmatched queries resolve to [].
 */
function routedSqlMock(routes: Array<{ match: string; rows: Array<Record<string, unknown>> }>): RoutedSql {
  const taggedCalls: Array<{ text: string }> = [];
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = String.raw({ raw: strings }, ...Array(values.length).fill('?'));
    taggedCalls.push({ text });
    const hit = routes.find((r) => text.includes(r.match));
    return Promise.resolve(hit ? hit.rows : []);
  }) as unknown as RoutedSql;
  sql.query = async () => [];
  sql.taggedCalls = taggedCalls;
  return sql;
}

const CTX = {
  agent_id: 'claude-code',
  action_type: 'apply',
  declared_goal: 'Write: C:\\Projects\\demo\\.env.example',
  risk_score: 40,
};

const APPROVAL_ROW = {
  action_id: 'act_approved_1',
  approved_by: 'user_admin_1',
};

describe('operator-approval post-pass', () => {
  beforeEach(() => __resetGuardCaches());

  it('downgrades require_approval → allow when a recent HITL approval matches', async () => {
    const sql = routedSqlMock([
      { match: 'FROM guard_policies', rows: policyRows([
        { policy_type: 'require_approval', rules: { action_types: ['apply'] } },
      ]) },
      { match: 'FROM action_records', rows: [APPROVAL_ROW] },
    ]);
    const res = await evaluateGuard(freshOrg(), CTX, sql);
    expect(res.decision).toBe('allow');
    expect(res.matched_policies).toContain('builtin:operator_approval');
    expect(res.warnings.join(' ')).toContain('act_approved_1');
  });

  it('stays require_approval when no approval matches', async () => {
    const sql = routedSqlMock([
      { match: 'FROM guard_policies', rows: policyRows([
        { policy_type: 'require_approval', rules: { action_types: ['apply'] } },
      ]) },
      { match: 'FROM action_records', rows: [] },
    ]);
    const res = await evaluateGuard(freshOrg(), CTX, sql);
    expect(res.decision).toBe('require_approval');
  });

  it('matches on agent_id + exact declared_goal within the window', async () => {
    const sql = routedSqlMock([
      { match: 'FROM guard_policies', rows: policyRows([
        { policy_type: 'require_approval', rules: { action_types: ['apply'] } },
      ]) },
      { match: 'FROM action_records', rows: [APPROVAL_ROW] },
    ]);
    await evaluateGuard(freshOrg(), CTX, sql);
    const lookup = sql.taggedCalls.find((c) => c.text.includes('FROM action_records'));
    expect(lookup).toBeDefined();
    expect(lookup!.text).toContain('approved_by IS NOT NULL');
    expect(lookup!.text).toContain('declared_goal');
    expect(lookup!.text).toContain('make_interval');
  });

  it('NEVER downgrades block — blocks are absolute', async () => {
    const sql = routedSqlMock([
      { match: 'FROM guard_policies', rows: policyRows([
        { policy_type: 'block_action_type', rules: { action_types: ['apply'] } },
      ]) },
      { match: 'FROM action_records', rows: [APPROVAL_ROW] },
    ]);
    const res = await evaluateGuard(freshOrg(), CTX, sql);
    expect(res.decision).toBe('block');
    expect(res.matched_policies).not.toContain('builtin:operator_approval');
  });

  it('does not query the ledger for allow/warn decisions', async () => {
    const sql = routedSqlMock([
      { match: 'FROM guard_policies', rows: policyRows([
        { policy_type: 'warn_action_type', rules: { action_types: ['apply'] } },
      ]) },
    ]);
    const res = await evaluateGuard(freshOrg(), CTX, sql);
    expect(res.decision).toBe('warn');
    expect(sql.taggedCalls.some((c) => c.text.includes('approved_by IS NOT NULL'))).toBe(false);
  });

  it('fails closed (stays require_approval) when the ledger lookup throws', async () => {
    const inner = routedSqlMock([
      { match: 'FROM guard_policies', rows: policyRows([
        { policy_type: 'require_approval', rules: { action_types: ['apply'] } },
      ]) },
    ]);
    const throwing = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = String.raw({ raw: strings }, ...Array(values.length).fill('?'));
      if (text.includes('FROM action_records')) return Promise.reject(new Error('db down'));
      return (inner as unknown as (s: TemplateStringsArray, ...v: unknown[]) => Promise<Array<Record<string, unknown>>>)(strings, ...values);
    }) as unknown as RoutedSql;
    Object.assign(throwing, { query: inner.query, taggedCalls: inner.taggedCalls });
    const res = await evaluateGuard(freshOrg(), CTX, throwing);
    expect(res.decision).toBe('require_approval');
  });

  it('skips the lookup when agent_id is missing', async () => {
    const sql = routedSqlMock([
      { match: 'FROM guard_policies', rows: policyRows([
        { policy_type: 'require_approval', rules: { action_types: ['apply'] } },
      ]) },
      { match: 'FROM action_records', rows: [APPROVAL_ROW] },
    ]);
    const res = await evaluateGuard(freshOrg(), { ...CTX, agent_id: undefined }, sql);
    expect(res.decision).toBe('require_approval');
    expect(sql.taggedCalls.some((c) => c.text.includes('approved_by IS NOT NULL'))).toBe(false);
  });
});
