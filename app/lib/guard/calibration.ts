/**
 * Calibrated interruption controller — the pure math.
 *
 * Theory: docs/architecture/governance-core-theory.md §1. Two instruments,
 * both distribution-free:
 *
 *  1. An online adaptive-conformal threshold (Gibbs–Candès ACI form):
 *     θ_{t+1} = clamp(θ_t + γ·(ℓ_t − α)) over the stream of human-adjudicated
 *     interruptions, where ℓ_t = 1{score_t ≥ θ_t AND the human approved}
 *     (a false interruption at the calibrated threshold). The long-run
 *     average of ℓ_t converges to the operator-set target α at rate
 *     O(1/(γT)) for ANY label sequence — no distributional assumptions.
 *
 *  2. A per-agent anytime-valid e-process on the denial stream:
 *     e ← e·(1 + λ·(denied − p0)). Under H0 (the agent's true denial rate
 *     among adjudicated interruptions is ≤ p0) this is a nonnegative
 *     supermartingale, so by Ville's inequality P(e ever ≥ 1/δ) ≤ δ —
 *     the alarm's false-positive probability is controlled at EVERY
 *     stopping time, however often the operator looks.
 *
 * Charter constraint (MAINTAINER.md §1/§3): this module only ever RAISES
 * decisions (tightening). It never loosens enforcement — when the calibrated
 * threshold says the org over-interrupts, that surfaces as evidence for the
 * existing human-ratified tuning/loosening proposal rails, never as an
 * automatic downgrade. Explicit `block` decisions are never touched.
 *
 * This file is pure and synchronous (no I/O) — persistence lives in
 * app/lib/repositories/calibration-state.repository.ts, cache plumbing in
 * app/lib/guard/caches.ts, and the guard wiring in evaluate.ts.
 */

export type CalibrationMode = 'off' | 'shadow' | 'active';

export interface CalibrationSettings {
  mode: CalibrationMode;
  /** Target false-interruption rate α ∈ (0, 0.5]. */
  targetRate: number;
}

export interface CalibrationAgentEntry {
  /** Current e-value (test supermartingale wealth) for this agent. */
  e: number;
  /** Adjudications observed for this agent. */
  n: number;
  /** Denied adjudications observed for this agent. */
  denied: number;
  /** ISO timestamp when e first crossed 1/δ; sticky until a human resets it. */
  alarmed_at: string | null;
}

export interface CalibrationState {
  /** Calibrated interruption threshold θ on the 0–100 risk scale. */
  theta: number;
  /** Total adjudicated interruptions consumed. */
  labeledTotal: number;
  /** Adjudications labeled benign (human approved). */
  labeledBenign: number;
  /** Adjudications labeled dangerous (human denied). */
  labeledDenied: number;
  /** Σ ℓ_t — false interruptions at the then-current θ. */
  lossSum: number;
  /** Per-agent e-process entries, capped at AGENT_MAP_CAP. */
  agents: Record<string, CalibrationAgentEntry>;
}

export const CALIBRATION_DEFAULTS = {
  /** ACI step size γ, in risk-score units. */
  gamma: 2,
  /** Default target false-interruption rate α. */
  targetRate: 0.1,
  /** θ starting point — matches the risk_threshold policy default. */
  theta0: 80,
  /** θ floor: the controller can never tighten below this on its own. */
  thetaMin: 20,
  /**
   * θ ceiling: any value > 100 expresses "add no interruptions" (scores max
   * at 100). Chosen as 100 + γ·(1−α_min) so the UPPER projection provably
   * never binds (a loss event needs θ ≤ s ≤ 100, so the raw update tops out
   * at 100 + γ(1−α) ≤ 102) — which is what makes Theorem 1's one-sided bound
   * in governance-core-theory.md §1 exact rather than approximate.
   */
  thetaMax: 102,
  /** H0 denial rate p0 for the per-agent e-process. */
  p0: 0.25,
  /** Betting fraction λ (must be ≤ 1/p0 to keep the e-process nonnegative). */
  lambda: 2,
  /** Alarm level 1/δ — Ville: P(false alarm, ever) ≤ δ = 0.05. */
  alarmAt: 20,
  /** Bounded per-org agent map (evict the lowest-e unalarmed entry). */
  agentMapCap: 200,
} as const;

/** The settings keys the controller reads (settings table, category general). */
export const CALIBRATION_MODE_KEY = 'CALIBRATION_CONTROLLER_MODE';
export const CALIBRATION_TARGET_KEY = 'CALIBRATION_TARGET_RATE';

/** matched_policies marker for controller-raised decisions. */
export const CALIBRATION_POLICY_ID = 'builtin:calibration_controller';

const clampTheta = (theta: number): number =>
  Math.max(CALIBRATION_DEFAULTS.thetaMin, Math.min(theta, CALIBRATION_DEFAULTS.thetaMax));

export function freshCalibrationState(): CalibrationState {
  return {
    theta: CALIBRATION_DEFAULTS.theta0,
    labeledTotal: 0,
    labeledBenign: 0,
    labeledDenied: 0,
    lossSum: 0,
    agents: {},
  };
}

/** Parse the mode/target settings rows (strings from the settings table). */
export function parseCalibrationSettings(
  rows: Array<{ key?: unknown; value?: unknown }>,
): CalibrationSettings {
  const byKey = new Map(rows.map((r) => [String(r.key ?? ''), r.value]));
  const rawMode = String(byKey.get(CALIBRATION_MODE_KEY) ?? '');
  const mode: CalibrationMode = rawMode === 'shadow' || rawMode === 'active' ? rawMode : 'off';
  const rawRate = Number(byKey.get(CALIBRATION_TARGET_KEY));
  const targetRate = Number.isFinite(rawRate) && rawRate > 0 && rawRate <= 0.5
    ? rawRate
    : CALIBRATION_DEFAULTS.targetRate;
  return { mode, targetRate };
}

export type CalibrationLabel = 'benign' | 'dangerous';

export interface AdjudicationInput {
  /** The persisted risk score of the interrupted action. */
  riskScore: number;
  /** benign = human approved (the interruption was unnecessary); dangerous = denied. */
  label: CalibrationLabel;
  /** Owning agent (base or composed id); e-process key. Optional. */
  agentId?: string | null;
}

export interface AdjudicationOutcome {
  state: CalibrationState;
  /** ℓ_t for this event (false interruption at the pre-update θ). */
  loss: 0 | 1;
  thetaBefore: number;
  thetaAfter: number;
  /** True when this event pushed the agent's e-value over the alarm level. */
  alarmFired: boolean;
}

// e-process update for one agent entry. Nonnegativity: the worst factor is
// 1 − λ·p0 = 0.5 with the defaults, so e stays > 0; bounded to dodge overflow.
function eProcessStep(entry: CalibrationAgentEntry, denied: boolean, nowIso: string): { entry: CalibrationAgentEntry; alarmFired: boolean } {
  const { p0, lambda, alarmAt } = CALIBRATION_DEFAULTS;
  const d = denied ? 1 : 0;
  const factor = 1 + lambda * (d - p0);
  const e = Math.max(1e-9, Math.min(entry.e * factor, 1e9));
  const crossed = e >= alarmAt && entry.alarmed_at == null;
  return {
    entry: {
      e,
      n: entry.n + 1,
      denied: entry.denied + d,
      // Sticky: once the anytime-valid evidence threshold is crossed, only a
      // human reset clears it (the crossing itself IS the certificate).
      alarmed_at: entry.alarmed_at ?? (crossed ? nowIso : null),
    },
    alarmFired: crossed,
  };
}

// Keep the agent map bounded: evict the unalarmed entry with the least
// evidence (lowest e, ties by fewest observations). Alarmed entries are
// never evicted — an alarm must stay visible until a human clears it.
function evictIfNeeded(agents: Record<string, CalibrationAgentEntry>): Record<string, CalibrationAgentEntry> {
  const keys = Object.keys(agents);
  if (keys.length <= CALIBRATION_DEFAULTS.agentMapCap) return agents;
  let victim: string | null = null;
  let victimScore = Infinity;
  for (const k of keys) {
    const a = agents[k]!;
    if (a.alarmed_at != null) continue;
    const score = a.e + a.n / 1e6;
    if (score < victimScore) {
      victimScore = score;
      victim = k;
    }
  }
  if (victim) {
    const next = { ...agents };
    delete next[victim];
    return next;
  }
  return agents;
}

/**
 * Consume one human adjudication (pure). Applies the ACI threshold update and
 * the owning agent's e-process step, returning the new state plus the event
 * fields the caller persists to guard_calibration_events.
 */
export function applyAdjudication(
  state: CalibrationState,
  input: AdjudicationInput,
  settings: CalibrationSettings,
  nowIso: string,
): AdjudicationOutcome {
  const thetaBefore = clampTheta(state.theta);
  const score = Math.max(0, Math.min(Number(input.riskScore) || 0, 100));
  const loss: 0 | 1 = score >= thetaBefore && input.label === 'benign' ? 1 : 0;
  const thetaAfter = clampTheta(thetaBefore + CALIBRATION_DEFAULTS.gamma * (loss - settings.targetRate));

  let agents = state.agents;
  let alarmFired = false;
  const agentId = typeof input.agentId === 'string' && input.agentId ? input.agentId : null;
  if (agentId) {
    const prev = agents[agentId] ?? { e: 1, n: 0, denied: 0, alarmed_at: null };
    const step = eProcessStep(prev, input.label === 'dangerous', nowIso);
    alarmFired = step.alarmFired;
    agents = evictIfNeeded({ ...agents, [agentId]: step.entry });
  }

  return {
    state: {
      theta: thetaAfter,
      labeledTotal: state.labeledTotal + 1,
      labeledBenign: state.labeledBenign + (input.label === 'benign' ? 1 : 0),
      labeledDenied: state.labeledDenied + (input.label === 'dangerous' ? 1 : 0),
      lossSum: state.lossSum + loss,
      agents,
    },
    loss,
    thetaBefore,
    thetaAfter,
    alarmFired,
  };
}

export interface CalibrationAssessment {
  mode: CalibrationMode;
  theta: number;
  /** score ≥ θ — the calibrated controller would route this to a human. */
  would_interrupt: boolean;
  /** The owning agent has a standing (unreset) e-process alarm. */
  agent_alarmed: boolean;
  /** Active mode only: the controller actually raised this decision. */
  applied: boolean;
}

/**
 * Hot-path assessment (pure, O(1)): what the calibrated threshold and the
 * agent's alarm state say about this action. The CALLER decides whether the
 * assessment is enforced (active mode raises to require_approval via
 * raiseDecision — tighten-only by construction) or recorded (shadow mode).
 */
export function assessCalibration(
  state: CalibrationState,
  settings: CalibrationSettings,
  riskScore: number,
  agentId: string | null,
): Omit<CalibrationAssessment, 'applied'> {
  const theta = clampTheta(state.theta);
  const score = Math.max(0, Math.min(Number(riskScore) || 0, 100));
  const entry = agentId ? state.agents[agentId] : undefined;
  return {
    mode: settings.mode,
    theta,
    would_interrupt: score >= theta,
    agent_alarmed: entry?.alarmed_at != null,
  };
}

/** Rehydrate persisted state (jsonb/text row) into a well-formed CalibrationState. */
export function coerceCalibrationState(raw: unknown): CalibrationState {
  if (!raw || typeof raw !== 'object') return freshCalibrationState();
  const r = raw as Record<string, unknown>;
  const num = (v: unknown, fallback: number): number => (Number.isFinite(Number(v)) ? Number(v) : fallback);
  let agents: Record<string, CalibrationAgentEntry> = {};
  const rawAgents = r.agents;
  if (rawAgents && typeof rawAgents === 'object' && !Array.isArray(rawAgents)) {
    for (const [k, v] of Object.entries(rawAgents as Record<string, unknown>)) {
      if (!v || typeof v !== 'object') continue;
      const a = v as Record<string, unknown>;
      agents[k] = {
        e: Math.max(1e-9, num(a.e, 1)),
        n: Math.max(0, Math.round(num(a.n, 0))),
        denied: Math.max(0, Math.round(num(a.denied, 0))),
        alarmed_at: typeof a.alarmed_at === 'string' ? a.alarmed_at : null,
      };
    }
  }
  agents = evictIfNeeded(agents);
  return {
    theta: clampTheta(num(r.theta, CALIBRATION_DEFAULTS.theta0)),
    labeledTotal: Math.max(0, Math.round(num(r.labeledTotal, 0))),
    labeledBenign: Math.max(0, Math.round(num(r.labeledBenign, 0))),
    labeledDenied: Math.max(0, Math.round(num(r.labeledDenied, 0))),
    lossSum: Math.max(0, num(r.lossSum, 0)),
    agents,
  };
}
