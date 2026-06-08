/**
 * Canonical severity → route map. The SystemStatusBar ticker and any signal
 * deep-link use these so the mapping lives in exactly one place.
 *
 *   red   → /security?severity=red    (critical signals)
 *   amber → /security?severity=amber  (elevated signals)
 *
 * The matching risk filter for decisions is `/decisions?risk_min=<n>` (handled
 * by the decisions page + /api/actions). Severity tiers map to signals only.
 */
export const SEVERITY_ROUTE = {
  red: '/security?severity=red',
  amber: '/security?severity=amber',
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
