// §9.2 Governance contracts — guard decisions, policies, risk.
//
// Decisions and policies are discriminated unions. The policy discriminant is
// `policy_type` (exactly how app/lib/guard.js evaluatePolicy switches); the
// `rules` JSON-text column parses into the matching `rules` shape.

import type { Nullable } from './brand';
import type {
  VerificationStatus,
} from './identity';

export type DecisionType = 'allow' | 'warn' | 'allow_contained' | 'require_approval' | 'block';

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
  | 'permission_escalation'
  | 'green_contract'
  | 'branch_freshness'
  | 'require_evidence'
  | 'delegation_constraint'
  | 'role_constraint'
  | 'deviation_response'
  | 'assumption_hold';

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
  | { policy_type: 'permission_escalation'; rules: { enforce: boolean; action?: DecisionType } }
  | { policy_type: 'green_contract'; rules: { action_types: string[]; required_level: GreenLevel; action?: DecisionType } }
  | { policy_type: 'branch_freshness'; rules: { action_types: string[]; freshness?: string[]; max_commits_behind?: number; action?: DecisionType } };

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
