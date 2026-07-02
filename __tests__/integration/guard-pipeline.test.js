/**
 * Integration tests for the DashClaw guard pipeline.
 *
 * These tests exercise evaluateGuard end-to-end through the real policy
 * evaluation logic (no mocking of guard internals). Only external I/O
 * dependencies (events, security scanning, prompt injection, embeddings,
 * learning context, webhooks, LLM) are stubbed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { baseAgentId } from '@/lib/agent-identity-resolve.js';

// Hoist mocks so they are available before module imports
const {
  mockPublishOrgEvent,
  mockScanSensitiveData,
  mockScanForPromptInjection,
  mockIsEmbeddingsEnabled,
  mockGetLearningContext,
  mockDeliverGuardWebhook,
  mockCheckSemantic,
} = vi.hoisted(() => ({
  mockPublishOrgEvent: vi.fn(),
  mockScanSensitiveData: vi.fn((text) => ({ findings: [], redacted: text, clean: true })),
  mockScanForPromptInjection: vi.fn(() => ({ clean: true, recommendation: 'allow', matches: [], categories: [] })),
  mockIsEmbeddingsEnabled: vi.fn(() => false),
  mockGetLearningContext: vi.fn(() => null),
  mockDeliverGuardWebhook: vi.fn(),
  mockCheckSemantic: vi.fn(),
}));

vi.mock('@/lib/events.js', () => ({
  publishOrgEvent: mockPublishOrgEvent,
  EVENTS: { GUARD_DECISION_CREATED: 'guard.decision.created' },
}));
vi.mock('@/lib/security.js', () => ({ scanSensitiveData: mockScanSensitiveData }));
vi.mock('@/lib/promptInjection.js', () => ({ scanForPromptInjection: mockScanForPromptInjection }));
vi.mock('@/lib/embeddings.js', () => ({ isEmbeddingsEnabled: mockIsEmbeddingsEnabled, generateActionEmbedding: vi.fn() }));
vi.mock('@/lib/learning-context.js', () => ({ getLearningContext: mockGetLearningContext }));
vi.mock('@/lib/webhooks.js', () => ({ deliverGuardWebhook: mockDeliverGuardWebhook }));
vi.mock('@/lib/llm.js', () => ({ checkSemanticGuardrail: mockCheckSemantic }));

import { evaluateGuard, computeRiskScore, __resetGuardCaches } from '@/lib/guard.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a mock SQL function that serves canned responses for the guard
 * pipeline's tagged-template queries.
 *
 * @param {Object} options
 * @param {Array}  options.policies        - Rows to return for guard_policies SELECT
 * @param {Object} [options.agentPairing]  - Single row for agent_pairings SELECT (or null)
 * @returns {Function} A mock sql tagged-template function with .query() and .catch() support
 */
function createMockSql({ policies = [], agentPairing = null } = {}) {
  const calls = [];

  const sql = (strings, ...values) => {
    const text = String.raw({ raw: strings }, ...Array(values.length).fill('?'));
    calls.push({ text, values });

    // Route based on the query text
    if (text.includes('guard_policies')) {
      return Promise.resolve(policies);
    }
    if (text.includes('agent_pairings')) {
      return Promise.resolve(agentPairing ? [agentPairing] : []);
    }
    // guard_decisions INSERT and anything else: fire-and-forget
    const p = Promise.resolve([]);
    p.catch = (fn) => p.then(undefined, fn);
    return p;
  };

  sql.query = async () => [];
  sql.calls = calls;

  // Ensure every tagged-template result has .catch() for fire-and-forget usage
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

/**
 * Build a policy fixture.
 */
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
// Tests
// ---------------------------------------------------------------------------

describe('guard pipeline integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Guard hot-path caches (policies, predictive settings) persist at module
    // level; tests here reuse the same org with different policies per case.
    __resetGuardCaches();
    mockScanSensitiveData.mockImplementation((text) => ({ findings: [], redacted: text, clean: true }));
    mockScanForPromptInjection.mockReturnValue({ clean: true, recommendation: 'allow', matches: [], categories: [] });
  });

  // 1. permission_escalation: blocks when agent lacks permission
  it('permission escalation: blocks when agent lacks permission', async () => {
    const sql = createMockSql({
      policies: [
        makePolicy('gp_test_1', 'permission_escalation', { enforce: true }),
      ],
      agentPairing: { permission_level: 'workspace_write' },
    });

    const context = {
      agent_id: 'agent_1',
      action_type: 'deploy',
      intel: { tool: { required_permission: 'danger' } },
    };

    const result = await evaluateGuard('org_1', context, sql);

    expect(result.decision).toBe('block');
    expect(result.reasons).toEqual(
      expect.arrayContaining([expect.stringContaining('Permission escalation')]),
    );
    expect(result.reasons[0]).toContain('workspace_write');
    expect(result.reasons[0]).toContain('danger');
    expect(result.matched_policies).toContain('gp_test_1');
    // decision_id is the canonical guard-evaluation id; action_id is a deprecated
    // alias of the SAME value (not the action_records id).
    expect(result.decision_id).toMatch(/^act_gd_/);
    expect(result.action_id).toBe(result.decision_id);
  });

  it('baseAgentId resolves the parent of a composed sub-agent id', () => {
    expect(baseAgentId('claude-code:explore')).toBe('claude-code');
    expect(baseAgentId('claude-code')).toBe(null);
    expect(baseAgentId(undefined)).toBe(null);
  });

  it('permission escalation: a composed sub-agent id inherits the base parent pairing', async () => {
    const sql = createMockSql({
      policies: [makePolicy('gp_sub', 'permission_escalation', { enforce: true })],
      agentPairing: { permission_level: 'workspace_write' }, // the parent's pairing
    });
    const context = {
      agent_id: 'claude-code:explore', // composed sub-agent id with no pairing of its own
      action_type: 'deploy',
      intel: { tool: { required_permission: 'danger' } },
    };
    const result = await evaluateGuard('org_1', context, sql);
    // inherited workspace_write < danger -> escalation blocked using the inherited level
    expect(result.decision).toBe('block');
    expect(result.reasons[0]).toContain('workspace_write');
    // the pairing lookup carried BOTH the composed id and the base parent
    const pairingCall = sql.calls.find((c) => c.text.includes('agent_pairings') && c.text.includes('permission_level'));
    expect(pairingCall.values).toContain('claude-code:explore');
    expect(pairingCall.values).toContain('claude-code');
  });

  it('agent-targeted policies apply to composed sub-agent ids of the targeted parent (roadmap v2.2)', async () => {
    // Without base-id fallback in policy targeting, flipping the sub-agent
    // identity default to `distinct` would silently detach every
    // agent-targeted policy from delegated work.
    const sql = createMockSql({
      policies: [makePolicy('gp_targeted', 'permission_escalation', { enforce: true }, { agent_ids: JSON.stringify(['claude-code']) })],
      agentPairing: { permission_level: 'workspace_write' },
    });
    const context = {
      agent_id: 'claude-code:explore',
      action_type: 'deploy',
      intel: { tool: { required_permission: 'danger' } },
    };
    const result = await evaluateGuard('org_1', context, sql);
    expect(result.decision).toBe('block');
    expect(result.matched_policies).toContain('gp_targeted');
  });

  it('agent-targeted policies still skip unrelated composed ids', async () => {
    const sql = createMockSql({
      policies: [makePolicy('gp_other', 'permission_escalation', { enforce: true }, { agent_ids: JSON.stringify(['some-other-agent']) })],
      agentPairing: { permission_level: 'workspace_write' },
    });
    const context = {
      agent_id: 'claude-code:explore',
      action_type: 'deploy',
      intel: { tool: { required_permission: 'danger' } },
    };
    const result = await evaluateGuard('org_1', context, sql);
    expect(result.matched_policies).not.toContain('gp_other');
  });

  // 2. permission_escalation: allows when agent has sufficient permission
  it('permission escalation: allows when agent has sufficient permission', async () => {
    const sql = createMockSql({
      policies: [
        makePolicy('gp_test_2', 'permission_escalation', { enforce: true }),
      ],
      agentPairing: { permission_level: 'danger' },
    });

    const context = {
      agent_id: 'agent_1',
      action_type: 'deploy',
      intel: { tool: { required_permission: 'danger' } },
    };

    const result = await evaluateGuard('org_1', context, sql);

    expect(result.decision).toBe('allow');
    expect(result.reasons).toHaveLength(0);
  });

  // 3. green_contract: blocks deploy without sufficient green
  it('green contract: blocks deploy without sufficient green', async () => {
    const sql = createMockSql({
      policies: [
        makePolicy('gp_test_3', 'green_contract', {
          action_types: ['deploy'],
          required_level: 'workspace',
        }),
      ],
    });

    const context = {
      action_type: 'deploy',
      intel: { green: { observed_level: 'targeted' } },
    };

    const result = await evaluateGuard('org_1', context, sql);

    expect(result.decision).toBe('block');
    expect(result.reasons[0]).toContain('Green contract');
    expect(result.reasons[0]).toContain('observed targeted');
    expect(result.reasons[0]).toContain('required workspace');
    expect(result.matched_policies).toContain('gp_test_3');
  });

  // 4. green_contract: allows deploy with sufficient green
  it('green contract: allows deploy with sufficient green', async () => {
    const sql = createMockSql({
      policies: [
        makePolicy('gp_test_4', 'green_contract', {
          action_types: ['deploy'],
          required_level: 'workspace',
        }),
      ],
    });

    const context = {
      action_type: 'deploy',
      intel: { green: { observed_level: 'workspace' } },
    };

    const result = await evaluateGuard('org_1', context, sql);

    expect(result.decision).toBe('allow');
    expect(result.reasons).toHaveLength(0);
  });

  // 5. green_contract: blocks when no green reported
  it('green contract: blocks when no green reported', async () => {
    const sql = createMockSql({
      policies: [
        makePolicy('gp_test_5', 'green_contract', {
          action_types: ['deploy'],
          required_level: 'workspace',
        }),
      ],
    });

    const context = {
      action_type: 'deploy',
      intel: {},
    };

    const result = await evaluateGuard('org_1', context, sql);

    expect(result.decision).toBe('block');
    expect(result.reasons[0]).toContain('no test status reported');
    expect(result.matched_policies).toContain('gp_test_5');
  });

  // 6. branch_freshness: blocks stale deploy
  it('branch freshness: blocks stale deploy', async () => {
    const sql = createMockSql({
      policies: [
        makePolicy('gp_test_6', 'branch_freshness', {
          action_types: ['deploy'],
          max_commits_behind: 2,
        }),
      ],
    });

    const context = {
      action_type: 'deploy',
      intel: {
        branch: { name: 'feat/old', freshness: 'stale', commits_behind: 3 },
      },
    };

    const result = await evaluateGuard('org_1', context, sql);

    expect(result.decision).toBe('block');
    expect(result.reasons[0]).toContain('feat/old');
    expect(result.reasons[0]).toContain('stale');
    expect(result.reasons[0]).toContain('3 commits behind');
    expect(result.matched_policies).toContain('gp_test_6');
  });

  // 7. branch_freshness: allows fresh branch
  it('branch freshness: allows fresh branch', async () => {
    const sql = createMockSql({
      policies: [
        makePolicy('gp_test_7', 'branch_freshness', {
          action_types: ['deploy'],
          max_commits_behind: 5,
        }),
      ],
    });

    const context = {
      action_type: 'deploy',
      intel: {
        branch: { name: 'feat/new', freshness: 'fresh', commits_behind: 0 },
      },
    };

    const result = await evaluateGuard('org_1', context, sql);

    expect(result.decision).toBe('allow');
    expect(result.reasons).toHaveLength(0);
  });

  // 8. recovery recipe in response
  it('recovery recipe in response for green_contract block', async () => {
    const sql = createMockSql({
      policies: [
        makePolicy('gp_test_8', 'green_contract', {
          action_types: ['deploy'],
          required_level: 'workspace',
        }),
      ],
    });

    const context = {
      action_type: 'deploy',
      agent_id: 'agent_1',
      intel: { green: { observed_level: 'targeted' } },
    };

    const result = await evaluateGuard('org_1', context, sql);

    expect(result.decision).toBe('block');
    expect(result.recovery).toBeDefined();
    expect(result.recovery.signal).toBe('green_insufficient');
    expect(result.recovery.suggestion).toEqual(expect.stringContaining('workspace'));
    expect(result.recovery.steps).toEqual(
      expect.arrayContaining([expect.objectContaining({ action: 'suggest_test_run' })]),
    );
  });

  // 9. multiple policies compose — highest severity wins
  it('multiple policies compose: highest severity wins', async () => {
    const sql = createMockSql({
      policies: [
        makePolicy('gp_test_9a', 'permission_escalation', { enforce: true }),
        makePolicy('gp_test_9b', 'green_contract', {
          action_types: ['deploy'],
          required_level: 'workspace',
        }),
      ],
      agentPairing: { permission_level: 'workspace_write' },
    });

    const context = {
      agent_id: 'agent_1',
      action_type: 'deploy',
      intel: {
        tool: { required_permission: 'danger' },
        green: { observed_level: 'targeted' },
      },
    };

    const result = await evaluateGuard('org_1', context, sql);

    // Both policies trigger a block — both should appear in matched_policies
    expect(result.decision).toBe('block');
    expect(result.matched_policies).toContain('gp_test_9a');
    expect(result.matched_policies).toContain('gp_test_9b');
    expect(result.reasons.length).toBeGreaterThanOrEqual(2);
    expect(result.reasons.some(r => r.includes('Permission escalation'))).toBe(true);
    expect(result.reasons.some(r => r.includes('Green contract'))).toBe(true);
  });

  // 10. backward compatibility — no intel, no new policies
  it('backward compatibility: no intel, no new policies produces allow', async () => {
    const sql = createMockSql({ policies: [] });

    const context = {
      action_type: 'read',
      agent_id: 'agent_1',
    };

    const result = await evaluateGuard('org_1', context, sql);

    expect(result.decision).toBe('allow');
    expect(result.reasons).toHaveLength(0);
    expect(result.matched_policies).toHaveLength(0);
    expect(result.risk_score).toEqual(expect.any(Number));
    expect(result.evaluated_at).toEqual(expect.any(String));
    expect(result.recovery).toBeUndefined();
  });
});
