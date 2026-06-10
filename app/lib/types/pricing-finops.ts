// §9.4 Pricing & FinOps contracts.
//
// Preserves the two intentional pricing surfaces (billing.js authoritative vs
// claude-code/pricing.js analytics) and the FinOps accounting rules:
//   Fleet Spend = Agent LLM Spend (x402_purchase EXCLUDED) + x402 Purchase Spend
//   Claude Code spend is advisory and separately modelled.
//
// IMPORTANT: the request lens is 'claude-code' (hyphen) but the response label
// is 'claude_code' (underscore) — modelled distinctly; never conflate.

export type ModelId = string;
export type TokenCount = number;

/** USD-per-million-tokens rate for one axis. */
export type PricingRate = number;

export interface ModelPricingEntry {
  input: PricingRate;
  output: PricingRate;
  cache_write?: PricingRate;
  cache_read?: PricingRate;
}

/** billing.js DEFAULT_PRICING row — matched by ordered substring `pattern`. */
export interface BillingPricingEntry extends ModelPricingEntry {
  pattern: string;
  label?: string;
}

export type ModelPricingTable = Record<ModelId, ModelPricingEntry>;

export interface UsageTotals {
  input_tokens: TokenCount;
  output_tokens: TokenCount;
  cache_creation_tokens?: TokenCount;
  cache_read_tokens?: TokenCount;
}

export interface CacheUsage {
  cache_creation_tokens?: TokenCount;
  cache_read_tokens?: TokenCount;
}

export type CostEstimate = number; // USD

export type SpendPeriod = '7d' | '30d' | '90d';

/** Request lens param (ALLOWED_LENSES). */
export type FinOpsLens = 'fleet' | 'claude-code';

/** Response `lens` label — note the underscore vs the hyphenated request param. */
export type FinOpsResponseLens = 'fleet' | 'claude_code';

export interface AgentSpendAggregation {
  /** LLM token cost; EXCLUDES x402_purchase action_type. */
  total_cost_usd: number;
  [field: string]: unknown;
}

export interface X402SpendAggregation {
  /** x402 purchase spend; EXCLUDES execution_status = 'failed'. */
  total_spend_usd: number;
  [field: string]: unknown;
}

export interface CodeSessionSpendAggregation {
  /** Sum of stored code_sessions.cost_usd (numeric → coerce). */
  total_cost_usd: number;
  [field: string]: unknown;
}

export interface FleetSpend {
  lens: 'fleet';
  period: SpendPeriod;
  agent: AgentSpendAggregation;
  x402: X402SpendAggregation;
  /** = agent.total_cost_usd + x402.total_spend_usd. */
  fleet_total_usd: number;
  /**
   * Honest-zero indicator: actions in the period that reported tokens but
   * carry $0 cost_estimate (unknown model families, '<synthetic>' recorder
   * rows, NULL model). Rendered as a warning on /spend.
   */
  unpriced: {
    action_count: number;
    total_tokens: number;
    models: Array<{ model: string | null; action_count: number; total_tokens: number }>;
  };
}

export interface ClaudeCodeSpend {
  lens: 'claude_code';
  period: SpendPeriod;
  code_sessions: CodeSessionSpendAggregation;
  code_total_usd: number;
}

export interface ProviderSpend {
  provider_id: string | null;
  total_spend_usd: number;
}

export interface ProjectSpend {
  project: string | null;
  total_cost_usd: number;
}
