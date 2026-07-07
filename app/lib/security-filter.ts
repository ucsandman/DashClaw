/**
 * Canonical severity → route map. The SystemStatusBar ticker and any signal
 * deep-link use these so the mapping lives in exactly one place.
 *
 *   red   → /decisions    (critical signals)
 *   amber → /decisions    (elevated signals)
 *
 * The dedicated /security dashboard was removed in the v5 cull; governance
 * signals now live on the decisions ledger, so both tiers deep-link there
 * (matching the SystemStatusBar total-count link).
 */
export const SEVERITY_ROUTE = {
  red: '/decisions',
  amber: '/decisions',
} as const;

export type SignalSeverity = keyof typeof SEVERITY_ROUTE;

/**
 * Filter risk signals by a severity query param. 'red' / 'amber' narrow to that
 * tier; anything else (null, undefined, 'all', or an unknown value) returns the
 * full list unchanged. Pure — unit-testable in isolation.
 */
export function filterSignalsBySeverity<T extends { severity?: string | null }>(
  signals: T[],
  severity: string | null | undefined,
): T[] {
  if (severity === 'red' || severity === 'amber') {
    return signals.filter((s) => s.severity === severity);
  }
  return signals;
}
