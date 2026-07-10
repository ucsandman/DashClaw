export interface PackPreview {
  name: string;
  description: string;
  recommended_for: string;
}

export const PACK_PREVIEWS: Record<string, PackPreview> = {
  'enterprise-strict': {
    name: 'Enterprise Strict',
    description: 'Maximum security — all external actions blocked or gated, zero autonomous risk',
    recommended_for: 'Regulated industries, SOC 2, financial services',
  },
  'smb-safe': {
    name: 'SMB Safe',
    description: 'Balanced protection for small-to-medium teams — blocks destructive ops, gates external comms',
    recommended_for: 'Small-to-medium teams, general SaaS',
  },
  'startup-growth': {
    name: 'Startup Growth',
    description: 'Permissive with guardrails — gates customer-facing comms, allows internal messaging',
    recommended_for: 'Fast-moving teams, internal tooling',
  },
  'development': {
    name: 'Development',
    description: 'Minimal guardrails for dev environments — warns on destructive ops, blocks production access',
    recommended_for: 'Development and staging environments',
  },
  'layered-intelligence': {
    name: 'Layered Intelligence',
    description: 'Graduated autonomy, test verification gates, and branch freshness enforcement for coding agents',
    recommended_for: 'Teams using Claude Code hooks with dashclaw-agent-intel module',
  },
  'claude-code-starter': {
    name: 'Claude Code Starter',
    description: 'Day-one baseline for coding agents — blocks mass-destructive ops, gates network calls and package installs, rate-limits runaways. Install first; stack layered-intelligence on top.',
    recommended_for: 'Any coding agent (Claude Code, Cursor, Aider) on a fresh DashClaw instance',
  },
  'catastrophe-only': {
    name: 'Catastrophe Only',
    description: 'The self-hosted default — blocks mass-destructive operations, holds secret-file writes for approval, rate-limits runaways. Everything else runs.',
    recommended_for: 'Every org. Seeded automatically for new self-hosted instances; import here to retrofit an existing one.',
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

export function summarizeRules(policy: PolicyLike): string {
  const rule: PolicyRule = policy.rule || {};
  const parts: string[] = [];
  if (rule.action_types) parts.push(`action_types: [${rule.action_types.join(', ')}]`);
  if (rule.threshold !== undefined) parts.push(`threshold: ${rule.threshold}`);
  if (rule.block) parts.push('block: true');
  if (rule.require) parts.push(`require: ${rule.require}`);
  if (rule.warn) parts.push('warn: true');
  return parts.join(', ') || 'custom';
}
