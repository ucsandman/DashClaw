/**
 * Cross-cutting decision-severity helpers, shared by the policy dispatcher and
 * the evaluation orchestrator. Kept in one place so both agree on the ordering.
 */

const DECISION_SEVERITY = { allow: 0, warn: 1, require_approval: 2, block: 3 } as const;
const SEVERITY = DECISION_SEVERITY as Record<string, number>;
/** Severity of a decision string (0 for an unknown value — matches JS `undefined`-comparison behaviour). */
const sevOf = (d: string): number => SEVERITY[d] ?? 0;
const hasSev = (d: string): boolean => SEVERITY[d] !== undefined;

export { DECISION_SEVERITY, sevOf, hasSev };
