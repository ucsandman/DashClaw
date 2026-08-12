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
  /** Which seam reported (drizzle/0072). Absent on pre-0072 rows. */
  runtime?: string;
}

export type EnforcementLivenessState = 'holding' | 'stale' | 'broken';

/** Worst-first. A fleet is only as live as its least-live seam. */
const STATE_SEVERITY: Record<EnforcementLivenessState, number> = {
  broken: 2,
  stale: 1,
  holding: 0,
};

/** One seam's verdict, plus when it last spoke. */
export interface EnforcementLivenessSeam {
  runtime: string;
  state: EnforcementLivenessState;
  finishedAt: string | null;
}

export interface FleetEnforcementLiveness {
  /** Rollup across every seam that has reported inside the retention window. */
  state: EnforcementLivenessState;
  seams: EnforcementLivenessSeam[];
}

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

/**
 * Pure: roll every seam's latest run up into one fleet verdict (drizzle/0072).
 *
 * WHY THIS EXISTS: the org verdict used to be the single newest row across all
 * seams. Claude Code and Codex both install the probe and both report
 * `source = 'session-start'`, so whichever ran last spoke for the whole fleet —
 * a Codex seam that had stopped enforcing rendered 'holding' behind a healthy
 * Claude Code run 10 minutes old. That is the probe's own failure mode turned
 * inward, so the rollup takes the WORST seam, never the newest.
 *
 * A seam is "known" once it has reported inside the retention window; it then
 * stays expected, so going quiet reads as 'stale' rather than disappearing.
 * No seams at all is 'stale' — no signal is not a claim of health.
 */
export function deriveFleetEnforcementLiveness(
  latestPerRuntime: EnforcementLivenessRunLike[],
  now: number = Date.now(),
): FleetEnforcementLiveness {
  const seams = latestPerRuntime.map((run) => ({
    runtime: run.runtime || 'unknown',
    state: deriveEnforcementLivenessState(run, now),
    finishedAt: run.finished_at instanceof Date ? run.finished_at.toISOString() : run.finished_at ?? null,
  }));
  seams.sort((a, b) => (
    STATE_SEVERITY[b.state] - STATE_SEVERITY[a.state] || a.runtime.localeCompare(b.runtime)
  ));
  const state = seams.reduce<EnforcementLivenessState>(
    (worst, s) => (STATE_SEVERITY[s.state] > STATE_SEVERITY[worst] ? s.state : worst),
    seams.length ? 'holding' : 'stale',
  );
  return { state, seams };
}
