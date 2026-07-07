/**
 * Canonical risk-band cutoffs, shared by every surface that colors or labels a
 * 0-100 risk score, so the same agent never reads Low on one surface and Medium
 * on another.
 *
 * Canonical choice: 40/70 — 70 is the de-facto "high" cutoff (decisions ledger
 * chips, security high-risk filters, guard policy defaults trend ≥70) and 40 is
 * the medium floor.
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
