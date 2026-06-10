/**
 * Canonical risk-band cutoffs, shared by every surface that colors or labels a
 * 0-100 risk score. Before this module, /reputation used 33/66 while /swarm
 * used 40/70 and the decisions ledger used 70 — the same agent could read Low
 * on one page and Medium on another.
 *
 * Canonical choice: 40/70. Rationale: 70 was already the de-facto "high"
 * cutoff in the most places (decisions ledger chips, mission-control emphasis
 * thresholds, security high-risk filters, guard policy defaults trend ≥70),
 * and 40 preserves swarm's existing medium floor; only /reputation's 33/66
 * shifts, and it shifts toward the majority.
 */
export const RISK_MEDIUM_MIN = 40;
export const RISK_HIGH_MIN = 70;

export type RiskBand = 'low' | 'medium' | 'high';

export function riskBand(score: number | null | undefined): RiskBand {
  const n = Number(score) || 0;
  if (n >= RISK_HIGH_MIN) return 'high';
  if (n >= RISK_MEDIUM_MIN) return 'medium';
  return 'low';
}
