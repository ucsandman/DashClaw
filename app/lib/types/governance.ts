// §9.2 Governance contracts — guard decisions, policies, risk.
//
// Decisions and policies are discriminated unions. The policy discriminant is
// `policy_type` (exactly how app/lib/guard.js evaluatePolicy switches); the
// `rules` JSON-text column parses into the matching `rules` shape. All 15 live
// policy types are modelled.

import type { Brand, Nullable } from './brand';
import type {
  OrganizationId,
  VerificationStatus,
  ReplayStatus,
  ActionBindingStatus,
} from './identity';

export type DecisionType = 'allow' | 'warn' | 'require_approval' | 'block';

/** Server-computed authoritative risk, integer 0-100 (guard.js computeRiskScore). */
export type RiskScore = Brand<number, 'RiskScore'>;

export type GuardPolicyType =
  | 'risk_threshold'
  | 'require_approval'
  | 'block_action_type'
  | 'warn_action_type'
  | 'allow_grant'
  | 'protected_path'
  | 'rate_limit'
  | 'webhook_check'
  | 'non_fabrication'
  | 'behavioral_anomaly'
  | 'semantic_check'
  | 'permission_escalation'
  | 'green_contract'
  | 'branch_freshness'
  | 'x402_spend_limit';

export type GreenLevel = 'targeted' | 'package' | 'workspace' | 'merge_ready';

/**
 * Discriminated union of guard policies, keyed on `policy_type`. The `rules`
 * member is the parsed shape of the JSON-text `rules` column for that type.
 */
export type GuardPolicy =
  | { policy_type: 'risk_threshold'; rules: { threshold?: number; action?: DecisionType } }
  | { policy_type: 'require_approval'; rules: { action_types: string[] } }
  | { policy_type: 'block_action_type'; rules: { action_types: string[] } }
  | { policy_type: 'warn_action_type'; rules: { action_types: string[] } }
  | { policy_type: 'allow_grant'; rules: { action_type: string; target_prefix?: string } }
  | { policy_type: 'protected_path'; rules: { paths: string[]; action?: DecisionType } }
  | { policy_type: 'rate_limit'; rules: { max_actions?: number; window_minutes?: number; action?: DecisionType } }
  | { policy_type: 'webhook_check'; rules: { url: string; timeout_ms?: number; on_timeout?: 'allow' | 'block' | 'require_approval' } }
  | {
      policy_type: 'non_fabrication';
      rules: { action_types?: string[]; content_path?: string; source_path?: string; on_violation?: 'block' | 'require_approval' };
    }
  | { policy_type: 'behavioral_anomaly'; rules: { similarity_threshold?: number; min_history?: number; action?: DecisionType } }
  | { policy_type: 'semantic_check'; rules: { instruction: string; model?: string; fallback?: 'allow' | 'block' | 'require_approval' } }
  | { policy_type: 'permission_escalation'; rules: { enforce: boolean; action?: DecisionType } }
  | { policy_type: 'green_contract'; rules: { action_types: string[]; required_level: GreenLevel; action?: DecisionType } }
  | { policy_type: 'branch_freshness'; rules: { action_types: string[]; freshness?: string[]; max_commits_behind?: number; action?: DecisionType } }
  | {
      policy_type: 'x402_spend_limit';
      rules: {
        max_spend_usd?: number;
        approval_threshold?: number;
        allowed_providers?: string[];
        blocked_providers?: string[];
        budget_usd?: number;
        budget_approval_threshold?: number;
        budget_window_days?: number;
        budget_scope?: 'org' | 'agent';
        on_failure?: 'allow' | 'block' | 'require_approval';
      };
    };

/** Raw guard_policies row (rules + agent_ids are JSON text). */
export interface GuardPolicyRow {
  id: string;
  org_id: OrganizationId;
  name: string;
  policy_type: GuardPolicyType;
  rules: string;
  active: number;
  agent_ids: Nullable<string>;
  created_by: Nullable<string>;
  created_at: Nullable<string>;
  updated_at: Nullable<string>;
}

/** The `context` object passed to evaluateGuard. */
export interface GuardContext {
  action_type: string;
  agent_id?: Nullable<string>;
  agent_name?: Nullable<string>;
  /** Agent-reported risk; may RAISE but never lower the server calculation. */
  risk_score?: Nullable<number>;
  systems_touched?: string[];
  reversible?: boolean;
  declared_goal?: Nullable<string>;
  verification_status?: VerificationStatus;
  replay_status?: ReplayStatus;
  act_status?: ActionBindingStatus;
  jti?: Nullable<string>;
  act_hash?: Nullable<string>;
  target?: Nullable<string>;
  write_paths?: string[];
  provider?: string;
  provider_id?: Nullable<string>;
  cost_estimate?: number;
  intel?: Record<string, unknown>;
  [field: string]: unknown;
}

/** Result returned by evaluateGuard. `risk_score` is the authoritative value. */
export interface GuardDecision {
  decision: DecisionType;
  decision_id: string;
  reason: Nullable<string>;
  signals: string[];
  matched_policies: string[];
  risk_score: number;
  agent_risk_score: Nullable<number>;
  verification_status: VerificationStatus;
  agent_id: Nullable<string>;
  agent_name: Nullable<string>;
  evaluated_at: string;
}

/** Raw guard_decisions audit row (matched_policies/context/evidence are JSON text). */
export interface GuardDecisionRow {
  id: string;
  org_id: OrganizationId;
  agent_id: Nullable<string>;
  agent_name: Nullable<string>;
  verification_status: Nullable<VerificationStatus>;
  replay_status: Nullable<ReplayStatus>;
  jti: Nullable<string>;
  act_status: Nullable<ActionBindingStatus>;
  act_hash: Nullable<string>;
  decision: DecisionType;
  reason: Nullable<string>;
  matched_policies: Nullable<string>;
  context: Nullable<string>;
  evidence: Nullable<string>;
  risk_score: Nullable<number>;
  action_type: Nullable<string>;
  created_at: Nullable<string>;
}

export interface SecurityFinding {
  type: string;
  match?: string;
  [field: string]: unknown;
}

export interface PromptInjectionFinding {
  risk_level: string;
  categories: string[];
  recommendation: 'allow' | 'warn' | 'block';
}

export interface SensitiveDataFinding {
  clean: boolean;
  findings: SecurityFinding[];
  redacted: string;
}

export interface AuditReceipt {
  kid: string;
  signature: string;
  [field: string]: unknown;
}
