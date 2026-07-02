import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockExecuteCompletion } = vi.hoisted(() => ({
  mockExecuteCompletion: vi.fn(),
}));

vi.mock('@/lib/providers.js', () => ({
  executeCompletion: mockExecuteCompletion,
}));

import {
  computeStatisticalAdjustment,
  assessRiskWithLLM,
  getPredictiveRisk,
} from '@/lib/predictive-risk.js';
import { createSqlMock } from '../helpers.js';

describe('predictive-risk', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('computeStatisticalAdjustment', () => {
    it('returns +15 for >50% failure rate', () => {
      const stats = { total: 10, failures: 6, avg_risk: 50, recent_count: 1 };
      const adj = computeStatisticalAdjustment(stats);
      expect(adj.adjustment).toBe(15);
    });

    it('returns +10 for 25-50% failure rate', () => {
      const stats = { total: 10, failures: 3, avg_risk: 50, recent_count: 1 };
      const adj = computeStatisticalAdjustment(stats);
      expect(adj.adjustment).toBe(10);
    });

    it('charges NO velocity tax to a clean high-velocity agent (item 5 decision a)', () => {
      // June "risk 100" specimens: thousands of actions, failure_rate 0, high
      // velocity — the old flat +5 taxed exactly the healthiest agents.
      const stats = { total: 5000, failures: 0, avg_risk: 20, recent_count: 50 };
      const adj = computeStatisticalAdjustment(stats);
      expect(adj.adjustment).toBe(0);
      expect(adj.velocity).toBe(50);
    });

    it('adds +5 velocity only as an amplifier of demonstrated failure', () => {
      const stats = { total: 10, failures: 3, avg_risk: 50, recent_count: 8 };
      const adj = computeStatisticalAdjustment(stats);
      expect(adj.adjustment).toBe(15); // failure prior +10, velocity amplifier +5
    });

    it('returns +5 for zero history (unknown territory) flagged basis=no_history', () => {
      const stats = { total: 0, failures: 0, avg_risk: null, recent_count: 0 };
      const adj = computeStatisticalAdjustment(stats);
      expect(adj.adjustment).toBe(5);
      expect(adj.basis).toBe('no_history');
    });

    it('returns 0 for healthy agent with low failure rate', () => {
      const stats = { total: 50, failures: 2, avg_risk: 30, recent_count: 2 };
      const adj = computeStatisticalAdjustment(stats);
      expect(adj.adjustment).toBe(0);
      expect(adj.basis).toBe('history');
    });

    it('stacks failure rate and velocity adjustments', () => {
      const stats = { total: 10, failures: 6, avg_risk: 70, recent_count: 8 };
      const adj = computeStatisticalAdjustment(stats);
      expect(adj.adjustment).toBe(20);
    });
  });

  describe('assessRiskWithLLM', () => {
    it('returns adjustment and reasoning from LLM', async () => {
      mockExecuteCompletion.mockResolvedValue({
        content: JSON.stringify({ adjustment: 12, reasoning: 'High failure rate after hours' }),
        provider: 'openai',
        model: 'gpt-4o-mini',
        usage: { input_tokens: 300, output_tokens: 50 },
        cost_usd: 0.001,
      });

      const sql = createSqlMock({
        taggedResponses: [
          [
            { action_type: 'deploy', status: 'failed', risk_score: 70, created_at: '2026-04-07T01:00:00Z' },
            { action_type: 'deploy', status: 'completed', risk_score: 50, created_at: '2026-04-07T00:00:00Z' },
          ],
          [{ key: 'OPENAI_API_KEY', value: 'sk-test', encrypted: false }],
        ],
      });

      const result = await assessRiskWithLLM(sql, 'org_1', 'agent-1', 'deploy');
      expect(result.adjustment).toBe(12);
      expect(result.reasoning).toBe('High failure rate after hours');
      expect(mockExecuteCompletion.mock.calls[0][2]).toEqual({
        primary: { provider: 'openai', model: 'gpt-4.1-mini' },
        fallback: [{ provider: 'anthropic', model: 'claude-haiku-4-5' }],
        maxRetries: 1,
        maxBudgetUsd: 0.05,
      });
    });

    it('clamps adjustment to [-20, +20]', async () => {
      mockExecuteCompletion.mockResolvedValue({
        content: JSON.stringify({ adjustment: 50, reasoning: 'Very risky' }),
        provider: 'openai',
        model: 'gpt-4o-mini',
        usage: { input_tokens: 300, output_tokens: 50 },
        cost_usd: 0.001,
      });

      const sql = createSqlMock({
        taggedResponses: [
          [{ action_type: 'deploy', status: 'failed', risk_score: 70, created_at: '2026-04-07T01:00:00Z' }],
          [{ key: 'OPENAI_API_KEY', value: 'sk-test', encrypted: false }],
        ],
      });

      const result = await assessRiskWithLLM(sql, 'org_1', 'agent-1', 'deploy');
      expect(result.adjustment).toBe(20);
    });

    it('returns null on LLM failure (fail-open)', async () => {
      mockExecuteCompletion.mockRejectedValue(new Error('Provider timeout'));

      const sql = createSqlMock({
        taggedResponses: [
          [{ action_type: 'deploy', status: 'failed', risk_score: 70, created_at: '2026-04-07T01:00:00Z' }],
          [{ key: 'OPENAI_API_KEY', value: 'sk-test', encrypted: false }],
        ],
      });

      const result = await assessRiskWithLLM(sql, 'org_1', 'agent-1', 'deploy');
      expect(result).toBeNull();
    });
  });

  describe('getPredictiveRisk', () => {
    it('returns statistical-only when score is below threshold', async () => {
      const sql = createSqlMock({
        queryResponses: [
          [{ total: '20', failures: '2', avg_risk: '30', recent_count: '1' }],
        ],
      });

      const result = await getPredictiveRisk(sql, 'org_1', 'agent-1', 'test', 30, { enabled: true, threshold: 60 });
      expect(result.statistical).toBeDefined();
      expect(result.llm).toBeNull();
      expect(mockExecuteCompletion).not.toHaveBeenCalled();
    });

    it('does not consult the LLM on server evidence below threshold — June specimen shape (item 5 decision b)', async () => {
      // The caller passes server evidence only (max(server, template)); a
      // client-70 fallback can no longer recruit the ±20 amplifier. Clean
      // high-velocity history also contributes 0 under decision (a).
      const sql = createSqlMock({
        queryResponses: [
          [{ total: '5000', failures: '0', avg_risk: '20', recent_count: '50' }],
        ],
      });

      const result = await getPredictiveRisk(sql, 'org_1', 'agent-1', 'review', 15, { enabled: true, threshold: 60 });
      expect(result.statistical.adjustment).toBe(0);
      expect(result.llm).toBeNull();
      expect(result.total_adjustment).toBe(0);
      expect(mockExecuteCompletion).not.toHaveBeenCalled();
    });

    it('consults the LLM when server evidence crosses the threshold', async () => {
      mockExecuteCompletion.mockResolvedValue({
        content: JSON.stringify({ adjustment: 10, reasoning: 'Repeated failures on this action type' }),
        provider: 'openai',
        model: 'gpt-4.1-mini',
        usage: { input_tokens: 300, output_tokens: 50 },
        cost_usd: 0.001,
      });

      const sql = createSqlMock({
        queryResponses: [
          [{ total: '10', failures: '6', avg_risk: '70', recent_count: '2' }],
        ],
        taggedResponses: [
          [{ action_type: 'deploy', status: 'failed', risk_score: 70, created_at: '2026-07-01T01:00:00Z' }],
          [{ key: 'OPENAI_API_KEY', value: 'sk-test', encrypted: false }],
        ],
      });

      const result = await getPredictiveRisk(sql, 'org_1', 'agent-1', 'deploy', 60, { enabled: true, threshold: 60 });
      expect(result.statistical.adjustment).toBe(15);
      expect(result.llm).toEqual({ adjustment: 10, reasoning: 'Repeated failures on this action type', model: 'gpt-4.1-mini' });
      expect(result.total_adjustment).toBe(25);
      expect(mockExecuteCompletion).toHaveBeenCalledTimes(1);
    });
  });
});
