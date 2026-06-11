import type { ActionContext, Capability, PolicyDecision, PolicyEffect, PolicyRule } from "./types.js";
/**
 * The policy engine is the safety core. It reasons about
 *   capability × environment kind × provider × live-flag
 * rather than about individual tool names, so any new tool inherits safe
 * defaults automatically.
 *
 * Evaluation order:
 *   1. Explicit user rules — the highest-priority matching rule wins. This is
 *      how a user opts INTO something the defaults forbid (e.g. "allow live
 *      Stripe writes for this project"), or tightens something further.
 *   2. Built-in defaults (see `defaultDecision`).
 *
 * Defaults (from the V0 spec):
 *   - reads: allowed everywhere
 *   - dev/staging writes: allowed (unless destructive/delete)
 *   - production reads: allowed
 *   - production writes / deploys / env-var changes: approval_required
 *   - live Stripe (or any `live` action) writes: approval_required
 *   - destructive SQL: blocked everywhere
 *   - deleting resources: blocked everywhere
 */
export declare function defaultDecision(ctx: ActionContext): PolicyDecision;
export declare function evaluatePolicy(rules: readonly PolicyRule[], ctx: ActionContext): PolicyDecision;
/** Human-readable capability label for messages. */
export declare function capabilityLabel(c: Capability): string;
export declare function effectIsExecutable(effect: PolicyEffect): boolean;
