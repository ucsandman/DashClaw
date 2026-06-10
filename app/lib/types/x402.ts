// §9.5 x402 spend-governance contracts (from drizzle/0021_x402_spend_governance.sql).
//
// DashClaw GOVERNS and RECORDS x402 purchases; it never executes payments or
// holds wallet credentials. `provider`, `provider_id`, and `endpoint_id` are
// distinct and never interchangeable. wallet/payment references are sensitive
// and stored masked. x402_purchases.action_id is the PK and links 1:1 to
// action_records.action_id.

import type { Brand, Nullable } from './brand';
import type { OrganizationId } from './identity';

export type X402ProviderId = Brand<string, 'X402ProviderId'>;
export type X402EndpointId = Brand<string, 'X402EndpointId'>;
/** = action_records.action_id (1:1). */
export type X402PurchaseId = Brand<string, 'X402PurchaseId'>;

export type X402ProviderStatus = 'active' | 'blocked' | 'inactive';

/** Explicit currency; default 'USDC'. The `& {}` keeps literal hints + openness. */
export type CurrencyCode = 'USDC' | (string & {});

/** REAL USD amount; must be validated finite and >= 0 at the boundary. */
export type SpendAmount = Brand<number, 'SpendAmount'>;

/** x402_purchases.execution_status — agent executes; DashClaw records the result. */
export type X402ExecutionStatus =
  | 'pending'
  | 'blocked'
  | 'approved'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'partial';

export type PaymentMethod = string;
/** Sensitive identifier — mask before persist; never log/return raw. */
export type WalletReference = Brand<string, 'WalletReference'>;
/** Sensitive identifier — mask before persist; never log/return raw. */
export type PaymentReference = Brand<string, 'PaymentReference'>;

export interface X402ProviderRow {
  provider_id: X402ProviderId;
  org_id: OrganizationId;
  name: string;
  slug: string;
  description: Nullable<string>;
  category: string;
  base_url: Nullable<string>;
  status: X402ProviderStatus;
  default_currency: CurrencyCode;
  pricing_model: Nullable<string>;
  metadata: Nullable<unknown>;
  created_at: Nullable<string>;
  updated_at: Nullable<string>;
}

export interface X402EndpointRow {
  endpoint_id: X402EndpointId;
  org_id: OrganizationId;
  provider_id: X402ProviderId;
  name: string;
  slug: string;
  description: Nullable<string>;
  endpoint_url: Nullable<string>;
  category: string;
  sensitivity_level: string;
  default_price: Nullable<number>;
  price_unit: Nullable<string>;
  enabled: number;
  metadata: Nullable<unknown>;
  created_at: Nullable<string>;
  updated_at: Nullable<string>;
}

export interface X402PurchaseRow {
  action_id: string;
  org_id: OrganizationId;
  provider_id: Nullable<string>;
  endpoint_id: Nullable<string>;
  agent_id: Nullable<string>;
  spend_amount: number;
  currency: CurrencyCode;
  payment_method: Nullable<string>;
  wallet_reference: Nullable<string>;
  payment_reference: Nullable<string>;
  purchase_reason: Nullable<string>;
  context_gap: Nullable<string>;
  alternatives_considered: Nullable<string>;
  expected_value: Nullable<string>;
  execution_status: X402ExecutionStatus;
  result_summary: Nullable<string>;
  result_reference: Nullable<string>;
  value_score: Nullable<number>;
  confidence_score: Nullable<number>;
  operator_feedback: Nullable<string>;
  failure_reason: Nullable<string>;
  created_at: Nullable<string>;
  completed_at: Nullable<string>;
}

/**
 * listPurchases row shape: provider_name is join-derived from
 * x402_providers.name (LEFT JOIN) — it is NOT a column on x402_purchases and
 * can be null for pre-backfill rows or deleted providers (no FK).
 */
export type X402PurchaseListRow = X402PurchaseRow & { provider_name?: Nullable<string> };

export interface X402PurchaseInput {
  provider?: string;
  provider_id?: string;
  endpoint_id?: string;
  agent_id?: string;
  spend_amount: number;
  currency?: CurrencyCode;
  payment_method?: string;
  wallet_reference?: string;
  payment_reference?: string;
  purchase_reason?: string;
  [field: string]: unknown;
}

export interface X402PurchaseOutcome {
  action_id: string;
  execution_status: X402ExecutionStatus;
  result_summary?: string;
  failure_reason?: string;
}

/** x402_spend_limit policy rule shape (also a member of governance.GuardPolicy). */
export interface X402PolicyRules {
  max_spend_usd?: number;
  approval_threshold?: number;
  allowed_providers?: string[];
  blocked_providers?: string[];
}
