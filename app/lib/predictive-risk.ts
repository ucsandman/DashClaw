/**
 * Predictive Risk Scoring.
 * Statistical behavior analysis (always on) + LLM-enhanced risk assessment (opt-in for high-stakes).
 */

import { executeCompletion } from './providers';
import type { StrategyConfig } from './providers';
import { getDefaultProviderModel } from './providers/providerRegistry';
import type { SqlTag } from './types/db';

const DEFAULT_THRESHOLD = 60;

const DEFAULT_STRATEGY_CONFIG: StrategyConfig = {
  primary: {
    provider: 'openai',
    model: getDefaultProviderModel('openai', 'predictive_risk') || 'gpt-4.1-mini',
  },
  fallback: [
    {
      provider: 'anthropic',
      model: getDefaultProviderModel('anthropic', 'predictive_risk') || 'claude-haiku-4-5',
    },
  ],
  maxRetries: 1,
  maxBudgetUsd: 0.05,
};

export interface HistoricalStats {
  total: number;
  failures: number;
  avg_risk: number | null;
  recent_count: number;
}

export interface StatisticalAdjustment {
  adjustment: number;
  failure_rate: number;
  total_actions: number;
  avg_historical_risk: number | null;
  velocity: number;
  basis: 'no_history' | 'history';
}

export interface LlmRiskAssessment {
  adjustment: number;
  reasoning: string;
  model: string;
}

export interface PredictiveRiskResult {
  statistical: StatisticalAdjustment | null;
  llm: LlmRiskAssessment | null;
  /** Why the LLM amplifier didn't run when the trigger fired (v2.1 deadline fix). */
  llm_skipped?: 'no_history' | 'budget' | 'timeout';
  total_adjustment: number;
}

export interface PredictiveRiskSettings {
  threshold?: number;
  enabled?: boolean;
  /**
   * Remaining guard-deadline budget (ms) available to the LLM amplifier.
   * The measured LLM call costs 1.2–3s of the guard's 3500ms deadline
   * (docs/plans/2026-07-02-guard-deadline-noise.md): below MIN_LLM_BUDGET_MS
   * the call is skipped; above it the call is raced against the budget so a
   * slow provider yields llm=null instead of a degraded decision.
   */
  llmBudgetMs?: number;
}

/** Under this remaining budget the LLM cannot finish in time — don't start it. */
export const MIN_LLM_BUDGET_MS = 1200;

/**
 * Compute a statistical risk adjustment from historical action data.
 */
export function computeStatisticalAdjustment(stats: HistoricalStats): StatisticalAdjustment {
  const { total, failures, avg_risk, recent_count } = stats;
  let adjustment = 0;

  if (total === 0) {
    // Cold start: no history for this (agent, action_type). The +5 is a fixed
    // "unknown territory" prior, NOT a learned prediction — `basis` flags that so
    // consumers don't mistake it for a statistical signal.
    return {
      adjustment: 5,
      failure_rate: 0,
      total_actions: 0,
      avg_historical_risk: null,
      velocity: 0,
      basis: 'no_history',
    };
  }

  const failureRate = failures / total;

  if (failureRate > 0.5) {
    adjustment += 15;
  } else if (failureRate > 0.25) {
    adjustment += 10;
  }

  // Velocity amplifies demonstrated failure ("failing, and failing fast") —
  // it is never a standalone signal. A clean high-velocity agent pays no tax;
  // runaway-loop protection is the rate_limit policy's job, not a score prior.
  // (Owner roadmap item 5 decision (a) — the flat +5 helped produce the June
  // false "risk 100" blocks.)
  if (recent_count > 5 && failureRate > 0.25) {
    adjustment += 5;
  }

  return {
    adjustment,
    failure_rate: Math.round(failureRate * 100) / 100,
    total_actions: total,
    avg_historical_risk: avg_risk != null ? Math.round(Number(avg_risk)) : null,
    velocity: recent_count,
    basis: 'history',
  };
}

/**
 * Query historical action stats for this (org, agent, action_type).
 */
async function queryHistoricalStats(
  sql: SqlTag,
  orgId: string,
  agentId: string,
  actionType: string
): Promise<HistoricalStats> {
  const rows = await sql.query(
    `SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE status = 'failed') as failures,
      AVG(risk_score) as avg_risk,
      COUNT(*) FILTER (WHERE timestamp_start::timestamptz > NOW() - INTERVAL '1 hour') as recent_count
    FROM action_records
    WHERE org_id = $1
      AND agent_id = $2
      AND action_type = $3
      AND timestamp_start::timestamptz > NOW() - INTERVAL '30 days'`,
    [orgId, agentId, actionType]
  );

  const row = (rows[0] || {}) as {
    total?: unknown;
    failures?: unknown;
    avg_risk?: unknown;
    recent_count?: unknown;
  };
  return {
    total: parseInt((row.total as string) || '0', 10),
    failures: parseInt((row.failures as string) || '0', 10),
    avg_risk: row.avg_risk != null ? Number(row.avg_risk) : null,
    recent_count: parseInt((row.recent_count as string) || '0', 10),
  };
}

/**
 * LLM-based risk assessment for high-stakes actions.
 * Returns { adjustment, reasoning, model } or null on failure (fail-open).
 */
export async function assessRiskWithLLM(
  sql: SqlTag,
  orgId: string,
  agentId: string,
  actionType: string
): Promise<LlmRiskAssessment | null> {
  try {
    const recentActions = await sql`
      SELECT action_type, status, risk_score, created_at
      FROM action_records
      WHERE org_id = ${orgId}
        AND agent_id = ${agentId}
        AND action_type = ${actionType}
      ORDER BY created_at DESC
      LIMIT 10
    ` as Array<{ action_type: string; status: string; risk_score: unknown; created_at: unknown }>;

    const historyText = recentActions
      .map((a) => `${a.created_at}: ${a.action_type} → ${a.status} (risk: ${a.risk_score ?? 'N/A'})`)
      .join('\n');

    const messages = [
      {
        role: 'system',
        content: `You are a risk assessment engine for AI agent governance. Given an agent's recent action history, assess the risk of allowing the proposed action. Return ONLY a JSON object with two fields:
- "adjustment": integer from -20 to +20 (positive = increase risk, negative = decrease risk)
- "reasoning": 1-2 sentence explanation

Return ONLY the JSON object, no markdown fences.`,
      },
      {
        role: 'user',
        content: `Agent "${agentId}" wants to perform "${actionType}". Here are their last ${recentActions.length} similar actions:\n\n${historyText}\n\nAssess the risk adjustment.`,
      },
    ];

    const completion = await executeCompletion(sql, orgId, DEFAULT_STRATEGY_CONFIG, messages, {
      max_tokens: 256,
      temperature: 0.2,
    });

    let cleaned = completion.content.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

    let parsed: { adjustment?: unknown; reasoning?: unknown };
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return null;
    }

    const adjustment = Math.max(-20, Math.min(20, parseInt(parsed.adjustment as string, 10) || 0));
    const reasoning = typeof parsed.reasoning === 'string' ? parsed.reasoning.slice(0, 500) : '';

    return {
      adjustment,
      reasoning,
      model: completion.model,
    };
  } catch {
    return null;
  }
}

/**
 * Get the full predictive risk assessment for a guard call.
 *
 * `triggerRiskScore` must be SERVER-SIDE evidence only (server heuristic /
 * org template max) — never the client-inflated effective score. The
 * client-reported term may raise the final score (max-fold, by design) but
 * must not recruit the LLM amplifier: the LLM sees only (agent, action_type)
 * history, so it cannot correct a false-high client score — it just adds
 * ±20 of noise on top of a false positive (owner roadmap item 5 decision (b)).
 */
export async function getPredictiveRisk(
  sql: SqlTag,
  orgId: string,
  agentId: string,
  actionType: string,
  triggerRiskScore: number,
  orgSettings: PredictiveRiskSettings = {}
): Promise<PredictiveRiskResult> {
  if (!agentId || !actionType) {
    return { statistical: null, llm: null, total_adjustment: 0 };
  }

  const stats = await queryHistoricalStats(sql, orgId, agentId, actionType);
  const statistical = computeStatisticalAdjustment(stats);

  const threshold = orgSettings.threshold ?? DEFAULT_THRESHOLD;

  let llm: LlmRiskAssessment | null = null;
  let llmSkipped: PredictiveRiskResult['llm_skipped'];
  const scoreWithStatistical = triggerRiskScore + statistical.adjustment;

  if (orgSettings.enabled === true && scoreWithStatistical >= threshold) {
    if (stats.total === 0) {
      // Nothing to reason over: the model sees only (agent, action_type)
      // history, and with zero rows it provably returns adjustment 0 with a
      // "cannot assess" note — seconds of latency and provider spend for no
      // signal (measured live, v2.1 diagnosis).
      llmSkipped = 'no_history';
    } else if (orgSettings.llmBudgetMs != null && orgSettings.llmBudgetMs < MIN_LLM_BUDGET_MS) {
      llmSkipped = 'budget';
    } else if (orgSettings.llmBudgetMs != null) {
      // Bound the call by the remaining guard budget: a slow provider costs
      // the amplifier, never the whole evaluation. The abandoned call's
      // result is discarded (same fail-open contract as an LLM error).
      const raced = await Promise.race([
        assessRiskWithLLM(sql, orgId, agentId, actionType),
        new Promise<'timeout'>((resolve) => {
          const timer = setTimeout(() => resolve('timeout'), orgSettings.llmBudgetMs);
          if (typeof timer.unref === 'function') timer.unref();
        }),
      ]);
      if (raced === 'timeout') llmSkipped = 'timeout';
      else llm = raced;
    } else {
      llm = await assessRiskWithLLM(sql, orgId, agentId, actionType);
    }
  }

  return {
    statistical,
    llm,
    ...(llmSkipped ? { llm_skipped: llmSkipped } : {}),
    total_adjustment: statistical.adjustment + (llm?.adjustment ?? 0),
  };
}
