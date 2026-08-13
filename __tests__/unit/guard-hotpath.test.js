import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makeRequest, createSqlMock } from '../helpers.js';

// ─────────────────────────────────────────────────────────────────────────────
// Guard HOT-PATH tests (phase 2): query-count budget, policy-cache TTL and
// invalidation, predictive-risk gating, and the additive ?record=true param.
// Complements guard-characterization.test.js (which pins decision outputs).
// ─────────────────────────────────────────────────────────────────────────────

const { mockDeliverGuardWebhook, mockCheckSemantic } = vi.hoisted(() => ({
  mockDeliverGuardWebhook: vi.fn(),
  mockCheckSemantic: vi.fn(),
}));

vi.mock('@/lib/webhooks.js', () => ({ deliverGuardWebhook: mockDeliverGuardWebhook }));
vi.mock('@/lib/llm.js', () => ({ checkSemanticGuardrail: mockCheckSemantic }));

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
  it('default path executes ≤6 DB round-trips cold and ≤2 warm (was ~9)', async () => {
    // Cold budget went 4 → 5 deliberately (supergoal P4): the org risk-template
    // layer adds ONE cached query per org per 30s TTL window. 5 → 6 deliberately
    // (RFC 2026-08-11-plan-deviation-events §8): the deviation detector's
    // hasLivePlan pre-gate adds ONE cached EXISTS probe per org:agent per 30s.
    // Warm stays ≤2 — both extra queries answer from cache.
    const org = freshOrg();
    const sql = createSqlMock({ taggedResponses: [[]] });
    await evaluateGuard(org, CTX, sql);
    expect(roundTrips(sql)).toBeLessThanOrEqual(6);

    const sql2 = createSqlMock({ taggedResponses: [[]] });
    await evaluateGuard(org, CTX, sql2);
    expect(roundTrips(sql2)).toBeLessThanOrEqual(2);
  });

  it('cold path queries exactly: policies, risk templates, predictive settings, decision insert', async () => {
    const sql = createSqlMock({ taggedResponses: [[]] });
    await evaluateGuard(freshOrg(), CTX, sql);
    const texts = sql.taggedCalls.map((c) => c.text);
    expect(texts.filter((t) => t.includes('FROM guard_policies')).length).toBe(1);
    expect(texts.filter((t) => t.includes('FROM risk_templates')).length).toBe(1); // cached 30s thereafter
    expect(texts.filter((t) => t.includes('FROM settings')).length).toBe(1);
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
    // Response order: settings (halt check, P4) first, then guard_policies.
    const sql1 = createSqlMock({ taggedResponses: [[], [blockPolicy]] });
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

  // Positional taggedResponses are a trap for this test: on a policy-cache
  // hit the response meant for guard_policies gets consumed by an unrelated
  // query (the plan-steps lookup) and can flip the decision for the wrong
  // reason. Answer by query text instead.
  const policyOnlySql = (policyRows) => {
    const taggedCalls = [];
    const sqlFn = (strings, ...values) => {
      const text = String.raw({ raw: strings }, ...Array(values.length).fill('?'));
      taggedCalls.push({ text, values });
      return Promise.resolve(text.includes('FROM guard_policies') ? policyRows : []);
    };
    sqlFn.query = async () => [];
    sqlFn.taggedCalls = taggedCalls;
    return sqlFn;
  };

  it('a policy created on ANOTHER instance is enforced within 3s — NOT the 30s settings TTL', async () => {
    // Live incident (2026-08-13): a freshly created require_approval policy
    // answered `allow` with zero matched policies — eager invalidation only
    // reaches the instance that served the policy write, and other warm
    // lambdas kept their (empty) 30s policy cache. Same cross-instance bound
    // as the halt cache (guard-halt-cache.test.js): ~3s.
    vi.useFakeTimers();
    try {
      const org = freshOrg();
      // First call: org has no policies yet → allow, empty set cached.
      const r1 = await evaluateGuard(org, { ...CTX, action_type: 'deploy' }, policyOnlySql([]));
      expect(r1.decision).toBe('allow');

      // Policy created via another instance — no invalidation reaches this one.
      vi.advanceTimersByTime(3_100);
      const sql2 = policyOnlySql([blockPolicy]);
      const r2 = await evaluateGuard(org, { ...CTX, action_type: 'deploy' }, sql2);
      expect(sql2.taggedCalls.some((c) => c.text.includes('FROM guard_policies'))).toBe(true);
      expect(r2.decision).toBe('block');
    } finally {
      vi.useRealTimers();
    }
  });

  it('cache TTL is ≤60s: a policy change is picked up without invalidation after the TTL window', async () => {
    vi.useFakeTimers();
    try {
      const org = freshOrg();
      // Response order: settings (halt check, P4) first, then guard_policies.
      const sql1 = createSqlMock({ taggedResponses: [[], [blockPolicy]] });
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
// next/server's after() throws "outside a request scope" in unit tests —
// invoke the deferred side effects immediately (same idiom as actions.route.test.js).
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, after: (cb) => { void cb(); } };
});
vi.mock('@/lib/db.js', () => ({ getSql: () => routeSqlHolder.sql }));
vi.mock('@/lib/repositories/jti-replay.repository.js', () => ({
  checkAndRecord: vi.fn(async () => 'unique'),
  sweep: vi.fn(async () => 0),
}));
vi.mock('@/lib/repositories/hosted-workspace.repository.js', () => ({
  incrementTrialActionCount: vi.fn(async () => {}),
}));

import { POST as guardPost } from '@/api/guard/route.js';

describe('POST /api/guard?record=true', () => {
  beforeEach(() => {
    process.env.DATABASE_URL = 'postgres://unit-test';
    routeSqlHolder.sql = createSqlMock({ taggedResponses: [[]] });
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

  it('block decision → blocked record created in-request, recorded:true', async () => {
    // Contract change (2026-08-06): the record path creates the blocked action
    // row itself, reusing this evaluation. The old recorded:false answer made
    // the hook fall back to POST /api/actions, whose re-evaluation wrote a
    // duplicate guard_decisions row for every block.
    routeSqlHolder.sql = createSqlMock({
      // Response order: settings (halt check, P4) first, then guard_policies.
      taggedResponses: [[], [{
        id: 'gp_block', name: 'Block', policy_type: 'block_action_type',
        rules: JSON.stringify({ action_types: ['deploy'] }),
      }]],
    });
    const res = await guardPost(makeRequest('http://localhost/api/guard?record=true', {
      headers: { 'x-org-id': freshOrg() }, body: { ...BODY, action_type: 'deploy' },
    }));
    const data = await res.json();
    expect(data.decision).toBe('block');
    expect(data.recorded).toBe(true);
    expect(data.action_id).not.toBe(data.decision_id);
    const inserts = routeSqlHolder.sql.taggedCalls.filter((c) => c.text.includes('INSERT INTO action_records'));
    expect(inserts.length).toBe(1);
    expect(inserts[0].values).toContain('blocked');
  });

  it('require_approval decision → record created with pending_approval status', async () => {
    routeSqlHolder.sql = createSqlMock({
      // Response order: settings (halt check, P4) first, then guard_policies.
      taggedResponses: [[], [{
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

});
