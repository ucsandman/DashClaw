/**
 * Realtime stat update for decision.created events, shared by /learning and
 * LearningStatsCard. The server computes successRate over TERMINAL outcomes
 * only (pending excluded) — the old client recompute divided by ALL decisions,
 * so the live-updated rate drifted from the server's after every event.
 * `totalWithOutcome` (the terminal denominator) comes from GET /api/learning.
 */
export interface RealtimeLearningStats {
  totalDecisions: number;
  successRate: number;
  totalWithOutcome: number;
}

export function applyDecisionToStats<T extends RealtimeLearningStats>(
  prev: T,
  outcome: string | null | undefined,
): T {
  const next = { ...prev, totalDecisions: prev.totalDecisions + 1 };
  if (!outcome || outcome === 'pending') return next; // pending never moves the rate
  const successCount =
    Math.round((prev.successRate / 100) * prev.totalWithOutcome) + (outcome === 'success' ? 1 : 0);
  const totalWithOutcome = prev.totalWithOutcome + 1;
  return { ...next, totalWithOutcome, successRate: Math.round((successCount / totalWithOutcome) * 100) };
}
