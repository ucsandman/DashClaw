/**
 * /api/guard idempotency replay (Organ 3, Phase 3).
 *
 * A duplicate-key call inside the replay window returns the PRIOR decision
 * and does NOT re-evaluate. Every guard_decisions insert happens inside
 * evaluateGuard (persistGuardDecision), so "evaluateGuard not called" is the
 * proof that a replay writes no new row — which is exactly what keeps the
 * approval-flood / signal / digest window counts honest (they count
 * guard_decisions rows over time windows).
 *
 * Chosen replay semantics (stated for VERIFY): replays write NO new
 * guard_decisions row; the response carries idempotent_replay:true and the
 * prior decision_id, so the audit trail keeps exactly one row per logical
 * evaluation and nothing vanishes.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRequest } from '../helpers.js';

const {
  mockSql, mockValidateGuardInput, mockEvaluateGuard, mockListGuardDecisions,
  mockGetPriorDecision, mockCreateActionRecord, mockGetActionByKey, mockGetOrgHalt,
} = vi.hoisted(() => ({
  mockSql: Object.assign(vi.fn(async () => []), { query: vi.fn(async () => []) }),
  mockValidateGuardInput: vi.fn(),
  mockEvaluateGuard: vi.fn(),
  mockListGuardDecisions: vi.fn(),
  mockGetPriorDecision: vi.fn(),
  mockCreateActionRecord: vi.fn(),
  mockGetActionByKey: vi.fn(),
  mockGetOrgHalt: vi.fn(),
}));

// next/server's after() throws "outside a request scope" in unit tests —
// invoke the deferred side effects immediately (same idiom as actions.route.test.js).
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, after: (cb) => { void cb(); } };
});
vi.mock('@/lib/db.js', () => ({ getSql: () => mockSql }));
vi.mock('@/lib/validate', () => ({ validateGuardInput: mockValidateGuardInput, boundedIdField: (v) => (typeof v === 'string' && v.length > 0 && v.length <= 200 ? v : null), enforcementModeField: (v) => (typeof v === 'string' && ['enforce', 'observe', 'warn', 'off'].includes(v.trim().toLowerCase()) ? v.trim().toLowerCase() : null) }));
vi.mock('@/lib/guard', () => ({ evaluateGuard: mockEvaluateGuard, getOrgHaltState: mockGetOrgHalt }));
vi.mock('@/lib/repositories/guard.repository.js', () => ({
  listGuardDecisions: mockListGuardDecisions,
  getGuardDecisionByIdempotencyKey: mockGetPriorDecision,
}));
vi.mock('@/lib/repositories/actions.repository.js', () => ({
  createActionRecord: mockCreateActionRecord,
  getActionByIdempotencyKey: mockGetActionByKey,
}));
vi.mock('@/lib/repositories/hosted-workspace.repository.js', () => ({ incrementTrialActionCount: vi.fn(async () => undefined) }));
vi.mock('@/lib/events.js', () => ({ EVENTS: { ACTION_CREATED: 'action.created', GUARD_DECISION_CREATED: 'guard.decision' }, publishOrgEvent: vi.fn() }));
vi.mock('@/lib/repositories/jti-replay.repository.js', () => ({
  checkAndRecord: vi.fn(async () => 'unique'),
  sweep: vi.fn(async () => 0),
}));

import { POST } from '@/api/guard/route.js';

const KEY = 'a'.repeat(64);

const PRIOR_ROW = {
  id: 'act_gd_prior1',
  decision: 'require_approval',
  reason: 'Risk score 85 >= threshold 80',
  risk_score: 85,
  matched_policies: '["gp_risk"]',
  verification_status: 'unverified',
  agent_id: 'agt_1',
  agent_name: null,
  created_at: '2026-06-12T10:00:00.000Z',
  // The act this decision was actually made about. A cached verdict may only be
  // served back to the SAME act (see buildReplayBinding in the route): the key
  // is ordinary client input, so without this binding a reused key served a
  // prior `allow` for any payload at all, with no evaluation and no audit row.
  // Real rows always carry it — the replay lookup selects it for this purpose.
  // act_status and verification_status are defaulted onto the payload before it
  // is persisted, so a real stored context always carries them; a fixture
  // without them digests differently and silently never replays.
  context: JSON.stringify({
    action_type: 'deploy',
    declared_goal: 'ship',
    agent_id: 'agt_1',
    act_status: 'not_applicable',
    verification_status: 'unverified',
  }),
};

function guardData(extra = {}) {
  return { action_type: 'deploy', declared_goal: 'ship', agent_id: 'agt_1', idempotency_key: KEY, ...extra };
}

function post(url = 'http://localhost/api/guard', data = guardData()) {
  mockValidateGuardInput.mockReturnValue({ valid: true, data: { ...data }, errors: [] });
  return POST(makeRequest(url, { headers: { 'x-org-id': 'org_1' }, body: data }));
}

describe('/api/guard idempotency replay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATABASE_URL = 'postgres://unit-test';
    process.env.DASHCLAW_MODE = 'cloud';
    mockSql.mockImplementation(async () => []);
    mockSql.query.mockImplementation(async () => []);
    mockGetPriorDecision.mockResolvedValue(null);
    mockGetActionByKey.mockResolvedValue(null);
    mockGetOrgHalt.mockResolvedValue(null); // not halted by default
    mockEvaluateGuard.mockResolvedValue({ decision: 'allow', reasons: [], warnings: [], matched_policies: [], risk_score: 10 });
    mockCreateActionRecord.mockResolvedValue({ action_id: 'act_new1' });
  });

  it('returns the prior decision on a duplicate key without re-evaluating (no new guard_decisions row)', async () => {
    mockGetPriorDecision.mockResolvedValue(PRIOR_ROW);
    const res = await post();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.idempotent_replay).toBe(true);
    expect(body.decision).toBe('require_approval');
    expect(body.decision_id).toBe('act_gd_prior1');
    expect(body.matched_policies).toEqual(['gp_risk']);
    // All guard_decisions inserts live inside evaluateGuard — not calling it
    // IS the no-new-row guarantee that keeps flood/signal counts honest.
    expect(mockEvaluateGuard).not.toHaveBeenCalled();
  });

  // The CRITICAL half of idempotency: the key says "this is the same call",
  // but only the act can prove it. Reusing a key across different acts was a
  // full governance bypass — an `allow` minted for `ls` was served to
  // `rm -rf /` inside the 10-minute window, skipping the evidence classifier,
  // every policy, and the audit row.
  it('does NOT replay when the same key arrives with a different act', async () => {
    mockGetPriorDecision.mockResolvedValue({ ...PRIOR_ROW, decision: 'allow' });
    const res = await post(
      'http://localhost/api/guard',
      guardData({ act: { kind: 'shell', command: 'rm -rf /' } }),
    );
    const body = await res.json();

    expect(body.idempotent_replay).toBeUndefined();
    expect(mockEvaluateGuard).toHaveBeenCalled();
  });

  it('does NOT replay when the declared_goal differs under the same key', async () => {
    mockGetPriorDecision.mockResolvedValue({ ...PRIOR_ROW, decision: 'allow' });
    const res = await post('http://localhost/api/guard', guardData({ declared_goal: 'something else' }));

    expect((await res.json()).idempotent_replay).toBeUndefined();
    expect(mockEvaluateGuard).toHaveBeenCalled();
  });

  // Fail-safe direction: an unreadable/absent context means nothing to bind
  // against, so we evaluate rather than serve a verdict we cannot justify.
  it('evaluates instead of replaying when the prior row has no readable context', async () => {
    const { context: _drop, ...noContext } = PRIOR_ROW;
    mockGetPriorDecision.mockResolvedValue(noContext);
    const res = await post();

    expect((await res.json()).idempotent_replay).toBeUndefined();
    expect(mockEvaluateGuard).toHaveBeenCalled();
  });

  it('evaluates normally when no prior decision exists', async () => {
    const res = await post();
    const body = await res.json();
    expect(body.idempotent_replay).toBeUndefined();
    expect(body.decision).toBe('allow');
    expect(mockEvaluateGuard).toHaveBeenCalledTimes(1);
  });

  it('skips the replay lookup entirely when no key is supplied', async () => {
    await post('http://localhost/api/guard', { action_type: 'deploy', declared_goal: 'ship', agent_id: 'agt_1' });
    expect(mockGetPriorDecision).not.toHaveBeenCalled();
  });

  it('retry-storm: 3 identical ?record=true calls produce exactly 1 action row', async () => {
    const url = 'http://localhost/api/guard?record=true';

    // Call 1: fresh evaluation + record. The route mints the action_id
    // (act_<uuid>) itself — capture it for the replay assertions.
    const res1 = await post(url);
    const body1 = await res1.json();
    expect(body1.recorded).toBe(true);
    expect(body1.action_id).toMatch(/^act_/);
    expect(mockCreateActionRecord).toHaveBeenCalledTimes(1);
    const recordedId = body1.action_id;

    // The first call persisted its decision + action; retries now find both.
    mockGetPriorDecision.mockResolvedValue({ ...PRIOR_ROW, decision: 'allow' });
    mockGetActionByKey.mockResolvedValue({ action_id: recordedId });

    for (const _ of [2, 3]) {
      const res = await post(url);
      const body = await res.json();
      expect(body.idempotent_replay).toBe(true);
      expect(body.recorded).toBe(true);
      expect(body.action_id).toBe(recordedId);
    }

    // 3 calls, 1 effective row: createActionRecord never ran again and the
    // evaluation ran exactly once.
    expect(mockCreateActionRecord).toHaveBeenCalledTimes(1);
    expect(mockEvaluateGuard).toHaveBeenCalledTimes(1);
  });

  it('replay with record=true heals a missing action row by creating it with the same key', async () => {
    mockGetPriorDecision.mockResolvedValue({ ...PRIOR_ROW, decision: 'allow' });
    mockGetActionByKey.mockResolvedValue(null); // prior record attempt failed
    const res = await post('http://localhost/api/guard?record=true');
    const body = await res.json();
    expect(body.idempotent_replay).toBe(true);
    expect(body.recorded).toBe(true);
    expect(mockCreateActionRecord).toHaveBeenCalledTimes(1);
    // The healed row carries the idempotency key so the next retry dedupes.
    expect(mockCreateActionRecord.mock.calls[0][1].data.idempotency_key).toBe(KEY);
  });

  it('distinct keys evaluate independently (distinct actions still create distinct rows)', async () => {
    await post('http://localhost/api/guard', guardData({ idempotency_key: 'k1'.padEnd(64, '0') }));
    await post('http://localhost/api/guard', guardData({ idempotency_key: 'k2'.padEnd(64, '0') }));
    expect(mockEvaluateGuard).toHaveBeenCalledTimes(2);
  });

  it('HALTED org does NOT replay a prior decision — it re-evaluates so the kill switch blocks (Organ-3 seam fix)', async () => {
    // Regression: the idempotency replay returned the cached prior decision
    // BEFORE evaluateGuard ran, and halt is only enforced inside evaluateGuard.
    // So a retried action under an emergency halt was served its old
    // allow/warn/require_approval for up to 10 min. A halted org must skip the
    // replay short-circuit and flow into evaluateGuard (which returns block).
    mockGetOrgHalt.mockResolvedValue({ halted: true, actor: 'usr_admin', reason: 'incident', at: '2026-06-13T00:00:00.000Z' });
    mockGetPriorDecision.mockResolvedValue({ ...PRIOR_ROW, decision: 'require_approval' });
    mockEvaluateGuard.mockResolvedValue({ decision: 'block', reasons: ['Org halted'], warnings: [], matched_policies: ['__org_halt__'], risk_score: 100 });

    const res = await post();
    const body = await res.json();

    // The replay must NOT short-circuit: evaluateGuard runs and the halt blocks.
    expect(body.idempotent_replay).toBeUndefined();
    expect(body.decision).toBe('block');
    expect(mockEvaluateGuard).toHaveBeenCalledTimes(1);
  });

  it('a halted org with NO prior decision is unaffected (still evaluates → block)', async () => {
    mockGetOrgHalt.mockResolvedValue({ halted: true });
    mockEvaluateGuard.mockResolvedValue({ decision: 'block', reasons: ['Org halted'], warnings: [], matched_policies: ['__org_halt__'], risk_score: 100 });
    const res = await post();
    const body = await res.json();
    expect(body.decision).toBe('block');
    expect(mockEvaluateGuard).toHaveBeenCalledTimes(1);
  });
});
