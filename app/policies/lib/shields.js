export const SHIELDS = [
  {
    id: 'deploy_gate',
    name: 'Deploy Gate',
    description: 'Require approval before any deploy or migration',
    icon: 'Rocket',
    policyType: 'require_approval',
    defaultRules: { action_types: ['deploy', 'migrate'] },
  },
  {
    id: 'risk_high',
    name: 'High Risk Review',
    description: 'Require approval for actions with risk score 70+',
    icon: 'AlertTriangle',
    policyType: 'risk_threshold',
    defaultRules: { threshold: 70, action: 'require_approval' },
  },
  {
    id: 'risk_critical',
    name: 'Critical Risk Block',
    description: 'Block actions with risk score 90 or above',
    icon: 'ShieldAlert',
    policyType: 'risk_threshold',
    defaultRules: { threshold: 90, action: 'block' },
  },
  {
    id: 'destructive_block',
    name: 'Destructive Ops Block',
    description: 'Block apply, migrate, and sync operations',
    icon: 'Ban',
    policyType: 'block_action_type',
    defaultRules: { action_types: ['apply', 'migrate', 'sync'] },
  },
  {
    id: 'rate_limiter',
    name: 'Rate Limiter',
    description: 'Warn when an agent exceeds 30 actions per hour',
    icon: 'Timer',
    policyType: 'rate_limit',
    defaultRules: { max_actions: 30, window_minutes: 60, action: 'warn' },
  },
  {
    id: 'api_review',
    name: 'API Call Review',
    description: 'Require approval for all API actions',
    icon: 'Globe',
    policyType: 'require_approval',
    defaultRules: { action_types: ['api'] },
  },
  {
    id: 'outbound_gate',
    name: 'Outbound Message Gate',
    description: 'Require approval before sending messages or posts',
    icon: 'MessageSquare',
    policyType: 'require_approval',
    defaultRules: { action_types: ['message', 'post'] },
  },
  {
    id: 'non_fabrication_guard',
    name: 'No Fabricated Facts',
    description: 'Require approval for outbound content that states a fact not traceable to its source-of-truth',
    icon: 'BadgeCheck',
    policyType: 'non_fabrication',
    defaultRules: { on_violation: 'require_approval', content_path: 'content', source_path: 'source_of_truth' },
  },
  {
    id: 'evidence_required',
    name: 'Evidence Required',
    description: 'Require approval when a call is graded from a self-declared intent instead of server-classified evidence',
    icon: 'Fingerprint',
    policyType: 'require_evidence',
    defaultRules: { action_types: [], enforcement: 'require_approval' },
  },
];

/**
 * Match existing policies to shield definitions via the _shield tag in rules JSON.
 * Returns a Map of shieldId -> policy (or null if not activated).
 */
export function matchShieldsToPolicies(policies) {
  const map = new Map();
  for (const shield of SHIELDS) {
    map.set(shield.id, null);
  }
  for (const policy of policies) {
    try {
      const rules = JSON.parse(policy.rules || '{}');
      if (rules._shield && map.has(rules._shield)) {
        map.set(rules._shield, policy);
      }
    } catch { /* skip malformed */ }
  }
  return map;
}

/**
 * Build the API payload to create a shield policy.
 */
export function buildShieldPayload(shield) {
  return {
    name: shield.name,
    policy_type: shield.policyType,
    rules: JSON.stringify({ ...shield.defaultRules, _shield: shield.id }),
    active: 1,
  };
}
