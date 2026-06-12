/**
 * Guard degradation contract (Organ 3, Phase 1).
 *
 * The guard must fail CLOSED when it cannot complete an evaluation:
 *   - webhook timeout/failure  → resolveDegradedAction(rules.on_timeout)
 *   - semantic LLM failure     → resolveDegradedAction(rules.fallback)
 *   - evaluation deadline      → resolveDegradedAction() applied to the
 *     accumulated state, decision still persisted through the audit gate
 *
 * Precedence: per-policy override → DASHCLAW_GUARD_FALLBACK → require_approval.
 * `allow` is the explicit fail-open escape hatch for self-hosters.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
vi.mock('@/lib/predictive-risk.js', () => ({ getPredictiveRisk: vi.fn(async () => ({ statistical: null, llm: null, total_adjustment: 0 })) }));
vi.mock('@/lib/repositories/settings.repository.js', () => ({ getSettings: vi.fn(async () => []) }));

import { evaluateGuard, resolveDegradedAction, __resetGuardCaches } from '@/lib/guard.js';
import { createSqlMock } from '../helpers.js';

function makeSql(policies) {
  return createSqlMock({ taggedResponses: [policies] });
}

function makePolicy(type, rules, overrides = {}) {
  return {
    id: `gp_${type}`,
    name: `Policy ${type}`,
    policy_type: type,
    rules: JSON.stringify(rules),
    ...overrides,
  };
}

const ENV_KEYS = ['DASHCLAW_GUARD_FALLBACK', 'DASHCLAW_GUARD_DEADLINE_MS', 'GUARD_LLM_KEY'];
const savedEnv = {};

describe('guard degradation contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetGuardCaches();
    for (const k of ENV_KEYS) {
      savedEnv[k] = process.env[k];
      delete process.env[k];
    }
    mockScanSensitiveData.mockImplementation((text) => ({ findings: [], redacted: text, clean: true }));
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  describe('resolveDegradedAction precedence', () => {
    it('defaults to require_approval (fail closed)', () => {
      expect(resolveDegradedAction()).toBe('require_approval');
    });

    it('per-policy override wins over env', () => {
      process.env.DASHCLAW_GUARD_FALLBACK = 'block';
      expect(resolveDegradedAction('allow')).toBe('allow');
    });

    it('env applies when no policy override', () => {
      process.env.DASHCLAW_GUARD_FALLBACK = 'allow';
      expect(resolveDegradedAction()).toBe('allow');
      process.env.DASHCLAW_GUARD_FALLBACK = 'block';
      expect(resolveDegradedAction()).toBe('block');
    });

    it('unknown values fall through to the fail-closed default', () => {
      process.env.DASHCLAW_GUARD_FALLBACK = 'banana';
      expect(resolveDegradedAction('garbage')).toBe('require_approval');
    });
  });

  describe('webhook degradation', () => {
    it('honors on_timeout=require_approval when the webhook fails', async () => {
      mockDeliverGuardWebhook.mockResolvedValue({ success: false, response: null });
      const sql = makeSql([makePolicy('webhook_check', { url: 'https://example.com', on_timeout: 'require_approval' })]);
      const result = await evaluateGuard('org_wd1', { action_type: 'deploy' }, sql);
      expect(result.decision).toBe('require_approval');
      expect(result.reason).toContain('on_timeout: require_approval');
    });

    it('defaults to require_approval when nothing is configured (fail-closed default)', async () => {
      mockDeliverGuardWebhook.mockResolvedValue({ success: false, response: null });
      const sql = makeSql([makePolicy('webhook_check', { url: 'https://example.com' })]);
      const result = await evaluateGuard('org_wd2', { action_type: 'deploy' }, sql);
      expect(result.decision).toBe('require_approval');
    });

    it('DASHCLAW_GUARD_FALLBACK=allow restores fail-open (escape hatch)', async () => {
      process.env.DASHCLAW_GUARD_FALLBACK = 'allow';
      mockDeliverGuardWebhook.mockResolvedValue({ success: false, response: null });
      const sql = makeSql([makePolicy('webhook_check', { url: 'https://example.com' })]);
      const result = await evaluateGuard('org_wd3', { action_type: 'deploy' }, sql);
      expect(result.decision).toBe('allow');
    });

    it('DASHCLAW_GUARD_FALLBACK=block blocks on webhook degradation', async () => {
      process.env.DASHCLAW_GUARD_FALLBACK = 'block';
      mockDeliverGuardWebhook.mockResolvedValue({ success: false, response: null });
      const sql = makeSql([makePolicy('webhook_check', { url: 'https://example.com' })]);
      const result = await evaluateGuard('org_wd4', { action_type: 'deploy' }, sql);
      expect(result.decision).toBe('block');
    });

    it('per-policy on_timeout=allow beats a stricter env value', async () => {
      process.env.DASHCLAW_GUARD_FALLBACK = 'block';
      mockDeliverGuardWebhook.mockResolvedValue({ success: false, response: null });
      const sql = makeSql([makePolicy('webhook_check', { url: 'https://example.com', on_timeout: 'allow' })]);
      const result = await evaluateGuard('org_wd5', { action_type: 'deploy' }, sql);
      expect(result.decision).toBe('allow');
    });
  });

  describe('semantic degradation', () => {
    it('LLM call failure defaults to require_approval (fail-closed default)', async () => {
      process.env.GUARD_LLM_KEY = 'mock-key';
      mockCheckSemantic.mockResolvedValue(null);
      const sql = makeSql([makePolicy('semantic_check', { instruction: 'Check' })]);
      const result = await evaluateGuard('org_sd1', { action_type: 'deploy' }, sql);
      expect(result.decision).toBe('require_approval');
      expect(result.reason).toContain('fallback: require_approval');
    });

    it('DASHCLAW_GUARD_FALLBACK=allow restores fail-open for semantic degradation', async () => {
      process.env.GUARD_LLM_KEY = 'mock-key';
      process.env.DASHCLAW_GUARD_FALLBACK = 'allow';
      mockCheckSemantic.mockResolvedValue(null);
      const sql = makeSql([makePolicy('semantic_check', { instruction: 'Check' })]);
      const result = await evaluateGuard('org_sd2', { action_type: 'deploy' }, sql);
      expect(result.decision).toBe('allow');
    });

    it('missing-LLM-key behavior is unchanged (require_approval with the no-key reason)', async () => {
      // No GUARD_LLM_KEY / OPENAI_API_KEY in env (cleared in beforeEach).
      const savedOpenAi = process.env.OPENAI_API_KEY;
      delete process.env.OPENAI_API_KEY;
      try {
        const sql = makeSql([makePolicy('semantic_check', { instruction: 'Check' })]);
        const result = await evaluateGuard('org_sd3', { action_type: 'deploy' }, sql);
        expect(result.decision).toBe('require_approval');
        expect(result.reason).toContain('no LLM key configured');
        expect(mockCheckSemantic).not.toHaveBeenCalled();
      } finally {
        if (savedOpenAi !== undefined) process.env.OPENAI_API_KEY = savedOpenAi;
      }
    });
  });

  describe('evaluation deadline', () => {
    it('returns a persisted degraded require_approval when a phase overruns the deadline', async () => {
      process.env.DASHCLAW_GUARD_DEADLINE_MS = '50';
      // Webhook hangs forever — the deadline must rescue the evaluation.
      mockDeliverGuardWebhook.mockImplementation(() => new Promise(() => {}));
      const sql = makeSql([makePolicy('webhook_check', { url: 'https://example.com' })]);

      const started = Date.now();
      const result = await evaluateGuard('org_dl1', { action_type: 'deploy', agent_id: 'agt_1' }, sql);
      const elapsed = Date.now() - started;

      expect(elapsed).toBeLessThan(5000);
      expect(result.decision).toBe('require_approval');
      expect(result.reason).toContain('exceeded deadline');
      // The degraded decision must still go through the audit gate.
      const persisted = sql.taggedCalls.some((c) => c.text.includes('INSERT INTO guard_decisions'));
      expect(persisted).toBe(true);
      // Result is schema-complete: ids, risk, timestamps all present.
      expect(result.decision_id).toMatch(/^act_gd_/);
      expect(typeof result.risk_score).toBe('number');
      expect(result.evaluated_at).toBeTruthy();
    });

    it('a block found before the deadline is never downgraded by the degraded action', async () => {
      process.env.DASHCLAW_GUARD_DEADLINE_MS = '50';
      mockDeliverGuardWebhook.mockImplementation(() => new Promise(() => {}));
      const sql = makeSql([
        makePolicy('block_action_type', { action_types: ['deploy'] }, { id: 'gp_block' }),
        makePolicy('webhook_check', { url: 'https://example.com' }, { id: 'gp_hook' }),
      ]);
      const result = await evaluateGuard('org_dl2', { action_type: 'deploy' }, sql);
      expect(result.decision).toBe('block');
      expect(result.reason).toContain('exceeded deadline');
    });

    it('deadline degradation honors DASHCLAW_GUARD_FALLBACK=allow as a warning, not a reason', async () => {
      process.env.DASHCLAW_GUARD_DEADLINE_MS = '50';
      process.env.DASHCLAW_GUARD_FALLBACK = 'allow';
      mockDeliverGuardWebhook.mockImplementation(() => new Promise(() => {}));
      const sql = makeSql([makePolicy('webhook_check', { url: 'https://example.com' })]);
      const result = await evaluateGuard('org_dl3', { action_type: 'deploy' }, sql);
      expect(result.decision).toBe('allow');
      expect(result.warnings.some((w) => w.includes('exceeded deadline'))).toBe(true);
    });

    it('DASHCLAW_GUARD_DEADLINE_MS overrides the default deadline', async () => {
      // Generous deadline: the fast evaluation completes normally, no degradation.
      process.env.DASHCLAW_GUARD_DEADLINE_MS = '30000';
      mockDeliverGuardWebhook.mockResolvedValue({ success: true, response: { decision: 'allow', reasons: [], warnings: [] } });
      const sql = makeSql([makePolicy('webhook_check', { url: 'https://example.com' })]);
      const result = await evaluateGuard('org_dl4', { action_type: 'deploy' }, sql);
      expect(result.decision).toBe('allow');
      expect(result.reason ?? '').not.toContain('exceeded deadline');
    });

    it('fast evaluations are unaffected by the default deadline', async () => {
      const sql = makeSql([makePolicy('risk_threshold', { threshold: 80 })]);
      const result = await evaluateGuard('org_dl5', { risk_score: 85, action_type: 'deploy' }, sql);
      expect(result.decision).toBe('block');
      expect(result.reason ?? '').not.toContain('exceeded deadline');
    });
  });
});
