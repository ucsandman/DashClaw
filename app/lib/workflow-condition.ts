/**
 * Workflow step condition evaluator.
 * Resolves a condition template against execution context and checks truthiness.
 * No dynamic code execution — uses the same resolveVars as step config interpolation.
 */

import { resolveVars } from './template-vars';

const FALSY_STRINGS = new Set(['false', '0', '']);

function isFalsy(value: unknown): boolean {
  if (value == null) return true;
  if (value === false || value === 0) return true;
  if (typeof value === 'string' && FALSY_STRINGS.has(value.toLowerCase().trim())) return true;
  return false;
}

function isUnresolvedTemplate(value: unknown): boolean {
  return typeof value === 'string' && /\$\{[^}]+\}/.test(value);
}

export interface EvaluateConditionResult {
  shouldRun: boolean;
  resolvedValue: unknown;
}

/**
 * Evaluate a condition template against the workflow execution context.
 *
 * @param conditionTemplate - template string like '${steps.step_1.output.found}'
 * @param context - { variables, steps } execution context
 */
export function evaluateCondition(
  conditionTemplate: string | null | undefined,
  context: unknown,
): EvaluateConditionResult {
  if (conditionTemplate == null || conditionTemplate === '') {
    return { shouldRun: true, resolvedValue: null };
  }

  const resolved = resolveVars(conditionTemplate, context);

  // If the template didn't resolve (still contains ${...}), treat as falsy
  if (isUnresolvedTemplate(resolved)) {
    return { shouldRun: false, resolvedValue: resolved };
  }

  return {
    shouldRun: !isFalsy(resolved),
    resolvedValue: resolved,
  };
}
