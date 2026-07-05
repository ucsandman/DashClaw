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
    mcp?: { healthy?: boolean };
    green?: { observed_level?: string };
    tool?: { required_permission?: string };
  };
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
  createdAt: string;
  degraded: boolean;
}
