/**
 * Guard evaluation engine — shared option/dependency shapes threaded through
 * the guard phases. Extracted verbatim from evaluate.ts; behavior unchanged.
 */

import type { GuardEvalContext, GuardSql } from './types';

export interface GuardOptions {
  includeSignals?: boolean;
  computeSignals?: (orgId: string, agentId: string | null, sql: GuardSql) => Promise<Array<{ type: string; label: string }>>;
  /**
   * Side-effect-free dry-run (preflight plan preview). Skips exactly:
   *  - guard_decisions persistence and the GUARD_DECISION_CREATED event publish
   *  - BOTH grant passes (applyOperatorApprovalGrant, applyPlanStepGrant) — a
   *    dry-run must never consume a real single-use grant
   *  - webhook_check policies (runWebhookPolicies) — a dry-run must not fire
   *    real outbound HTTP to a customer endpoint or write a webhook_deliveries
   *    row for a preview the operator hasn't even reviewed yet
   * All other read/raise phases still run (local policies, prompt-injection
   * scan, calibration controller, signals), so the preview verdict reflects
   * everything EXCEPT the side effects above.
   * Do not pass signed contexts (jwt/jti) into simulate evaluations: jti
   * recording happens in resolveAgentIdentity at the route boundary, outside
   * this flag's reach — a dry-run with a live jti would consume it and poison
   * the real call.
   */
  simulate?: boolean;
}

// Shared per-evaluation dependencies threaded through the guard phases.
export interface GuardPhaseDeps {
  context: GuardEvalContext;
  sql: GuardSql;
  orgId: string;
}
