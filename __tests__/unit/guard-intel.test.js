import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockDeliverGuardWebhook, mockCheckSemantic, mockIsEmbeddingsEnabled, mockGenerateEmbedding, mockScanSensitiveData } = vi.hoisted(() => ({
  mockDeliverGuardWebhook: vi.fn(),
  mockCheckSemantic: vi.fn(),
  mockIsEmbeddingsEnabled: vi.fn(() => false),
  mockGenerateEmbedding: vi.fn(),
  mockScanSensitiveData: vi.fn((text) => ({ findings: [], redacted: text, clean: true })),
}));

vi.mock('@/lib/webhooks.js', () => ({ deliverGuardWebhook: mockDeliverGuardWebhook }));
vi.mock('@/lib/llm.js', () => ({ checkSemanticGuardrail: mockCheckSemantic }));
vi.mock('@/lib/embeddings.js', () => ({ isEmbeddingsEnabled: mockIsEmbeddingsEnabled, generateActionEmbedding: mockGenerateEmbedding }));
vi.mock('@/lib/security.js', () => ({ scanSensitiveData: mockScanSensitiveData }));
// Predictive risk is dynamically imported in guard.js — mock to avoid consuming SQL mock responses
vi.mock('@/lib/predictive-risk.js', () => ({ getPredictiveRisk: vi.fn(async () => ({ statistical: null, llm: null, total_adjustment: 0 })) }));
vi.mock('@/lib/repositories/settings.repository.js', () => ({ getSettings: vi.fn(async () => []) }));

import { evaluateGuard, __resetGuardCaches } from '@/lib/guard.js';
import { createSqlMock } from '../helpers.js';

function makePolicy(type, rules, overrides = {}) {
  return {
    id: `gp_${type}`,
    name: `Policy ${type}`,
    policy_type: type,
    rules: JSON.stringify(rules),
    ...overrides,
  };
}

describe('guard intel-aware policy types', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Guard hot-path caches persist at module level; tests reuse one org id.
    __resetGuardCaches();
    mockScanSensitiveData.mockImplementation((text) => ({ findings: [], redacted: text, clean: true }));
  });

  // --- permission_escalation ---

  describe('permission_escalation', () => {
    it('blocks when tool requires danger but agent has workspace_write', async () => {
      // First tagged call: guard_policies query returns the policy
      // Second tagged call: agent_pairings query returns workspace_write level
      const sql = createSqlMock({
        taggedResponses: [
          [makePolicy('permission_escalation', { enforce: true })],
          [{ permission_level: 'workspace_write' }],
        ],
      });
      const context = {
        agent_id: 'agent_1',
        action_type: 'deploy',
        intel: { tool: { required_permission: 'danger' } },
      };
      const result = await evaluateGuard('org_1', context, sql);
      expect(result.decision).toBe('block');
      expect(result.reasons[0]).toContain('Permission escalation');
      expect(result.reasons[0]).toContain('workspace_write');
      expect(result.reasons[0]).toContain('danger');
    });

    it('allows when agent level meets tool requirement', async () => {
      const sql = createSqlMock({
        taggedResponses: [
          [makePolicy('permission_escalation', { enforce: true })],
          [{ permission_level: 'danger' }],
        ],
      });
      const context = {
        agent_id: 'agent_1',
        action_type: 'deploy',
        intel: { tool: { required_permission: 'danger' } },
      };
      const result = await evaluateGuard('org_1', context, sql);
      expect(result.decision).toBe('allow');
    });

    it('allows when agent level exceeds tool requirement', async () => {
      const sql = createSqlMock({
        taggedResponses: [
          [makePolicy('permission_escalation', { enforce: true })],
          [{ permission_level: 'allow' }],
        ],
      });
      const context = {
        agent_id: 'agent_1',
        action_type: 'deploy',
        intel: { tool: { required_permission: 'workspace_write' } },
      };
      const result = await evaluateGuard('org_1', context, sql);
      expect(result.decision).toBe('allow');
    });

    it('skips when enforce is false', async () => {
      const sql = createSqlMock({
        taggedResponses: [
          [makePolicy('permission_escalation', { enforce: false })],
        ],
      });
      const context = {
        agent_id: 'agent_1',
        action_type: 'deploy',
        intel: { tool: { required_permission: 'danger' } },
      };
      const result = await evaluateGuard('org_1', context, sql);
      expect(result.decision).toBe('allow');
    });

    it('defaults agent level to danger when no pairing found', async () => {
      const sql = createSqlMock({
        taggedResponses: [
          [makePolicy('permission_escalation', { enforce: true })],
          [], // no pairing rows
        ],
      });
      const context = {
        agent_id: 'agent_1',
        action_type: 'deploy',
        intel: { tool: { required_permission: 'prompt' } },
      };
      const result = await evaluateGuard('org_1', context, sql);
      expect(result.decision).toBe('block');
      expect(result.reasons[0]).toContain('agent has danger');
    });
  });

  // --- green_contract ---

  describe('green_contract', () => {
    it('blocks deploy without sufficient green level', async () => {
      const sql = createSqlMock({
        taggedResponses: [
          [makePolicy('green_contract', { action_types: ['deploy'], required_level: 'workspace' })],
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
    });

    it('allows deploy with sufficient green level', async () => {
      const sql = createSqlMock({
        taggedResponses: [
          [makePolicy('green_contract', { action_types: ['deploy'], required_level: 'workspace' })],
        ],
      });
      const context = {
        action_type: 'deploy',
        intel: { green: { observed_level: 'merge_ready' } },
      };
      const result = await evaluateGuard('org_1', context, sql);
      expect(result.decision).toBe('allow');
    });

    it('blocks when no green status reported', async () => {
      const sql = createSqlMock({
        taggedResponses: [
          [makePolicy('green_contract', { action_types: ['deploy'], required_level: 'workspace' })],
        ],
      });
      const context = {
        action_type: 'deploy',
        intel: {},
      };
      const result = await evaluateGuard('org_1', context, sql);
      expect(result.decision).toBe('block');
      expect(result.reasons[0]).toContain('no test status reported');
    });

    it('skips non-matching action type', async () => {
      const sql = createSqlMock({
        taggedResponses: [
          [makePolicy('green_contract', { action_types: ['deploy'], required_level: 'workspace' })],
        ],
      });
      const context = {
        action_type: 'build',
        intel: { green: { observed_level: 'targeted' } },
      };
      const result = await evaluateGuard('org_1', context, sql);
      expect(result.decision).toBe('allow');
    });
  });

  // --- branch_freshness ---

  describe('branch_freshness', () => {
    it('blocks deploy from stale branch', async () => {
      const sql = createSqlMock({
        taggedResponses: [
          [makePolicy('branch_freshness', { action_types: ['deploy'], max_commits_behind: 5 })],
        ],
      });
      const context = {
        action_type: 'deploy',
        intel: {
          branch: { name: 'feat/old', freshness: 'stale', commits_behind: 12 },
        },
      };
      const result = await evaluateGuard('org_1', context, sql);
      expect(result.decision).toBe('block');
      expect(result.reasons[0]).toContain('feat/old');
      expect(result.reasons[0]).toContain('stale');
      expect(result.reasons[0]).toContain('12 commits behind');
    });

    it('allows deploy from fresh branch', async () => {
      const sql = createSqlMock({
        taggedResponses: [
          [makePolicy('branch_freshness', { action_types: ['deploy'], max_commits_behind: 5 })],
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
    });

    it('allows when commits behind is within threshold', async () => {
      const sql = createSqlMock({
        taggedResponses: [
          [makePolicy('branch_freshness', { action_types: ['deploy'], max_commits_behind: 10 })],
        ],
      });
      const context = {
        action_type: 'deploy',
        intel: {
          branch: { name: 'feat/ok', freshness: 'stale', commits_behind: 5 },
        },
      };
      const result = await evaluateGuard('org_1', context, sql);
      expect(result.decision).toBe('allow');
    });

    it('skips when no branch intel provided', async () => {
      const sql = createSqlMock({
        taggedResponses: [
          [makePolicy('branch_freshness', { action_types: ['deploy'] })],
        ],
      });
      const context = {
        action_type: 'deploy',
      };
      const result = await evaluateGuard('org_1', context, sql);
      expect(result.decision).toBe('allow');
    });
  });

  // --- Backward compatibility ---

  describe('backward compatibility', () => {
    it('works without intel field in context', async () => {
      const sql = createSqlMock({
        taggedResponses: [
          [
            makePolicy('permission_escalation', { enforce: true }),
            makePolicy('green_contract', { action_types: ['deploy'], required_level: 'workspace' }),
            makePolicy('branch_freshness', { action_types: ['deploy'] }),
          ],
        ],
      });
      const context = { action_type: 'read', agent_id: 'agent_1' };
      const result = await evaluateGuard('org_1', context, sql);
      // permission_escalation: no intel.tool => skip
      // green_contract: action_type read not in ['deploy'] => skip
      // branch_freshness: action_type read not in ['deploy'] => skip
      expect(result.decision).toBe('allow');
    });

    it('return shape includes recovery when decision is not allow', async () => {
      const sql = createSqlMock({
        taggedResponses: [
          [makePolicy('green_contract', { action_types: ['deploy'], required_level: 'workspace' })],
        ],
      });
      const context = {
        action_type: 'deploy',
        agent_id: 'agent_1',
        intel: { green: { observed_level: 'targeted' } },
      };
      const result = await evaluateGuard('org_1', context, sql);
      expect(result.decision).toBe('block');
      // Recovery wiring: green_insufficient signal should produce a recipe
      expect(result.recovery).toBeDefined();
      expect(result.recovery.signal).toBe('green_insufficient');
    });

    it('return shape omits recovery when decision is allow', async () => {
      const sql = createSqlMock({
        taggedResponses: [[]],
      });
      const context = { action_type: 'read' };
      const result = await evaluateGuard('org_1', context, sql);
      expect(result.decision).toBe('allow');
      expect(result.recovery).toBeUndefined();
    });

    it('includes branch_stale recovery when branch is stale and decision is not allow', async () => {
      const sql = createSqlMock({
        taggedResponses: [
          [makePolicy('branch_freshness', { action_types: ['deploy'], max_commits_behind: 0 })],
        ],
      });
      const context = {
        action_type: 'deploy',
        agent_id: 'agent_1',
        intel: {
          branch: { name: 'feat/old', freshness: 'stale', commits_behind: 5 },
        },
      };
      const result = await evaluateGuard('org_1', context, sql);
      expect(result.decision).toBe('block');
      expect(result.recovery).toBeDefined();
      expect(result.recovery.signal).toBe('branch_stale');
    });
  });
});
