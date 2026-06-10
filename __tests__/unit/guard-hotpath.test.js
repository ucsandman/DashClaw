import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makeRequest, createSqlMock } from '../helpers.js';

// ─────────────────────────────────────────────────────────────────────────────
// Guard HOT-PATH tests (phase 2): query-count budget, policy-cache TTL and
// invalidation, predictive-risk gating, and the additive ?record=true param.
// Complements guard-characterization.test.js (which pins decision outputs).
// ─────────────────────────────────────────────────────────────────────────────

const { mockDeliverGuardWebhook, mockCheckSemantic, mockIsEmbeddingsEnabled } = vi.hoisted(() => ({
  mockDeliverGuardWebhook: vi.fn(),
  mockCheckSemantic: vi.fn(),
  mockIsEmbeddingsEnabled: vi.fn(() => false),
}));

vi.mock('@/lib/webhooks.js', () => ({ deliverGuardWebhook: mockDeliverGuardWebhook }));
vi.mock('@/lib/llm.js', () => ({ checkSemanticGuardrail: mockCheckSemantic }));
vi.mock('@/lib/embeddings.js', () => ({ isEmbeddingsEnabled: mockIsEmbeddingsEnabled, generateActionEmbedding: vi.fn() }));

import { evaluateGuard, invalidateGuardPolicyCache, __resetGuardCaches } from '@/lib/guard.js';

let orgCounter = 0;
const freshOrg = () => `org_hot_${++orgCounter}`;

const blockPolicy = {
  id: 'gp_block', name: 'Block deploys', policy_type: 'block_action_type',
  rules: JSON.stringify({ action_types: ['deploy'] }),
};

const CTX = { action_type: 'other', agent_id: 'a1', agent_name: 'Bot', declared_goal: 'do a thing' };

beforeEach(() => {
  vi.clearAllMocks();
  __resetGuardCaches();
});

// A nested sql`` fragment (query composition, e.g. a conditional AND clause)
// is recorded by the mock but is NOT a DB round-trip — neon inlines it into
// the parent statement. Count only top-level statements.
const isStatement = (text) => /^\s*(SELECT|INSERT|UPDATE|DELETE|WITH)\b/i.test(text);
const roundTrips = (sql) =>
  sql.taggedCalls.filter((c) => isStatement(c.text)).length +
  sql.queryCalls.filter((c) => isStatement(c.text)).length;

describe('guard hot path — DB round-trip budget', () => {
  it('default path executes ≤4 DB round-trips cold and ≤2 warm (was ~9)', async () => {
    const org = freshOrg();
    const sql = createSqlMock({ taggedResponses: [[]] });
    await evaluateGuard(org, CTX, sql);
    expect(roundTrips(sql)).toBeLessThanOrEqual(4);

    const sql2 = createSqlMock({ taggedResponses: [[]] });
    await evaluateGuard(org, CTX, sql2);
    expect(roundTrips(sql2)).toBeLessThanOrEqual(2);
  });

  it('cold path queries exactly: policies, predictive settings, batched learning context, decision insert', async () => {
    const sql = createSqlMock({ taggedResponses: [[]] });
    await evaluateGuard(freshOrg(), CTX, sql);
    const texts = sql.taggedCalls.map((c) => c.text);
    expect(texts.filter((t) => t.includes('FROM guard_policies')).length).toBe(1);
    expect(texts.filter((t) => t.includes('FROM settings')).length).toBe(1);
    expect(texts.filter((t) => t.includes('learning_episodes')).length).toBe(1); // ONE batched query
    expect(texts.filter((t) => t.includes('INSERT INTO guard_decisions')).length).toBe(1);
  });

  it('predictive risk is skipped entirely when PREDICTIVE_RISK_ENABLED is off (no historical-stats query)', async () => {
    const sql = createSqlMock({ taggedResponses: [[]] });
    const result = await evaluateGuard(freshOrg(), CTX, sql);
    const texts = sql.taggedCalls.map((c) => c.text).concat(sql.queryCalls.map((c) => c.text));
    expect(texts.some((t) => t.includes('action_records') && t.includes('AVG'))).toBe(false);
    expect(result.predictive_risk).toBeUndefined();
  });
});

describe('guard hot path — policy cache', () => {
  it('serves policies from cache within the TTL and re-queries after invalidation', async () => {
    const org = freshOrg();
    const sql1 = createSqlMock({ taggedResponses: [[blockPolicy]] });
    const r1 = await evaluateGuard(org, { ...CTX, action_type: 'deploy' }, sql1);
    expect(r1.decision).toBe('block');

    // Second call: policies come from cache (no guard_policies query), decision identical.
    const sql2 = createSqlMock({ taggedResponses: [[]] }); // would return NO policies if queried
    const r2 = await evaluateGuard(org, { ...CTX, action_type: 'deploy' }, sql2);
    expect(r2.decision).toBe('block');
    expect(sql2.taggedCalls.some((c) => c.text.includes('FROM guard_policies'))).toBe(false);

    // Invalidation (what policy mutation routes call) forces a fresh read.
    invalidateGuardPolicyCache(org);
    const sql3 = createSqlMock({ taggedResponses: [[]] });
    const r3 = await evaluateGuard(org, { ...CTX, action_type: 'deploy' }, sql3);
    expect(r3.decision).toBe('allow');
    expect(sql3.taggedCalls.some((c) => c.text.includes('FROM guard_policies'))).toBe(true);
  });

  it('cache TTL is ≤60s: a policy change is picked up without invalidation after the TTL window', async () => {
    vi.useFakeTimers();
    try {
      const org = freshOrg();
      const sql1 = createSqlMock({ taggedResponses: [[blockPolicy]] });
      await evaluateGuard(org, { ...CTX, action_type: 'deploy' }, sql1);

      vi.advanceTimersByTime(61_000);

      const sql2 = createSqlMock({ taggedResponses: [[]] });
      const r2 = await evaluateGuard(org, { ...CTX, action_type: 'deploy' }, sql2);
      expect(sql2.taggedCalls.some((c) => c.text.includes('FROM guard_policies'))).toBe(true);
      expect(r2.decision).toBe('allow');
    } finally {
      vi.useRealTimers();
    }
  });
});

// ── ?record=true route contract ──

const { routeSqlHolder } = vi.hoisted(() => ({ routeSqlHolder: { sql: null } }));
vi.mock('@/lib/db.js', () => ({ getSql: () => routeSqlHolder.sql }));
vi.mock('@/lib/repositories/jti-replay.repository.js', () => ({
  checkAndRecord: vi.fn(async () => 'unique'),
  sweep: vi.fn(async () => 0),
}));
vi.mock('@/lib/usage.js', () => ({
  getOrgPlan: vi.fn(async () => 'free'),
  checkQuotaFast: vi.fn(async () => ({ allowed: true })),
  incrementMeter: vi.fn(async () => {}),
}));
vi.mock('@/lib/repositories/hosted-workspace.repository.js', () => ({
  incrementTrialActionCount: vi.fn(async () => {}),
}));
vi.mock('@/lib/repositories/agents.repository.js', () => ({
  upsertAgentPresence: vi.fn(async () => {}),
}));

import { POST as guardPost } from '@/api/guard/route.js';
import { checkQuotaFast as mockedCheckQuota } from '@/lib/usage.js';

describe('POST /api/guard?record=true', () => {
  beforeEach(() => {
    process.env.DATABASE_URL = 'postgres://unit-test';
    routeSqlHolder.sql = createSqlMock({ taggedResponses: [[]] });
  });

  afterEach(() => {
    vi.mocked(mockedCheckQuota).mockResolvedValue({ allowed: true });
  });

  const BODY = { action_type: 'other', agent_id: 'a1', agent_name: 'Bot', declared_goal: 'do a thing' };

  it('returns action_id and creates exactly one action record (provenance fields kept)', async () => {
    const res = await guardPost(makeRequest('http://localhost/api/guard?record=true', {
      headers: { 'x-org-id': freshOrg() },
      // trigger + swarm_id are what the hook's two-call flow persisted on the
      // action record — the guard schema must not strip them.
      body: { ...BODY, trigger: 'subagent:Explore', swarm_id: 'sess-123' },
    }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.decision).toBe('allow');
    expect(data.recorded).toBe(true);
    expect(data.action_id).toMatch(/^act_[0-9a-f-]{36}$/); // real action record id, not the act_gd_ alias
    expect(data.decision_id).toMatch(/^act_gd_/);
    const inserts = routeSqlHolder.sql.taggedCalls.filter((c) => c.text.includes('INSERT INTO action_records'));
    expect(inserts.length).toBe(1);
    expect(inserts[0].values).toContain('subagent:Explore');
    expect(inserts[0].values).toContain('sess-123');
  });

  it('omitted param → response has no recorded keys and action_id stays the decision_id alias', async () => {
    const res = await guardPost(makeRequest('http://localhost/api/guard', {
      headers: { 'x-org-id': freshOrg() }, body: BODY,
    }));
    const data = await res.json();
    expect(data).not.toHaveProperty('recorded');
    expect(data).not.toHaveProperty('recorded_error');
    expect(data.action_id).toBe(data.decision_id);
    const inserts = routeSqlHolder.sql.taggedCalls.filter((c) => c.text.includes('INSERT INTO action_records'));
    expect(inserts.length).toBe(0);
  });

  it('block decision → no action record created, recorded:false', async () => {
    routeSqlHolder.sql = createSqlMock({
      taggedResponses: [[{
        id: 'gp_block', name: 'Block', policy_type: 'block_action_type',
        rules: JSON.stringify({ action_types: ['deploy'] }),
      }]],
    });
    const res = await guardPost(makeRequest('http://localhost/api/guard?record=true', {
      headers: { 'x-org-id': freshOrg() }, body: { ...BODY, action_type: 'deploy' },
    }));
    const data = await res.json();
    expect(data.decision).toBe('block');
    expect(data.recorded).toBe(false);
    const inserts = routeSqlHolder.sql.taggedCalls.filter((c) => c.text.includes('INSERT INTO action_records'));
    expect(inserts.length).toBe(0);
  });

  it('require_approval decision → record created with pending_approval status', async () => {
    routeSqlHolder.sql = createSqlMock({
      taggedResponses: [[{
        id: 'gp_appr', name: 'Approve', policy_type: 'require_approval',
        rules: JSON.stringify({ action_types: ['deploy'] }),
      }]],
    });
    const res = await guardPost(makeRequest('http://localhost/api/guard?record=true', {
      headers: { 'x-org-id': freshOrg() }, body: { ...BODY, action_type: 'deploy' },
    }));
    const data = await res.json();
    expect(data.decision).toBe('require_approval');
    expect(data.recorded).toBe(true);
    const insert = routeSqlHolder.sql.taggedCalls.find((c) => c.text.includes('INSERT INTO action_records'));
    expect(insert.values).toContain('pending_approval');
  });

  it('quota exhausted → guard decision still returned, recorded:false with reason, no insert', async () => {
    vi.mocked(mockedCheckQuota).mockResolvedValue({ allowed: false, usage: 100, limit: 100 });
    const res = await guardPost(makeRequest('http://localhost/api/guard?record=true', {
      headers: { 'x-org-id': freshOrg() }, body: BODY,
    }));
    const data = await res.json();
    expect(data.decision).toBe('allow');
    expect(data.recorded).toBe(false);
    expect(data.recorded_error).toContain('limit');
    const inserts = routeSqlHolder.sql.taggedCalls.filter((c) => c.text.includes('INSERT INTO action_records'));
    expect(inserts.length).toBe(0);
  });
});
