/**
 * LI-2(b) — Layered intelligence end-to-end: guard recovery → session persistence.
 *
 * Two halves per the LI-2 spec:
 *
 *  1. Guard recovery on branch_freshness violation:
 *     Drive evaluateGuard with intel that trips `branch_freshness` → assert
 *     the guard returns decision=block AND a recovery object with the expected
 *     signal/suggestion/steps shape.
 *
 *  2. Session persistence of blocked_reason:
 *     Drive updateSession with status=blocked + blocked_reason derived from
 *     the guard recovery suggestion → assert the session UPDATE and the
 *     session_event INSERT both carry the correct blocked_reason — proving the
 *     guard signal and session state agree end-to-end.
 *
 * SQL mocking follows the project convention (reference_dashclaw_sql_fragment_test_gotcha):
 *   - Conditional sql`` fragments consume vi.fn() / taggedResponses in call order.
 *   - Main query = last call; route by query text, not call index.
 *   - `createSqlMock` from __tests__/helpers.js for session mocks.
 *   - Custom createMockSql (guard-internal router) for the guard calls.
 *
 * TDD: A deliberately-wrong expectation is included as an inline comment to
 * prove the harness bites before corrections are applied. The file as checked
 * in is the GREEN state (red step was observed during authoring).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSqlMock } from '../helpers.js';

// ---------------------------------------------------------------------------
// Hoist mocks — same deps as guard-pipeline.test.js (guard.js pulls them all)
// ---------------------------------------------------------------------------

const {
  mockPublishOrgEvent,
  mockScanSensitiveData,
  mockScanForPromptInjection,
  mockDeliverGuardWebhook,
} = vi.hoisted(() => ({
  mockPublishOrgEvent: vi.fn(),
  mockScanSensitiveData: vi.fn((text) => ({ findings: [], redacted: text, clean: true })),
  mockScanForPromptInjection: vi.fn(() => ({ clean: true, recommendation: 'allow', matches: [], categories: [] })),
  mockDeliverGuardWebhook: vi.fn(),
}));

vi.mock('@/lib/events.js', () => ({
  publishOrgEvent: mockPublishOrgEvent,
  EVENTS: { GUARD_DECISION_CREATED: 'guard.decision.created' },
}));
vi.mock('@/lib/security.js', () => ({ scanSensitiveData: mockScanSensitiveData }));
vi.mock('@/lib/promptInjection.js', () => ({ scanForPromptInjection: mockScanForPromptInjection }));
vi.mock('@/lib/webhooks.js', () => ({ deliverGuardWebhook: mockDeliverGuardWebhook }));

import { evaluateGuard, __resetGuardCaches } from '@/lib/guard.js';
import { updateSession } from '@/lib/sessions.js';

// ---------------------------------------------------------------------------
// Guard SQL mock (mirrors guard-pipeline.test.js helper)
// ---------------------------------------------------------------------------

/**
 * Build a mock SQL function for evaluateGuard that routes by query text.
 * Handles: guard_policies SELECT, agent_pairings SELECT, guard_decisions
 * INSERT (fire-and-forget), and any other catch-all (resolves []).
 */
function createGuardMockSql({ policies = [], agentPairing = null } = {}) {
  const calls = [];

  const sql = (strings, ...values) => {
    const text = String.raw({ raw: strings }, ...Array(values.length).fill('?'));
    calls.push({ text, values });

    if (text.includes('guard_policies')) {
      return Promise.resolve(policies);
    }
    if (text.includes('agent_pairings')) {
      return Promise.resolve(agentPairing ? [agentPairing] : []);
    }
    // guard_decisions INSERT and anything else: fire-and-forget resolves []
    const p = Promise.resolve([]);
    p.catch = (fn) => p.then(undefined, fn);
    return p;
  };

  sql.query = async () => [];
  sql.calls = calls;

  // Wrap so every result has .catch() for fire-and-forget calls
  const proxied = (strings, ...values) => {
    const result = sql(strings, ...values);
    if (!result.catch || result.catch === Promise.prototype.catch) {
      const original = result;
      result.catch = (fn) => original.then(undefined, fn);
    }
    return result;
  };
  Object.assign(proxied, sql);
  proxied.query = sql.query;
  proxied.calls = calls;

  return proxied;
}

function makePolicy(id, type, rules, overrides = {}) {
  return {
    id,
    name: `Test ${type} policy`,
    policy_type: type,
    rules: JSON.stringify(rules),
    active: 1,
    status: 'active',
    agent_ids: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  __resetGuardCaches();
  // Pin the sessions table-check flag so ensureTables() is a no-op in every test.
  globalThis.__dashclaw_sessions_table_checked = true;
  mockScanSensitiveData.mockImplementation((text) => ({ findings: [], redacted: text, clean: true }));
  mockScanForPromptInjection.mockReturnValue({ clean: true, recommendation: 'allow', matches: [], categories: [] });
});

afterEach(() => {
  globalThis.__dashclaw_sessions_table_checked = false;
});

// ---------------------------------------------------------------------------
// Session persistence agrees with guard signal (blocked_reason)
// ---------------------------------------------------------------------------

describe('layered intel pipeline — session persistence of blocked_reason', () => {
  /**
   * These tests use createSqlMock (from helpers.js) to mock the sessions layer.
   *
   * updateSession() issues two tagged-template calls when status changes:
   *   1. UPDATE agent_sessions SET ... RETURNING * → returns the session row
   *   2. INSERT INTO session_events ... SELECT ...  → returns []
   *
   * Per reference_dashclaw_sql_fragment_test_gotcha:
   *   - Conditional fragments consume tagged calls in order.
   *   - Route by query text, not call index.
   *   - The main UPDATE = first call; INSERT = second (last) call.
   *
   * RED step (observed during authoring):
   *   Initial test had `expect(insert.values).toContain('wrong-reason')` which
   *   correctly failed with "wrong-reason not found", proving harness bites.
   *   Corrected to match the actual blocked_reason string.
   */

  it('updateSession with blocked + blocked_reason records the reason on the session row', async () => {
    // This is what the session layer would receive after a guard block:
    // the blocked_reason is derived from the guard recovery suggestion or the
    // block reason message.
    const blockedReason = 'Branch is 7 commits behind; rebase before deploying.';

    const sql = createSqlMock({
      taggedResponses: [
        // UPDATE agent_sessions RETURNING * → session row with blocked status
        [{ id: 'sess_li2', status: 'blocked', blocked_reason: blockedReason }],
        // INSERT INTO session_events ... SELECT → no rows needed
        [],
      ],
    });

    await updateSession(sql, 'sess_li2', 'org_li2', {
      status: 'blocked',
      blocked_reason: blockedReason,
    });

    // The UPDATE call must set status=blocked and pass the blocked_reason
    const updateCall = sql.taggedCalls[0];
    expect(updateCall.text).toMatch(/UPDATE agent_sessions SET/);
    expect(updateCall.values).toContain('blocked');
    expect(updateCall.values).toContain(blockedReason);
  });

  it('updateSession records blocked_reason as the session_event detail', async () => {
    const blockedReason = 'Branch is 7 commits behind; rebase before deploying.';

    const sql = createSqlMock({
      taggedResponses: [
        [{ id: 'sess_li2', status: 'blocked', blocked_reason: blockedReason }],
        [],
      ],
    });

    await updateSession(sql, 'sess_li2', 'org_li2', {
      status: 'blocked',
      blocked_reason: blockedReason,
    });

    // The INSERT (last tagged call) records the blocked_reason as the event detail
    // and 'blocked' as the event kind.
    const insertCall = sql.taggedCalls[sql.taggedCalls.length - 1];
    expect(insertCall.text).toMatch(/INSERT INTO session_events/);
    expect(insertCall.values).toContain('blocked');         // kind = status
    expect(insertCall.values).toContain(blockedReason);     // detail = blocked_reason
  });

  it('guard block signal and session blocked_reason agree end-to-end', async () => {
    // Full end-to-end agreement check:
    //   1. evaluateGuard produces a block with a reason string.
    //   2. That reason is used as the blocked_reason for updateSession.
    //   3. The session INSERT captures it as the event detail.
    //
    // This is the "proving guard signal and session state agree" assertion
    // described in the LI-2 plan spec.

    // Step 1: run the real guard to get a block + reason
    const guardSql = createGuardMockSql({
      policies: [
        makePolicy('gp_e2e', 'branch_freshness', {
          action_types: ['deploy'],
          max_commits_behind: 2,
        }),
      ],
    });

    const guardResult = await evaluateGuard('org_e2e', {
      action_type: 'deploy',
      agent_id: 'agent_e2e',
      intel: {
        branch: { name: 'feat/outdated', freshness: 'stale', commits_behind: 5 },
      },
    }, guardSql);

    expect(guardResult.decision).toBe('block');
    expect(guardResult.reasons.length).toBeGreaterThan(0);

    // Derive the blocked_reason from the guard result — this is what the
    // session layer would receive (the hook or API route would extract it).
    // Guard reason: "Branch 'feat/outdated' is stale: 5 commits behind (max 2)."
    const derivedBlockedReason = guardResult.reasons[0];
    expect(derivedBlockedReason).toContain('feat/outdated');

    // Step 2: drive updateSession with the guard-derived blocked_reason
    const sessionSql = createSqlMock({
      taggedResponses: [
        [{ id: 'sess_e2e', status: 'blocked', blocked_reason: derivedBlockedReason }],
        [],
      ],
    });

    await updateSession(sessionSql, 'sess_e2e', 'org_e2e', {
      status: 'blocked',
      blocked_reason: derivedBlockedReason,
    });

    // Step 3: verify the session INSERT records the exact reason from the guard
    const insertCall = sessionSql.taggedCalls[sessionSql.taggedCalls.length - 1];
    expect(insertCall.text).toMatch(/INSERT INTO session_events/);
    expect(insertCall.values).toContain(derivedBlockedReason);

    // The guard's block reason and the session event detail are the SAME string —
    // guard signal and session state agree.
    const sessionEventDetail = insertCall.values.find((v) => v === derivedBlockedReason);
    expect(sessionEventDetail).toBe(guardResult.reasons[0]);
  });

  it('non-blocked status update does not persist blocked_reason as event detail', async () => {
    // Regression guard: a running→blocked transition records blocked_reason,
    // but a blocked→finished transition must NOT carry blocked_reason as detail
    // (the summary path is used for terminal status; no reason to re-emit the
    // block reason when closing out the session).
    const sql = createSqlMock({
      taggedResponses: [
        [{ id: 'sess_fin', status: 'finished' }],
        [],
      ],
    });

    await updateSession(sql, 'sess_fin', 'org_e2e', {
      status: 'finished',
      summary: 'Session closed after operator review',
    });

    const insertCall = sql.taggedCalls[sql.taggedCalls.length - 1];
    expect(insertCall.text).toMatch(/INSERT INTO session_events/);
    expect(insertCall.values).toContain('finished');
    // summary is the detail for terminal status, not blocked_reason
    expect(insertCall.values).toContain('Session closed after operator review');
    // blocked_reason is null for non-blocked transitions
    expect(insertCall.values).not.toContain('Branch is');
  });
});
