// §9.3 Actions & outcomes contracts.
//
// ActionRecord mirrors the action_records table (schema/schema.js). Note the
// money column `cost_estimate` is REAL (float4) → a JS number; it is a
// write-time snapshot and must NOT be repriced on read.

import type { Brand, Nullable } from './brand';
import type { OrganizationId } from './identity';

export type ActionId = Brand<string, 'ActionId'>; // ar_ prefix
export type IdempotencyKey = Brand<string, 'IdempotencyKey'>;

/** Open vocabulary (deploy, security, api, …). */
export type ActionType = string;

/** Free-form lifecycle status text column (nullable). */
export type ActionStatus = Nullable<string>;

/** Durable-execution finality — action_records.outcome_status CHECK constraint. */
export type OutcomeStatus =
  | 'pending'
  | 'completed'
  | 'partial'
  | 'failed'
  | 'lost_confirmation';

export type ApprovalStatus = 'pending' | 'approved' | 'denied' | 'expired';

export interface ActionRecord {
  id: number;
  action_id: Nullable<string>;
  org_id: OrganizationId;
  agent_id: string;
  agent_name: Nullable<string>;
  swarm_id: Nullable<string>;
  parent_action_id: Nullable<string>;
  action_type: string;
  declared_goal: Nullable<string>;
  reasoning: Nullable<string>;
  authorization_scope: Nullable<string>;
  trigger: Nullable<string>;
  systems_touched: Nullable<string>;
  input_summary: Nullable<string>;
  status: Nullable<string>;
  reversible: Nullable<number>;
  /** Authoritative server risk (guard), integer 0-100. */
  risk_score: Nullable<number>;
  confidence: Nullable<number>;
  output_summary: Nullable<string>;
  side_effects: Nullable<string>;
  artifacts_created: Nullable<string>;
  error_message: Nullable<string>;
  timestamp_start: Nullable<string>;
  timestamp_end: Nullable<string>;
  duration_ms: Nullable<number>;
  /** REAL (float4) → JS number. Write-time snapshot; never repriced on read. */
  cost_estimate: Nullable<number>;
  tokens_in: Nullable<number>;
  tokens_out: Nullable<number>;
  model: Nullable<string>;
  verified: Nullable<boolean>;
  approved_by: Nullable<string>;
  approved_at: Nullable<string>;
  outcome_status: OutcomeStatus;
  outcome_at: Nullable<string>;
  outcome_summary: Nullable<string>;
  outcome_error: Nullable<string>;
  idempotency_key: Nullable<string>;
  session_id: Nullable<string>;
  created_at: Nullable<string>;
  updated_at: Nullable<string>;
}

export interface ActionCreateInput {
  action_type: string;
  agent_id: string;
  agent_name?: string;
  declared_goal?: string;
  risk_score?: number;
  session_id?: string;
  idempotency_key?: string;
  [field: string]: unknown;
}

export interface ActionCreateResult {
  action_id: string;
  status: Nullable<string>;
}

export interface ExecutionOutcome {
  action_id: string;
  outcome_status: OutcomeStatus;
  outcome_summary?: Nullable<string>;
  outcome_error?: Nullable<string>;
  outcome_at?: Nullable<string>;
}

export interface ApprovalDecision {
  action_id: string;
  status: ApprovalStatus;
  approved_by?: Nullable<string>;
  approved_at?: Nullable<string>;
}
