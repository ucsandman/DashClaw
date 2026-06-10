/**
 * Width math for the calibration distribution bars on /scoring. Guarded:
 * when every sampled value is identical (max === min) the old inline math
 * divided by zero and emitted NaN% widths.
 */
export function distributionSegmentPct(from: number, to: number, min: number, max: number): number {
  const span = Number(max) - Number(min);
  if (!Number.isFinite(span) || span <= 0) return 0;
  const pct = ((Number(to) - Number(from)) / span) * 100;
  return Number.isFinite(pct) ? Math.max(0, Math.min(100, pct)) : 0;
}
