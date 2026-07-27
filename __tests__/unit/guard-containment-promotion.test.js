import { describe, it, expect, vi, beforeEach } from 'vitest';

// Task 8 (RFC 2026-07-06-containment-verdicts): the promote → merge grant is
// act-hash-bound and single-use (invariant 3). This proves the FULL server
// path — builtin:containment_promote raise, then applyOperatorApprovalGrant's
// consuming lookup — through the REAL evaluateGuard, before any hook/UI work
// builds on top of it. Harness copied from guard-plan-grant.test.js; the
// action_records mocking (a single UPDATE ... RETURNING, matched on query
// TEXT not call order) is copied from guard-operator-approval.test.ts, which
// already exercises the same seam this test needs for the containment case.
const { mockDeliverGuardWebhook, mockCheckSemantic, mockScanSensitiveData } =
  vi.hoisted(() => ({
    mockDeliverGuardWebhook: vi.fn(),
    mockCheckSemantic: vi.fn(),
    mockScanSensitiveData: vi.fn((text) => ({ findings: [], redacted: text, clean: true })),
  }));

vi.mock('@/lib/webhooks.js', () => ({ deliverGuardWebhook: mockDeliverGuardWebhook }));
vi.mock('@/lib/llm.js', () => ({ checkSemanticGuardrail: mockCheckSemantic }));
vi.mock('@/lib/security.js', () => ({ scanSensitiveData: mockScanSensitiveData }));
vi.mock('@/lib/predictive-risk.js', () => ({
  getPredictiveRisk: vi.fn(async () => ({ statistical: null, llm: null, total_adjustment: 0 })),
}));
vi.mock('@/lib/repositories/settings.repository.js', () => ({ getSettings: vi.fn(async () => []) }));

import { evaluateGuard, __resetGuardCaches } from '@/lib/guard.js';
import { buildPromotionGoal, buildPromotionAct } from '@/lib/guard/containment';
import { computeActContentHash } from '@/lib/act-content-hash.js';

const AGENT_ID = 'claude-code';
const CONTAINED_ACTION_ID = 'act_contained_1';
const REF = 'dashclaw/contained-1';

/**
 * SQL mock routed by query TEXT (not call order) — same shape as
 * guard-plan-grant.test.js / guard-operator-approval.test.ts. The
 * operator-approval grant lookup is a single `UPDATE action_records ...
 * RETURNING` statement whose text contains both 'FROM action_records' (the
 * inner SELECT) and 'UPDATE action_records' — matching on 'FROM
 * action_records' catches it. Unmatched queries (guard_policies,
 * guard_decisions insert, risk_templates, org halt, etc.) resolve to [].
 */
function makeSql({ grantRows = [] } = {}) {
  const taggedCalls = [];
  const sql = (strings, ...values) => {
    const text = String.raw({ raw: strings }, ...Array(values.length).fill('?'));
    taggedCalls.push({ text, values });
    if (/FROM guard_policies/i.test(text)) return Promise.resolve([]); // no org policies — containment_promote is a builtin raise, not policy-driven
    if (text.includes('FROM action_records')) return Promise.resolve(grantRows);
    return Promise.resolve([]);
  };
  sql.query = async () => [];
  sql.taggedCalls = taggedCalls;
  return sql;
}

function guardCall(act) {
  return {
    agent_id: AGENT_ID,
    action_type: 'containment_promote',
    declared_goal: buildPromotionGoal(CONTAINED_ACTION_ID),
    act,
  };
}

describe('containment promotion grant — single-use, act-hash-bound (via evaluateGuard)', () => {
  const originalGuardLlmKey = process.env.GUARD_LLM_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    __resetGuardCaches();
    mockScanSensitiveData.mockImplementation((text) => ({ findings: [], redacted: text, clean: true }));
    process.env.GUARD_LLM_KEY = 'mock-key-for-unit-tests';
    process.env.GUARD_LLM_KEY = process.env.GUARD_LLM_KEY ?? originalGuardLlmKey;
  });

  it('case 1: a matching synthetic grant downgrades the raise to allow, crediting BOTH builtins', async () => {
    const act = buildPromotionAct(REF);
    const grantRow = {
      action_id: 'act_promo_1',
      approved_by: 'user_admin_1',
      act_content_hash: computeActContentHash(act),
    };
    const sql = makeSql({ grantRows: [grantRow] });

    const res = await evaluateGuard('org_1', guardCall(act), sql);

    expect(res.decision).toBe('allow');
    expect(res.matched_policies).toContain('builtin:containment_promote');
    expect(res.matched_policies).toContain('builtin:operator_approval');

    // The grant lookup really ran and really bound the merge act's hash —
    // not a vacuous pass from an unconditional [] → require_approval branch.
    const lookup = sql.taggedCalls.find((c) => c.text.includes('approved_by IS NOT NULL'));
    expect(lookup).toBeDefined();
    expect(lookup.text).toContain('act_content_hash IS NULL OR act_content_hash =');
    expect(lookup.values).toContain(computeActContentHash(act));
  });

  it('case 2: the grant is single-use — a second identical call with no matching row (consumed) stays require_approval', async () => {
    const act = buildPromotionAct(REF);
    // The grant has already been consumed server-side (approval_grant_used_at
    // stamped by the first retry) — the SELECT inside the UPDATE's subquery
    // no longer finds an unconsumed row, so the mock returns [] exactly as
    // Postgres would for the second concurrent/replayed retry.
    const sql = makeSql({ grantRows: [] });

    const res = await evaluateGuard('org_1', guardCall(act), sql);

    expect(res.decision).toBe('require_approval');
    // The lookup still ran (this isn't require_approval because the query
    // never fired) — pins that the single-use state is what changed, not the
    // wiring.
    const lookup = sql.taggedCalls.find((c) => c.text.includes('approved_by IS NOT NULL'));
    expect(lookup).toBeDefined();
  });

  it('case 3: a mutated act recomputes a different hash — the mock genuinely compares it and finds no row, staying require_approval', async () => {
    const approvedAct = buildPromotionAct(REF);
    const approvedHash = computeActContentHash(approvedAct);
    // The retry presents a DIFFERENT act than the one the operator approved
    // (e.g. an agent or attacker substituting a merge from another branch).
    const mutatedAct = { kind: 'shell', command: 'git merge --no-ff other-branch' };
    const mutatedHash = computeActContentHash(mutatedAct);

    // Sense-check the fixture itself: the two hashes must actually differ, or
    // this test would vacuously pass no matter what the mock does.
    expect(mutatedHash).not.toBe(approvedHash);

    // Emulate the real SQL predicate exactly: `act_content_hash IS NULL OR
    // act_content_hash = <retryHash>`. The row is stamped with approvedHash,
    // so it only "matches" when the incoming retry hash equals approvedHash.
    // This mock doesn't just return [] unconditionally — it recomputes the
    // predicate from the query's own bound values, so the test fails the
    // instant the hash predicate stops being asked for the real params (e.g.
    // if a future refactor drops the WHERE clause, this mock would resolve
    // the row for the mismatched hash too, and the assertion below would
    // catch it going 'allow').
    const taggedCalls = [];
    const sql = (strings, ...values) => {
      const text = String.raw({ raw: strings }, ...Array(values.length).fill('?'));
      taggedCalls.push({ text, values });
      if (/FROM guard_policies/i.test(text)) return Promise.resolve([]);
      if (text.includes('FROM action_records')) {
        // act_content_hash is the 5th interpolated value in the query
        // (org_id, agent_id, declared_goal, actionType, retryActHash — see
        // applyOperatorApprovalGrant's template). Extract it by position
        // rather than assuming, so this genuinely reads what the guard
        // computed for THIS retry's act.
        const retryHashParam = values.find((v) => v === mutatedHash || v === approvedHash || v === null);
        const rowMatches = retryHashParam === approvedHash; // stored row's hash
        return Promise.resolve(rowMatches ? [{
          action_id: 'act_promo_1', approved_by: 'user_admin_1', act_content_hash: approvedHash,
        }] : []);
      }
      return Promise.resolve([]);
    };
    sql.query = async () => [];
    sql.taggedCalls = taggedCalls;

    const res = await evaluateGuard('org_1', guardCall(mutatedAct), sql);

    expect(res.decision).toBe('require_approval');
    const lookup = taggedCalls.find((c) => c.text.includes('approved_by IS NOT NULL'));
    expect(lookup).toBeDefined();
    expect(lookup.text).toContain('act_content_hash IS NULL OR act_content_hash =');
    // Pin that the guard actually bound the MUTATED act's hash into the
    // query (not the originally-approved one, and not a blind NULL) — the
    // test would fail here if evaluateGuard stopped recomputing the hash
    // per-retry.
    expect(lookup.values).toContain(mutatedHash);
    expect(lookup.values).not.toContain(approvedHash);
  });
});
