/**
 * Convert DashClaw policy format to guardrailgen YAML format
 * Absorbed from dashclaw-guardrails/packages/guardrailgen-js/src/converters/dashclaw-to-yaml.js
 */

/** DashClaw policy object from guard_policies table (untrusted/loosely-typed). */
export interface DashClawPolicy {
  id?: string;
  name: string;
  policy_type: string;
  rules: string | Record<string, unknown>;
  active?: number;
  [key: string]: unknown;
}

interface GuardrailTest {
  name: string;
  input: Record<string, unknown>;
  expect: Record<string, unknown>;
}

interface ConvertedPolicy {
  id: string;
  description: string;
  applies_to: { tools: string[] };
  rule: Record<string, unknown>;
  tests?: GuardrailTest[];
}

/**
 * Convert a single DashClaw policy to guardrailgen structure
 */
export function convertPolicy(policy: DashClawPolicy): ConvertedPolicy {
  const rules: Record<string, unknown> = typeof policy.rules === 'string'
    ? JSON.parse(policy.rules)
    : policy.rules;

  const converted: ConvertedPolicy = {
    id: policy.id || policy.name.toLowerCase().replace(/\s+/g, '_'),
    description: policy.name,
    applies_to: extractAppliesTo(policy.policy_type, rules),
    rule: convertRule(policy.policy_type, rules),
  };

  if (rules.tests && Array.isArray(rules.tests)) {
    converted.tests = rules.tests as GuardrailTest[];
  } else {
    converted.tests = generatePlaceholderTests(policy.policy_type, rules);
  }

  return converted;
}

function extractAppliesTo(policyType: string, rules: Record<string, unknown>): { tools: string[] } {
  switch (policyType) {
    case 'require_approval':
    case 'block_action_type':
      return { tools: (rules.action_types as string[]) || ['*'] };
    case 'risk_threshold':
    case 'rate_limit':
    default:
      return { tools: ['*'] };
  }
}

function convertRule(policyType: string, rules: Record<string, unknown>): Record<string, unknown> {
  switch (policyType) {
    case 'require_approval':
      return { require: 'approval' };
    case 'block_action_type':
      return { block: true };
    case 'risk_threshold':
      return { block: true, _dashclaw_type: 'risk_threshold', _threshold: rules.threshold || 80, _action: rules.action || 'block' };
    case 'rate_limit':
      return { block: true, _dashclaw_type: 'rate_limit', _max_actions: rules.max_actions || 50, _window_minutes: rules.window_minutes || 60 };
    case 'webhook_check':
      return { require: 'approval', _dashclaw_type: 'webhook_check', _url: rules.url, _timeout_ms: rules.timeout_ms || 5000, _on_timeout: rules.on_timeout || 'require_approval' };
    case 'behavioral_anomaly':
    case 'semantic_check':
      return { block: true, _dashclaw_type: policyType, _note: 'Advanced policy type - test generation limited' };
    default:
      return { block: true, _dashclaw_type: policyType };
  }
}

function generatePlaceholderTests(policyType: string, rules: Record<string, unknown>): GuardrailTest[] {
  switch (policyType) {
    case 'require_approval': {
      const actionTypes = (rules.action_types as string[]) || ['external_send'];
      return [
        { name: 'blocks_without_approval', input: { tool: actionTypes[0], args: {}, approval: false }, expect: { allowed: false } },
        { name: 'allows_with_approval', input: { tool: actionTypes[0], args: {}, approval: true }, expect: { allowed: true } },
      ];
    }
    case 'block_action_type': {
      const blockedTypes = (rules.action_types as string[]) || ['destructive'];
      return [
        { name: 'blocks_action_type', input: { tool: blockedTypes[0], args: {} }, expect: { allowed: false } },
      ];
    }
    default:
      return [
        { name: 'placeholder_test', input: { tool: 'example_tool', args: {} }, expect: { allowed: false } },
      ];
  }
}

interface GuardrailDocument {
  version: number;
  project: string;
  policies: ConvertedPolicy[];
}

/**
 * Convert all DashClaw policies to guardrailgen document structure
 */
export function convertPolicies(
  policies: DashClawPolicy[],
  projectName = 'dashclaw-policies',
): GuardrailDocument {
  return {
    version: 1,
    project: projectName,
    policies: policies
      .filter((p) => p.active !== 0)
      .map(convertPolicy),
  };
}
