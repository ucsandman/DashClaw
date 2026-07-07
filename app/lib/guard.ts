/**
 * Guard evaluation engine — façade.
 *
 * The implementation lives in cohesive modules under `./guard/`; this file
 * preserves the original public surface so no consumer import changes. See:
 *   - guard/caches.ts       — all module-level mutable state + cache invalidation
 *   - guard/risk.ts         — server risk scoring + RiskBreakdown
 *   - guard/policy.ts       — evaluatePolicy / evaluateWebhookPolicy + degradation contract
 *   - guard/persistence.ts  — persistGuardDecision (audit row)
 *   - guard/evaluate.ts     — evaluateGuard orchestration
 */

export { resolveDegradedAction, evaluatePolicy, evaluateWebhookPolicy, KNOWN_POLICY_TYPES, isKnownPolicyType } from './guard/policy';
export { computeRiskScore } from './guard/risk';
export type { RiskFactor, RiskBreakdown } from './guard/risk';
export {
  invalidateGuardPolicyCache,
  invalidateGuardRiskTemplateCache,
  invalidateGuardSettingsCache,
  getOrgHaltState,
  __resetGuardCaches,
} from './guard/caches';
export { persistGuardDecision } from './guard/persistence';
export { evaluateGuard } from './guard/evaluate';
export type { PromptInjectionShieldStatus } from './guard/evaluate';
