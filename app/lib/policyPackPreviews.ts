// Gallery taxonomy: every pack carries one audience (who it is for) and one
// strictness (how much it interrupts). The gallery's filter chips render from
// these two maps, so a new audience/strictness value needs an entry here.
export const PACK_AUDIENCES: Record<string, string> = {
  baseline: 'Baselines & postures',
  coding: 'Coding agents',
  money: 'Money & spend',
  comms: 'Outbound comms',
  infra: 'Infra & deploys',
  data: 'Data & secrets',
  fleets: 'Fleets & roles',
  support: 'Customer support',
  unattended: 'Unattended runs',
};

export const PACK_STRICTNESS: Record<string, string> = {
  permissive: 'Permissive',
  balanced: 'Balanced',
  strict: 'Strict',
};

export interface PackPreview {
  name: string;
  description: string;
  recommended_for: string;
  audience: keyof typeof PACK_AUDIENCES;
  strictness: keyof typeof PACK_STRICTNESS;
  /** Pack id to install first — the gallery renders it as a stacking note. */
  stack_after?: string;
}

export const PACK_PREVIEWS: Record<string, PackPreview> = {
  'enterprise-strict': {
    name: 'Enterprise Strict',
    description: 'Maximum security — all external actions blocked or gated, zero autonomous risk',
    recommended_for: 'Regulated industries, SOC 2, financial services',
    audience: 'baseline',
    strictness: 'strict',
  },
  'smb-safe': {
    name: 'SMB Safe',
    description: 'Balanced protection for small-to-medium teams — blocks destructive ops, gates external comms',
    recommended_for: 'Small-to-medium teams, general SaaS',
    audience: 'baseline',
    strictness: 'balanced',
  },
  'startup-growth': {
    name: 'Startup Growth',
    description: 'Permissive with guardrails — gates customer-facing comms, allows internal messaging',
    recommended_for: 'Fast-moving teams, internal tooling',
    audience: 'baseline',
    strictness: 'balanced',
  },
  'development': {
    name: 'Development',
    description: 'Minimal guardrails for dev environments — warns on destructive ops, blocks production access',
    recommended_for: 'Development and staging environments',
    audience: 'baseline',
    strictness: 'permissive',
  },
  'layered-intelligence': {
    name: 'Layered Intelligence',
    description: 'Graduated autonomy, test verification gates, and branch freshness enforcement for coding agents',
    recommended_for: 'Teams using Claude Code hooks with dashclaw-agent-intel module',
    audience: 'coding',
    strictness: 'balanced',
    stack_after: 'claude-code-starter',
  },
  'claude-code-starter': {
    name: 'Claude Code Starter',
    description: 'Day-one baseline for coding agents — blocks mass-destructive ops, gates network calls and package installs, rate-limits runaways. Install first; stack layered-intelligence on top.',
    recommended_for: 'Any coding agent (Claude Code, Cursor, Aider) on a fresh DashClaw instance',
    audience: 'coding',
    strictness: 'balanced',
  },
  'catastrophe-only': {
    name: 'Catastrophe Only',
    description: 'The self-hosted default — blocks mass-destructive operations, holds secret-file writes for approval, rate-limits runaways. Everything else runs.',
    recommended_for: 'Every org. Seeded automatically for new self-hosted instances; import here to retrofit an existing one.',
    audience: 'baseline',
    strictness: 'permissive',
  },
  'spend-lockdown': {
    name: 'Spend Lockdown',
    description: 'Real money is a named high-risk class — every spend-class action is held for approval of the exact amount, spend claims need an attached act, and spend loops trip a rate warning.',
    recommended_for: 'Any agent with access to payment methods, credits, or subscriptions',
    audience: 'money',
    strictness: 'strict',
    stack_after: 'catastrophe-only',
  },
  'outbound-comms-guard': {
    name: 'Outbound Comms Guard',
    description: 'Every external send waits for a human, outbound content is verified against a source of truth before it leaves, and send bursts trip a rate warning.',
    recommended_for: 'Agents that can email, message, or post to real people',
    audience: 'comms',
    strictness: 'strict',
    stack_after: 'catastrophe-only',
  },
  'night-shift': {
    name: 'Night Shift',
    description: 'The unattended-run posture — everything external pauses in the approval queue while you sleep, high-risk acts and plan deviations pause too, runaway loops are blocked. Resume with one click in the morning.',
    recommended_for: 'Overnight and unattended agent runs',
    audience: 'unattended',
    strictness: 'strict',
    stack_after: 'catastrophe-only',
  },
  'prod-infra-shield': {
    name: 'Prod Infra Shield',
    description: 'Deploys, migrations, and DNS wait for a human; production config paths are approval-gated; deploys without green verification or from stale branches are blocked.',
    recommended_for: 'Agents with production deploy or infrastructure access',
    audience: 'infra',
    strictness: 'strict',
    stack_after: 'catastrophe-only',
  },
  'data-protection': {
    name: 'Data Protection',
    description: 'Writes to secret and credential paths are blocked, data exports and transfers wait for a human, and exports need an attached act.',
    recommended_for: 'Agents that touch customer data, secrets, or credentials',
    audience: 'data',
    strictness: 'strict',
    stack_after: 'catastrophe-only',
  },
  'fleet-control': {
    name: 'Fleet Control',
    description: 'Subagent authority is depth-capped and locked out of deploys and spend, permission escalation is blocked, and every agent gets a per-agent rate warning.',
    recommended_for: 'Orchestrators that spawn subagent fleets',
    audience: 'fleets',
    strictness: 'balanced',
    stack_after: 'catastrophe-only',
  },
  'support-agent': {
    name: 'Support Agent',
    description: 'Refunds and credits wait for a human, replies about accounts are verified against the record, and money claims need an attached act.',
    recommended_for: 'Customer-facing helper agents (support, success, billing)',
    audience: 'support',
    strictness: 'balanced',
    stack_after: 'catastrophe-only',
  },
  'ci-release-bot': {
    name: 'CI Release Bot',
    description: 'Fast lane for build and test, hard gate at the release edge — no release without green verification, no release from a stale branch, production deploys held for a human.',
    recommended_for: 'CI and release automation agents',
    audience: 'coding',
    strictness: 'permissive',
    stack_after: 'claude-code-starter',
  },
  'evidence-first': {
    name: 'Evidence First',
    description: 'Every action graded from self-declared intent is warned and recorded; the high-stakes classes escalate to approval. A starting point for audit readiness, not a certified control set.',
    recommended_for: 'Teams preparing for audits or building a defensible trail',
    audience: 'data',
    strictness: 'balanced',
    stack_after: 'catastrophe-only',
  },
  'read-only-analyst': {
    name: 'Read-Only Analyst',
    description: 'A role for research agents that must never change anything — everything outside the read/record envelope escalates to approval. Scope it to your analyst agents after install.',
    recommended_for: 'Research, analysis, and reporting agents',
    audience: 'fleets',
    strictness: 'strict',
  },
  'browser-operator-guard': {
    name: 'Browser Operator Guard',
    description: 'Form submissions, logins, downloads, and purchases wait for a human; high-risk browser acts pause; click loops trip a rate warning. Browsing and reading stay ungoverned.',
    recommended_for: 'Agents driving real browsers (OpenClaw, computer use)',
    audience: 'unattended',
    strictness: 'strict',
    stack_after: 'catastrophe-only',
  },
};

export const AVAILABLE_PACKS = Object.keys(PACK_PREVIEWS);

interface PolicyRule {
  block?: boolean;
  require?: string;
  warn?: boolean;
  threshold?: unknown;
  rate_limit?: unknown;
  action_types?: string[];
  [key: string]: unknown;
}

interface PolicyLike {
  policy_type?: string;
  rule?: PolicyRule;
  [key: string]: unknown;
}

export function inferPolicyType(policy: PolicyLike): string {
  if (policy.policy_type) return policy.policy_type;
  const rule: PolicyRule = policy.rule || {};
  if (rule.block === true) return 'block_action_type';
  if (rule.require === 'approval') return 'require_approval';
  if (rule.warn === true) return 'risk_threshold';
  if (rule.threshold !== undefined) return 'risk_threshold';
  if (rule.rate_limit) return 'rate_limit';
  return 'risk_threshold';
}

// Decision bucket a pack policy lands in once installed, mirroring the /policies
// Ledger's grouping. Explicit rule actions win; otherwise fall back to the
// evaluator's default action for the policy type (see guard/policy.ts).
export type PackPolicyBucket = 'block' | 'require_approval' | 'warn' | 'allow';

const BUCKET_FALLBACK_BY_TYPE: Record<string, PackPolicyBucket> = {
  block_action_type: 'block',
  risk_threshold: 'block',
  green_contract: 'block',
  branch_freshness: 'block',
  non_fabrication: 'block',
  permission_escalation: 'block',
  require_approval: 'require_approval',
  protected_path: 'require_approval',
  delegation_constraint: 'require_approval',
  role_constraint: 'require_approval',
  deviation_response: 'require_approval',
  warn_action_type: 'warn',
  agent_allowlist: 'warn',
  rate_limit: 'warn',
  require_evidence: 'warn',
  allow_grant: 'allow',
};

export function bucketForPackPolicy(policy: PolicyLike): PackPolicyBucket {
  const type = inferPolicyType(policy);
  const rules = (policy.rules as PolicyRule | undefined) || policy.rule || {};
  const explicit = rules.action ?? rules.enforcement ?? rules.escalate_action ?? rules.on_violation
    ?? (rules.require === 'approval' ? 'require_approval' : undefined)
    ?? (rules.block === true ? 'block' : undefined)
    ?? (rules.warn === true ? 'warn' : undefined);
  if (explicit === 'block' || explicit === 'require_approval' || explicit === 'warn') return explicit;
  return BUCKET_FALLBACK_BY_TYPE[type] ?? 'warn';
}

export function summarizeRules(policy: PolicyLike): string {
  const rule: PolicyRule = (policy.rules as PolicyRule | undefined) || policy.rule || {};
  const parts: string[] = [];
  if (rule.action_types) parts.push(`action_types: [${rule.action_types.join(', ')}]`);
  if (rule.threshold !== undefined) parts.push(`threshold: ${rule.threshold}`);
  if (rule.block) parts.push('block: true');
  if (rule.require) parts.push(`require: ${rule.require}`);
  if (rule.warn) parts.push('warn: true');
  if (typeof rule.action === 'string') parts.push(`action: ${rule.action}`);
  if (typeof rule.max_actions === 'number') parts.push(`max_actions: ${rule.max_actions}/${rule.window_minutes ?? 60}min`);
  if (Array.isArray(rule.paths)) parts.push(`paths: [${(rule.paths as string[]).join(', ')}]`);
  if (typeof rule.enforcement === 'string') parts.push(`enforcement: ${rule.enforcement}`);
  if (typeof rule.required_level === 'string') parts.push(`required_level: ${rule.required_level}`);
  if (typeof rule.max_depth === 'number') parts.push(`max_depth: ${rule.max_depth}`);
  if (Array.isArray(rule.allowed_action_types)) parts.push(`allowed: [${(rule.allowed_action_types as string[]).join(', ')}]`);
  return parts.join(', ') || 'custom';
}
