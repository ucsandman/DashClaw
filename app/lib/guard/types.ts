/**
 * Shared guard types. No runtime code and no sibling imports — the leaf of the
 * guard module graph so every other guard/* module can depend on it freely.
 */

/** SQL client usable as a tagged template AND via `.query()` (Neon/postgres shape). */
export type GuardSql = {
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<Record<string, unknown>[]>;
  query: (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
};

export interface GuardEvalContext {
  action_type?: string;
  // Set only by the evidence mismatch swap (evaluate.ts): the caller's original
  // declared type, preserved so restrictive action-type policies still match it
  // after action_type is replaced by the derived type.
  declared_action_type?: string;
  agent_id?: string | null;
  agent_name?: string | null;
  risk_score?: number | string | null;
  systems_touched?: unknown;
  reversible?: boolean;
  declared_goal?: string | null;
  verification_status?: string;
  replay_status?: string;
  act_status?: string;
  jti?: string | null;
  act_hash?: string | null;
  // Evidence-first: the caller-attached actual act (shell/http/sql/file) the
  // server classifies (app/lib/guard/evidence.ts), and the grading source it
  // resolved to. Both flow through the persisted decision context.
  act?: unknown;
  intent_source?: 'evidence' | 'declared';
  /**
   * SERVER-SET-ONLY. The act classifier's tags for this call, written by
   * foldEvidenceIntoContext (evaluate.ts) from the server's own classification
   * of `act`. Deliberately NOT in GUARD_INPUT_SCHEMA (app/lib/validate.js), so
   * a caller-supplied value is stripped before evaluateGuard runs — that strip
   * is the whole reason a decision may be keyed on this field. Never populate
   * it from request input.
   */
  evidence_flags?: string[];
  target?: string;
  write_paths?: unknown;
  provider?: string;
  vendor?: string;
  provider_id?: string | null;
  cost_estimate?: number;
  cost?: number;
  tool?: { required_permission?: string };
  intel?: {
    branch?: { freshness: string; commits_behind?: number; name?: string };
    mcp?: { healthy?: boolean; server?: string };
    green?: { observed_level?: string };
    tool?: { required_permission?: string };
    /**
     * Emitted by _enrich_bash in hooks/dashclaw_pretool.py, which delegates
     * the classification to hooks/dashclaw_agent_intel/bash_classifier.py.
     * The classifier is the sole authority on risk — the plain-language
     * module reads these and never recomputes them.
     */
    bash?: {
      intent?: 'destructive' | 'write' | 'network' | 'read' | 'unknown';
      risk_score?: number;
      reversible?: boolean;
      validations?: Array<{ check?: string; reason?: string; severity?: string }>;
    };
    /** Emitted by _enrich_file in hooks/dashclaw_pretool.py. */
    file?: {
      sensitive_path?: boolean;
      traversal_detected?: boolean;
      outside_workspace?: boolean;
    };
  };
  client_capabilities?: unknown; // validated in validate.js; array of capability strings
  [field: string]: unknown;
}

export interface PolicyRow {
  id: string;
  name: string;
  policy_type: string;
  rules: string;
  agent_ids?: string | null;
  [field: string]: unknown;
}

export interface PolicyRules {
  threshold?: number;
  action?: string;
  action_types?: string[];
  allowed_action_types?: string[];
  target_prefix?: string;
  /** F1: a gating rule marked ungrantable can never have its warn /
   *  require_approval verdict cleared by an allow_grant (control-plane and
   *  catastrophe rules). */
  ungrantable?: boolean;
  /** F1: allow_grant lifetime stamp (ISO), written at creation; legacy grants
   *  without one age out from the row's created_at. */
  expires_at?: string;
  paths?: string[];
  max_actions?: number;
  window_minutes?: number;
  url?: string;
  timeout_ms?: number;
  on_timeout?: string;
  content_path?: string;
  source_path?: string;
  on_violation?: string;
  similarity_threshold?: number;
  min_history?: number;
  instruction?: string;
  model?: string;
  fallback?: string;
  enforce?: boolean;
  required_level?: string;
  freshness?: string[];
  max_commits_behind?: number;
  max_spend_usd?: number;
  approval_threshold?: number;
  allowed_providers?: string[];
  blocked_providers?: string[];
  budget_usd?: number;
  budget_approval_threshold?: number;
  budget_window_days?: number;
  budget_scope?: string;
  on_failure?: string;
  // require_evidence: escalation applied when a matching call was graded from
  // self-declared intent (no act attached). action_types (above) scopes it;
  // empty = all.
  enforcement?: string;
  // delegation_constraint: bounds a composed subagent's authority to a
  // provable subset of its parent's (agent_id "parent:child" identities only).
  blocked_action_types?: string[];
  parent?: string;
  child_types?: string[];
  max_depth?: number;
  max_risk_score?: number;
  blocked_path_globs?: string[];
  require_verified_parent?: boolean;
  escalate_action?: string;
  contain_above?: number;
}

export interface PolicyResult {
  action: string;
  reason: string;
  nonFabrication?: unknown;
  stripPaths?: string[];
  extraWarnings?: string[];
}

export interface Preliminary {
  decision: string;
  reasons: string[];
  warnings: string[];
  matchedPolicies: string[];
}

export interface GuardDecisionInsert {
  decisionId: string;
  orgId: string;
  agentId: string | null;
  agentName: string | null;
  verificationStatus: string;
  replayStatus: string;
  jti: string | null;
  actStatus: string;
  actHash: string | null;
  decision: string;
  reason: string | null;
  matchedPolicies: string[];
  context: unknown;
  evidence: string | null;
  riskScore: number;
  actionType: string | null;
  /** Client idempotency key, denormalized for the indexed replay lookup (drizzle/0058). */
  idempotencyKey: string | null;
  createdAt: string;
  degraded: boolean;
}
