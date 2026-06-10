/**
 * Policy evaluator - deterministic logic for guardrails
 * Absorbed from dashclaw-guardrails/packages/guardrailgen-js/src/evaluator.js
 */

import { globToRegex } from '../globToRegex';

interface GuardrailPolicy {
  id: string;
  applies_to: { tools?: string[] };
  rule: { block?: boolean; allowlist?: string[]; require?: string };
}

interface GuardrailInput {
  tool: string;
  args?: unknown;
  approval?: boolean;
  context?: { approved?: boolean } | null;
}

interface GuardrailResult {
  allowed: boolean;
  reason?: string;
  policy_id?: string;
}

/**
 * Evaluate a single policy against an input action.
 * Distinct name avoids silent confusion with the 6-arg async guard.js evaluatePolicy.
 */
export function evaluateGuardrailPolicy(policy: GuardrailPolicy, input: GuardrailInput): GuardrailResult {
  const { id, applies_to, rule } = policy;

  // Check if policy applies to this tool
  const toolMatches = applies_to.tools?.some((pattern) => {
    if (pattern.includes('*')) {
      return globToRegex(pattern).test(input.tool);
    }
    return pattern === input.tool;
  });

  if (!toolMatches) {
    return { allowed: true, policy_id: id, reason: 'policy does not apply' };
  }

  // Evaluate rule
  if (rule.block === true) {
    if (rule.allowlist && Array.isArray(rule.allowlist)) {
      if (rule.allowlist.includes(input.tool)) {
        return { allowed: true, policy_id: id, reason: 'allowlisted' };
      }
    }
    return { allowed: false, policy_id: id, reason: 'blocked by policy' };
  }

  if (rule.require === 'approval') {
    const hasApproval = input.approval === true || input.context?.approved === true;
    if (!hasApproval) {
      return { allowed: false, policy_id: id, reason: 'approval required' };
    }
    return { allowed: true, policy_id: id, reason: 'approved' };
  }

  // Default allow if no blocking rule matched
  return { allowed: true, policy_id: id };
}

/**
 * Evaluate all policies against an input action
 * Returns the first blocking result, or allowed if all pass
 */
export function evaluatePolicies(policies: GuardrailPolicy[], input: GuardrailInput): GuardrailResult {
  for (const policy of policies) {
    const result = evaluateGuardrailPolicy(policy, input);
    if (!result.allowed) {
      return result;
    }
  }
  return { allowed: true, reason: 'all policies passed' };
}

// Backward-compat alias — kept for existing tests and legacy callers.
// New code should import evaluateGuardrailPolicy to avoid confusion with
// the 6-arg async evaluatePolicy in app/lib/guard.js.
export const evaluatePolicy = evaluateGuardrailPolicy;
