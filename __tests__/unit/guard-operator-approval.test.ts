import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mirror the guard-allow-grant.test.ts mock setup so evaluateGuard runs
// without external services.
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
import { computeActContentHash } from '@/lib/act-content-hash.js';

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

type RoutedSql = GuardSqlParam & { taggedCalls: Array<{ text: string; values: unknown[] }> };

/**
 * SQL mock that routes responses by query TEXT, not call order — the
 * operator-approval lookup is conditional (only fires on require_approval),
 * so ordered queues would be brittle (see signals tests for the same
 * pattern). Unmatched queries resolve to [].
 */
function routedSqlMock(routes: Array<{ match: string; rows: Array<Record<string, unknown>> }>): RoutedSql {
  const taggedCalls: Array<{ text: string; values: unknown[] }> = [];
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = String.raw({ raw: strings }, ...Array(values.length).fill('?'));
    taggedCalls.push({ text, values });
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

  // T6: the gating reasons are forensic context (why the action originally
  // needed approval) — a downgrade must preserve them as warnings, not
  // silently discard them.
  it('T6: moves the gating reasons into warnings (prefixed) instead of discarding them on downgrade', async () => {
    const sql = routedSqlMock([
      { match: 'FROM guard_policies', rows: policyRows([
        { policy_type: 'require_approval', rules: { action_types: ['apply'] }, name: 'Needs review' },
      ]) },
      { match: 'FROM action_records', rows: [APPROVAL_ROW] },
    ]);
    const res = await evaluateGuard(freshOrg(), CTX, sql);
    expect(res.decision).toBe('allow');
    expect(res.reasons).toHaveLength(0);
    expect(res.warnings.some((w) => w.startsWith('superseded by grant: ') && w.includes('Needs review'))).toBe(true);
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

  // ADR Phase 2: a grant is consumed, not a 15-minute season pass. The
  // consuming statement is an atomic UPDATE (stamp approval_grant_used_at
  // WHERE ... IS NULL), so one approval covers exactly one retry even under
  // concurrent identical calls — Postgres row-locking picks the single winner.
  // Exact idempotent retries still replay the resulting allow via the
  // idempotency short-circuit, so the flow's UX is unchanged.
  it('consumes the grant atomically — single-use, stamped via UPDATE ... approval_grant_used_at IS NULL', async () => {
    const sql = routedSqlMock([
      { match: 'FROM guard_policies', rows: policyRows([
        { policy_type: 'require_approval', rules: { action_types: ['apply'] } },
      ]) },
      { match: 'FROM action_records', rows: [APPROVAL_ROW] },
    ]);
    const res = await evaluateGuard(freshOrg(), CTX, sql);
    expect(res.decision).toBe('allow');
    const consume = sql.taggedCalls.find((c) => c.text.includes('approval_grant_used_at'));
    expect(consume).toBeDefined();
    expect(consume!.text).toContain('UPDATE action_records');
    expect(consume!.text).toContain('SET approval_grant_used_at');
    expect(consume!.text).toContain('approval_grant_used_at IS NULL');
  });

  it('binds the grant to the approved action_type, not just the goal string', async () => {
    const sql = routedSqlMock([
      { match: 'FROM guard_policies', rows: policyRows([
        { policy_type: 'require_approval', rules: { action_types: ['apply'] } },
      ]) },
      { match: 'FROM action_records', rows: [APPROVAL_ROW] },
    ]);
    await evaluateGuard(freshOrg(), CTX, sql);
    const consume = sql.taggedCalls.find((c) => c.text.includes('approved_by IS NOT NULL'));
    expect(consume).toBeDefined();
    expect(consume!.text).toContain('action_type');
  });

  // Act-content grant binding (drizzle/0056): the grant only covers a retry
  // presenting the SAME act the approved row was stamped with — approving
  // act X can no longer authorize a different act Y sharing the tuple. Rows
  // without a stamp keep the tuple match (binding tightens, never loosens).
  describe('act-content binding', () => {
    // A file act derives action_type 'apply' (matches CTX.action_type), so
    // evidence folding does not swap the evaluation type out from under the
    // require_approval policy.
    const ACT = { kind: 'file', file: { path: 'C:\\Projects\\demo\\README.md', content_excerpt: '# demo' } };

    it('matches on act_content_hash and binds the retry\'s recomputed hash', async () => {
      const sql = routedSqlMock([
        { match: 'FROM guard_policies', rows: policyRows([
          { policy_type: 'require_approval', rules: { action_types: ['apply'] } },
        ]) },
        { match: 'FROM action_records', rows: [APPROVAL_ROW] },
      ]);
      await evaluateGuard(freshOrg(), { ...CTX, act: ACT }, sql);
      const lookup = sql.taggedCalls.find((c) => c.text.includes('approved_by IS NOT NULL'));
      expect(lookup).toBeDefined();
      expect(lookup!.text).toContain('act_content_hash IS NULL OR act_content_hash =');
      expect(lookup!.values).toContain(computeActContentHash(ACT));
    });

    it('binds NULL when the retry carries no act — only unstamped rows can match', async () => {
      const sql = routedSqlMock([
        { match: 'FROM guard_policies', rows: policyRows([
          { policy_type: 'require_approval', rules: { action_types: ['apply'] } },
        ]) },
        { match: 'FROM action_records', rows: [APPROVAL_ROW] },
      ]);
      await evaluateGuard(freshOrg(), CTX, sql);
      const lookup = sql.taggedCalls.find((c) => c.text.includes('approved_by IS NOT NULL'));
      expect(lookup).toBeDefined();
      expect(lookup!.text).toContain('act_content_hash IS NULL OR act_content_hash =');
      // The hash slot is bound as NULL; SQL equality with NULL never matches a
      // stamped row, so an act-stamped approval cannot be consumed act-blind.
      expect(lookup!.values).toContain(null);
    });

    it('marks the consumed grant act-bound in the decision warning', async () => {
      const sql = routedSqlMock([
        { match: 'FROM guard_policies', rows: policyRows([
          { policy_type: 'require_approval', rules: { action_types: ['apply'] } },
        ]) },
        { match: 'FROM action_records', rows: [{ ...APPROVAL_ROW, act_content_hash: computeActContentHash(ACT) }] },
      ]);
      const res = await evaluateGuard(freshOrg(), { ...CTX, act: ACT }, sql);
      expect(res.decision).toBe('allow');
      expect(res.warnings.join(' ')).toContain('act-bound');
    });

    // Hash stability invariant: the stamp (record create) and the match
    // (retry guard) digest the same bytes ONLY if evaluation never mutates
    // the act object. foldEvidenceIntoContext mutates action_type/target/
    // write_paths on the context — the act itself must stay untouched, or
    // grants silently stop matching (fail-closed, but a UX regression).
    it('never mutates the act object during evaluation', async () => {
      const actBefore = JSON.parse(JSON.stringify(ACT));
      const sql = routedSqlMock([
        { match: 'FROM guard_policies', rows: policyRows([
          { policy_type: 'require_approval', rules: { action_types: ['apply'] } },
        ]) },
        { match: 'FROM action_records', rows: [APPROVAL_ROW] },
      ]);
      await evaluateGuard(freshOrg(), { ...CTX, act: ACT }, sql);
      expect(ACT).toEqual(actBefore);
      expect(computeActContentHash(ACT)).toBe(computeActContentHash(actBefore));
    });

    it('keeps the plain warning for tuple-matched (unstamped) grants', async () => {
      const sql = routedSqlMock([
        { match: 'FROM guard_policies', rows: policyRows([
          { policy_type: 'require_approval', rules: { action_types: ['apply'] } },
        ]) },
        { match: 'FROM action_records', rows: [APPROVAL_ROW] },
      ]);
      const res = await evaluateGuard(freshOrg(), CTX, sql);
      expect(res.decision).toBe('allow');
      expect(res.warnings.join(' ')).not.toContain('act-bound');
    });
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
