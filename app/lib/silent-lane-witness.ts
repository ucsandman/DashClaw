/**
 * v8.3 silent-lane witness (docs/plans/2026-08-06-silent-lane-witness-spec.md,
 * MoltFire incident, maintainer log 2026-08-06) — pure derivation shared by
 * the posture finding and the /setup panel. Mirrors
 * deriveEnforcementLivenessState's shape: free of server-only imports (no
 * `crypto`, no DB types) so client components can import it directly instead
 * of reaching into the repository.
 *
 * v8.2 answered "did the block actually stop execution?" (verdicts by
 * witness). This answers the prior question: "did governance see the
 * activity at all?" Per agent, over a trailing window, activity evidence
 * (a self-reported turn) is compared against governance witness (a guard
 * evaluation or hook-attributed row). `recorded-ungoverned` is the MoltFire
 * incident shape — a lane that reports its own activity but that no guard
 * ever saw — and it is a standing posture, not a transient alert: it clears
 * the instant a witness row lands, and stays lit for as long as it's true.
 */

export const SILENT_LANE_WITNESS_DEFAULT_WINDOW_MINUTES = 60;
export const SILENT_LANE_WITNESS_MIN_WINDOW_MINUTES = 5;
export const SILENT_LANE_WITNESS_MAX_WINDOW_MINUTES = 24 * 60;

/**
 * DASHCLAW_WITNESS_WINDOW_MINUTES, clamped to a sane range; default 60.
 * Reads process.env directly (no server-only import needed for that).
 */
export function getWitnessWindowMinutes(): number {
  const raw = Number(process.env.DASHCLAW_WITNESS_WINDOW_MINUTES);
  if (!Number.isFinite(raw) || raw <= 0) return SILENT_LANE_WITNESS_DEFAULT_WINDOW_MINUTES;
  return Math.min(Math.max(Math.floor(raw), SILENT_LANE_WITNESS_MIN_WINDOW_MINUTES), SILENT_LANE_WITNESS_MAX_WINDOW_MINUTES);
}

export type SilentLaneWitnessState = 'governed' | 'recorded-ungoverned' | 'quiet';

/** Minimal per-agent aggregate the derivation needs (keeps this module pure). */
export interface AgentLaneWitnessLike {
  agentId: string;
  lastActivityAt: string | Date | null;
  lastActivitySource: string | null;
  lastWitnessAt: string | Date | null;
}

export interface AgentLaneWitness {
  agentId: string;
  state: SilentLaneWitnessState;
  lastActivityAt: string | null;
  lastActivitySource: string | null;
  lastWitnessAt: string | null;
}

function parseMs(value: string | Date | null): number | null {
  if (!value) return null;
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function toIso(value: string | Date | null): string | null {
  const ms = parseMs(value);
  return ms == null ? null : new Date(ms).toISOString();
}

/** now - ts <= window is inclusive at the edge (mirrors the stale-window check in enforcement-liveness.ts). */
function withinWindow(value: string | Date | null, windowMinutes: number, now: number): boolean {
  const ms = parseMs(value);
  return ms != null && now - ms <= windowMinutes * 60_000;
}

/**
 * Pure: derive one agent's state from its raw activity/witness timestamps.
 * The activity/witness matrix (spec table):
 *
 *   witness present               -> 'governed' (witness implies activity)
 *   activity present, no witness  -> 'recorded-ungoverned' (the alarm state)
 *   neither present                -> 'quiet' (no claim either way)
 *
 * windowMinutes/now decide freshness here (not at query time) so the exact
 * window edge is a pure-function concern, unit-testable without a database —
 * same division of labor as deriveEnforcementLivenessState.
 */
export function deriveSilentLaneWitnessState(
  agent: AgentLaneWitnessLike,
  windowMinutes: number = SILENT_LANE_WITNESS_DEFAULT_WINDOW_MINUTES,
  now: number = Date.now(),
): AgentLaneWitness {
  const hasWitness = withinWindow(agent.lastWitnessAt, windowMinutes, now);
  const hasActivity = withinWindow(agent.lastActivityAt, windowMinutes, now);
  const state: SilentLaneWitnessState = hasWitness
    ? 'governed'
    : hasActivity
      ? 'recorded-ungoverned'
      : 'quiet';
  return {
    agentId: agent.agentId,
    state,
    lastActivityAt: toIso(agent.lastActivityAt),
    lastActivitySource: agent.lastActivitySource,
    lastWitnessAt: toIso(agent.lastWitnessAt),
  };
}
