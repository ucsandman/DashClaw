/**
 * v8.2 enforcement liveness (docs/plans/owner-roadmap.md §v8.2) — pure
 * derivation shared by the API route and the UI. Deliberately free of
 * server-only imports (no `crypto`, no DB types) so client components can
 * import it directly instead of reaching into the repository, which pulls
 * in node-only dependencies.
 */

/**
 * A run older than this is treated as no signal. The probe runs per-session
 * on the governing instance, so a full day without a run means the probe has
 * silently stopped — the same failure shape as the v4.72.1 hook-timeout // version-hardcode-allowed
 * overflow (hook cancelled, blocks skipped, ledger stays healthy).
 */
export const ENFORCEMENT_LIVENESS_STALE_MS = 24 * 60 * 60 * 1000;

/** Minimal shape of an enforcement_liveness_runs row the derivation needs. */
export interface EnforcementLivenessRunLike {
  verdict: string;
  finished_at: string | Date;
}

export type EnforcementLivenessState = 'holding' | 'stale' | 'broken';

/**
 * Pure: derive the fleet's enforcement-liveness state from the latest probe
 * run. Null (no run yet) or a run older than the stale window both read as
 * 'stale' — no signal is not the same claim as 'the probe is broken'. A
 * fresh 'held' verdict (the probe's action was correctly blocked/governed)
 * reads as 'holding'; any other fresh verdict ('executed' — the probe got
 * through ungoverned, or 'unprovable' — the probe couldn't tell) reads as
 * 'broken'.
 */
export function deriveEnforcementLivenessState(
  latest: EnforcementLivenessRunLike | null,
  now: number = Date.now(),
): EnforcementLivenessState {
  if (!latest) return 'stale';
  const finishedMs = latest.finished_at instanceof Date
    ? latest.finished_at.getTime()
    : Date.parse(latest.finished_at);
  if (!Number.isFinite(finishedMs) || now - finishedMs > ENFORCEMENT_LIVENESS_STALE_MS) return 'stale';
  return latest.verdict === 'held' ? 'holding' : 'broken';
}
