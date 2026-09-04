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
function makeSql({ grantRows = [], policyRows = [] } = {}) {
  const taggedCalls = [];
  const sql = (strings, ...values) => {
    const text = String.raw({ raw: strings }, ...Array(values.length).fill('?'));
    taggedCalls.push({ text, values });
    if (/FROM guard_policies/i.test(text)) return Promise.resolve(policyRows);
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
  beforeEach(() => {
    vi.clearAllMocks();
    __resetGuardCaches();
    mockScanSensitiveData.mockImplementation((text) => ({ findings: [], redacted: text, clean: true }));
    process.env.GUARD_LLM_KEY = 'mock-key-for-unit-tests';
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
    // Pin the action_type bound param too: a partial regression that deletes
    // the fold-guard (d4a99405) but keeps the OR-clause's action_type check
    // would swap context.action_type to 'apply' before this lookup runs,
    // breaking the real Postgres match — but this mock returns grantRows
    // unconditionally regardless of the bound action_type, so only an
    // explicit assertion on the bound value catches that regression.
    expect(lookup.values).toContain('containment_promote');
    expect(lookup.values).not.toContain('apply');
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
        // Find the retry's bound act-hash value by matching against the two
        // known candidate hashes (not by position — the query interpolates
        // several other values too) so this genuinely reads what the guard
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

// IMPORTANT 2 (final fix wave, 2026-07-27) / Locked Decision 5: "promote
// click grants exactly one" must hold even when the org has an allow_grant
// policy or an approved plan step that happens to name action_type
// containment_promote — neither may stand in for the single-use promote
// grant. Only applyOperatorApprovalGrant (the promote click itself) may ever
// downgrade this raise.
describe('containment_promote is excluded from allow_grant and plan-step grants', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetGuardCaches();
    mockScanSensitiveData.mockImplementation((text) => ({ findings: [], redacted: text, clean: true }));
    process.env.GUARD_LLM_KEY = 'mock-key-for-unit-tests';
  });

  it('an allow_grant policy naming containment_promote does NOT downgrade the raise', async () => {
    const act = buildPromotionAct(REF);
    const allowGrantPolicy = {
      id: 'gp_allow_containment',
      name: 'Allow containment merges',
      policy_type: 'allow_grant',
      rules: JSON.stringify({ action_type: 'containment_promote' }),
    };
    const sql = makeSql({ grantRows: [], policyRows: [allowGrantPolicy] });

    const res = await evaluateGuard('org_1', guardCall(act), sql);

    expect(res.decision).toBe('require_approval');
    expect(res.matched_policies).toContain('builtin:containment_promote');
    expect(res.matched_policies).not.toContain('gp_allow_containment');
  });

  it('an approved plan step naming containment_promote does NOT downgrade the raise (plan_authorization_steps is never even queried)', async () => {
    const act = buildPromotionAct(REF);
    const taggedCalls = [];
    const sql = (strings, ...values) => {
      const text = String.raw({ raw: strings }, ...Array(values.length).fill('?'));
      taggedCalls.push({ text, values });
      if (/FROM guard_policies/i.test(text)) return Promise.resolve([]);
      if (/plan_authorization_steps/i.test(text)) {
        // If this ever fires, the containment_promote guard regressed — a
        // consumable row here would otherwise downgrade to allow.
        return Promise.resolve([{
          step_id: 'ps_step1', plan_id: 'pa_plan1', seq: 1, reviewed_by: 'wes@example.com',
          act_content_hash: null, total_steps: 1,
        }]);
      }
      if (text.includes('FROM action_records')) return Promise.resolve([]);
      return Promise.resolve([]);
    };
    sql.query = async () => [];
    sql.taggedCalls = taggedCalls;

    const res = await evaluateGuard('org_1', guardCall(act), sql);

    expect(res.decision).toBe('require_approval');
    expect(res.matched_policies).toContain('builtin:containment_promote');
    expect(res.matched_policies).not.toContain('builtin:plan_grant');
    expect(taggedCalls.some((c) => /plan_authorization_steps/i.test(c.text))).toBe(false);
  });

  // IMPORTANT 6 minor (final fix wave, 2026-07-27): foldEvidenceIntoContext's
  // containment_promote carve-out (evaluate.ts ~line 842) keeps the mismatch
  // MODIFIER (evidence still raises risk) while suppressing only the
  // action_type SWAP, so the sentinel stays visible to the builtin raise and
  // the grant lookup's action_type predicate (Task 8's governed-merge-bypass
  // finding). This is the branch's worst catch and was untested at this seam.
  it('foldEvidenceIntoContext keeps the mismatch modifier + evidence_mismatch:true but never swaps action_type away from containment_promote', async () => {
    const act = buildPromotionAct(REF);
    const sql = makeSql({ grantRows: [], policyRows: [] }); // no grant — proves the raise (not a downgrade) is what's under test

    const res = await evaluateGuard('org_1', guardCall(act), sql);

    // The canonical merge act's derived base_risk (35) exceeds
    // containment_promote's 'other'-floor declared base (20), so evidence
    // MUST be graded as a mismatch — a false here would mean the mismatch
    // detection itself regressed, making the rest of this test vacuous.
    expect(res.evidence_mismatch).toBe(true);
    // The type swap must be suppressed: the raise below only fires on
    // action_type === 'containment_promote' (or declared_action_type as a
    // defense-in-depth backup) — matched_policies proves the sentinel was
    // still recognized as containment_promote, not silently swapped to
    // whatever the evidence classifier derived from the shell command.
    expect(res.decision).toBe('require_approval');
    expect(res.matched_policies).toContain('builtin:containment_promote');
  });

  it('the operator-approval promotion grant (the promote click itself) still downgrades to allow', async () => {
    const act = buildPromotionAct(REF);
    const grantRow = {
      action_id: 'act_promo_1',
      approved_by: 'user_admin_1',
      act_content_hash: computeActContentHash(act),
    };
    const sql = makeSql({ grantRows: [grantRow], policyRows: [] });

    const res = await evaluateGuard('org_1', guardCall(act), sql);

    expect(res.decision).toBe('allow');
    expect(res.matched_policies).toContain('builtin:operator_approval');
  });

  // Database containment (RFC 2026-09-04): the promotion act for a db ref is
  // the action's ORIGINAL recorded act, so the same act-hash binding now
  // covers a REPLAY on production instead of a merge. Same single-use grant,
  // same builtins — only the act differs.
  describe('db ref promotion', () => {
    const DB_REF = 'dashclaw/contained-db-1';
    const ORIGINAL_ACT = { kind: 'shell', command: 'psql -c "alter table users add column tier text"' };

    it('the grant minted from the original act is consumed by a retry presenting that same act', async () => {
      const act = buildPromotionAct(DB_REF, ORIGINAL_ACT);
      expect(act).toEqual(ORIGINAL_ACT);
      const grantRow = {
        action_id: 'act_promo_db_1',
        approved_by: 'user_admin_1',
        act_content_hash: computeActContentHash(act),
      };
      const sql = makeSql({ grantRows: [grantRow] });

      const res = await evaluateGuard('org_1', guardCall(act), sql);

      expect(res.decision).toBe('allow');
      expect(res.matched_policies).toContain('builtin:containment_promote');
      expect(res.matched_policies).toContain('builtin:operator_approval');
      const lookup = sql.taggedCalls.find((c) => c.text.includes('approved_by IS NOT NULL'));
      expect(lookup.values).toContain(computeActContentHash(ORIGINAL_ACT));
      expect(lookup.values).toContain('containment_promote');
    });

    it('a merge-shaped act does NOT satisfy a db grant (different hash, no row)', async () => {
      const approvedHash = computeActContentHash(ORIGINAL_ACT);
      const mergeAct = { kind: 'shell', command: `git merge --no-ff ${DB_REF}` };
      expect(computeActContentHash(mergeAct)).not.toBe(approvedHash);

      const taggedCalls = [];
      const sql = (strings, ...values) => {
        const text = String.raw({ raw: strings }, ...Array(values.length).fill('?'));
        taggedCalls.push({ text, values });
        if (/FROM guard_policies/i.test(text)) return Promise.resolve([]);
        if (text.includes('FROM action_records')) {
          // Emulate the real predicate: the stamped row only matches when the
          // retry's hash equals the approved one.
          return Promise.resolve(values.includes(approvedHash)
            ? [{ action_id: 'act_promo_db_1', approved_by: 'user_admin_1', act_content_hash: approvedHash }]
            : []);
        }
        return Promise.resolve([]);
      };
      sql.query = async () => [];
      sql.taggedCalls = taggedCalls;

      const res = await evaluateGuard('org_1', guardCall(mergeAct), sql);

      expect(res.decision).toBe('require_approval');
      expect(res.matched_policies).toContain('builtin:containment_promote');
    });
  });
});
