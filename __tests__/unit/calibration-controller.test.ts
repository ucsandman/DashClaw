/**
 * Calibrated interruption controller — pure-math guarantees, demonstrated
 * empirically (docs/architecture/governance-core-theory.md §1):
 *
 *  1. ACI error control: the long-run false-interruption rate over the
 *     LABELED (adjudicated) stream converges to the operator target α —
 *     held on a golden-vector-seeded stream AND under induced drift.
 *  2. E-process alarms: false-alarm probability ≤ δ at every stopping time
 *     under H0 (Ville), and fast detection under a real shift.
 *  3. Selective labeling is handled, not assumed: only adjudicated events
 *     update state; expired approvals produce no update by construction.
 *  4. Structural invariants: θ clamped to [floor, ceiling], alarm stickiness,
 *     bounded agent map, robust state rehydration.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  applyAdjudication,
  assessCalibration,
  coerceCalibrationState,
  freshCalibrationState,
  parseCalibrationSettings,
  CALIBRATION_DEFAULTS,
} from '@/lib/guard/calibration';
import type { CalibrationState, CalibrationSettings, CalibrationLabel } from '@/lib/guard/calibration';
import { computeRiskScore } from '@/lib/guard.js';

// Deterministic PRNG (mulberry32) — no Math.random in tests.
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SETTINGS: CalibrationSettings = { mode: 'active', targetRate: 0.1 };
const NOW = '2026-07-06T00:00:00.000Z';

interface StreamEvent { score: number; label: CalibrationLabel }

/**
 * Run the controller over a candidate-action stream in ACTIVE mode: an event
 * is adjudicated (labeled) ONLY when the controller interrupts it (score ≥ θ)
 * — the selective-labeling feedback loop, modeled rather than assumed.
 * Returns the labeled-subsequence loss rate (false interruptions / labels).
 */
function runActiveLoop(state: CalibrationState, stream: StreamEvent[], settings: CalibrationSettings) {
  let labeled = 0;
  let losses = 0;
  const lossTrail: number[] = [];
  for (const ev of stream) {
    if (ev.score < state.theta) continue; // not interrupted → no human verdict → no label
    const out = applyAdjudication(state, { riskScore: ev.score, label: ev.label }, settings, NOW);
    state = out.state;
    labeled += 1;
    losses += out.loss;
    lossTrail.push(out.loss);
  }
  return { state, labeled, losses, rate: labeled > 0 ? losses / labeled : 0, lossTrail };
}

// Golden-vector seeding: real server-scored contexts from the calibration
// corpus, labeled by the corpus's benign/risky verdicts.
function goldenSeeds(): StreamEvent[] {
  const fixture = JSON.parse(
    readFileSync(resolve(__dirname, '../fixtures/risk-calibration-golden-vectors.json'), 'utf8'),
  ) as { vectors: Array<{ label: string; server_context?: Record<string, unknown> }> };
  const seeds: StreamEvent[] = [];
  for (const v of fixture.vectors) {
    if (!v.server_context) continue;
    seeds.push({
      score: computeRiskScore(v.server_context),
      label: v.label === 'risky' ? 'dangerous' : 'benign',
    });
  }
  return seeds;
}

describe('ACI error control (empirical, golden-vector-seeded)', () => {
  it('holds the labeled false-interruption rate near the target α on a stationary stream', () => {
    const random = rng(42);
    const seeds = goldenSeeds();
    expect(seeds.length).toBeGreaterThan(5);
    // Stationary stream: draw golden seeds with score jitter so the score
    // distribution is continuous around the corpus's real anchor points.
    const stream: StreamEvent[] = Array.from({ length: 4000 }, () => {
      const s = seeds[Math.floor(random() * seeds.length)]!;
      return { score: Math.max(0, Math.min(100, s.score + (random() - 0.5) * 30)), label: s.label };
    });
    const { rate, labeled } = runActiveLoop(freshCalibrationState(), stream, SETTINGS);
    expect(labeled).toBeGreaterThan(200);
    // ACI bound: |avg loss − α| ≤ (θ range + γ)/(γT) plus stochastic noise;
    // with T > 200 the deterministic term is ≤ ~0.2, and empirically the
    // realized rate sits well inside α ± α/2.
    expect(rate).toBeGreaterThan(SETTINGS.targetRate * 0.5);
    expect(rate).toBeLessThan(SETTINGS.targetRate * 1.5);
  });

  it('holds the target under induced drift (agent behavior shifts mid-stream)', () => {
    const random = rng(7);
    const seeds = goldenSeeds();
    const stream: StreamEvent[] = Array.from({ length: 6000 }, (_, i) => {
      const s = seeds[Math.floor(random() * seeds.length)]!;
      // Drift: after the midpoint every score shifts +18 (benign work starts
      // LOOKING riskier — the classic post-deploy behavior change).
      const drift = i >= 3000 ? 18 : 0;
      return { score: Math.max(0, Math.min(100, s.score + drift + (random() - 0.5) * 30)), label: s.label };
    });

    // Measure the SECOND half separately: the target must be re-attained
    // after the shift, not just amortized away by the calm first half.
    const firstHalf = stream.slice(0, 3000);
    const secondHalf = stream.slice(3000);
    const afterFirst = runActiveLoop(freshCalibrationState(), firstHalf, SETTINGS);
    const afterDrift = runActiveLoop(afterFirst.state, secondHalf, SETTINGS);
    expect(afterDrift.labeled).toBeGreaterThan(200);
    expect(afterDrift.rate).toBeGreaterThan(SETTINGS.targetRate * 0.4);
    expect(afterDrift.rate).toBeLessThan(SETTINGS.targetRate * 1.6);
  });

  it('tightens (θ falls) on a denial-heavy stream — the automated direction', () => {
    let state = freshCalibrationState();
    // Humans keep DENYING interruptions just above θ: dangerous actions are
    // being caught, so vigilance is cheap — θ walks DOWN (tighten), which the
    // charter allows automatically.
    for (let i = 0; i < 50; i++) {
      state = applyAdjudication(state, { riskScore: 85, label: 'dangerous' }, SETTINGS, NOW).state;
    }
    expect(state.theta).toBeLessThan(CALIBRATION_DEFAULTS.theta0);
  });

  it('loosens θ only in the estimate (benign-heavy stream) — enforcement loosening stays human', () => {
    let state = freshCalibrationState();
    for (let i = 0; i < 50; i++) {
      state = applyAdjudication(state, { riskScore: 85, label: 'benign' }, SETTINGS, NOW).state;
    }
    // The ESTIMATE rises above the policy default: that is the loosening
    // evidence surfaced for human ratification (tuning proposals), never an
    // automatic enforcement change — assessCalibration still only informs.
    expect(state.theta).toBeGreaterThan(CALIBRATION_DEFAULTS.theta0);
  });

  it('θ stays inside [floor, ceiling] under adversarial streams', () => {
    let state = freshCalibrationState();
    for (let i = 0; i < 500; i++) {
      state = applyAdjudication(state, { riskScore: 100, label: 'dangerous' }, SETTINGS, NOW).state;
    }
    expect(state.theta).toBeGreaterThanOrEqual(CALIBRATION_DEFAULTS.thetaMin);
    for (let i = 0; i < 500; i++) {
      state = applyAdjudication(state, { riskScore: 100, label: 'benign' }, SETTINGS, NOW).state;
    }
    expect(state.theta).toBeLessThanOrEqual(CALIBRATION_DEFAULTS.thetaMax);
  });
});

describe('selective labeling is modeled, not assumed', () => {
  it('unadjudicated (expired / never-interrupted) events change nothing', () => {
    const state = freshCalibrationState();
    // The ONLY mutation path is applyAdjudication; an expired approval never
    // reaches it (calibration-feedback.ts is invoked exclusively from the
    // approve/deny resolution paths). The pure invariant: no call, no change.
    const stream: StreamEvent[] = Array.from({ length: 100 }, (_, i) => ({
      score: 10 + (i % 30), // all below θ0=80 → never interrupted → never labeled
      label: 'benign',
    }));
    const out = runActiveLoop(state, stream, SETTINGS);
    expect(out.labeled).toBe(0);
    expect(out.state).toEqual(state);
  });

  it('when every attainable threshold over-interrupts, the controller withdraws (θ → ceiling)', () => {
    const random = rng(99);
    // 85% of high-scoring actions are benign — far above the α=0.1 budget at
    // EVERY threshold. The only calibrated fixed point is to stop adding
    // interruptions: θ walks to the ceiling and the labeled stream dries up.
    // This is the honest shape of the guarantee under selective labeling —
    // α is achieved by withdrawal, and (crucially) the withdrawal is only an
    // ESTIMATE moving; enforcement loosening still routes through the human
    // tuning/loosening rails.
    const stream: StreamEvent[] = Array.from({ length: 4000 }, () => {
      const labeledSide = random() < 0.5;
      return labeledSide
        ? { score: 80 + random() * 20, label: (random() < 0.85 ? 'benign' : 'dangerous') as CalibrationLabel }
        : { score: random() * 30, label: 'benign' as CalibrationLabel };
    });
    const out = runActiveLoop(freshCalibrationState(), stream, SETTINGS);
    expect(out.state.theta).toBeGreaterThan(95);
    // Late-stream interruptions are rare: the last quarter of the stream
    // contributes almost none of the labels.
    expect(out.labeled).toBeLessThan(200);
  });
});

describe('e-process alarms (anytime-valid)', () => {
  it('controls the false-alarm rate at δ under H0 across seeds and all stopping times', () => {
    const { p0 } = CALIBRATION_DEFAULTS;
    const SEEDS = 300;
    let alarmed = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
      const random = rng(seed * 1013);
      let state = freshCalibrationState();
      for (let t = 0; t < 300; t++) {
        const label: CalibrationLabel = random() < p0 ? 'dangerous' : 'benign';
        state = applyAdjudication(state, { riskScore: 90, label, agentId: 'agent_h0' }, SETTINGS, NOW).state;
      }
      if (state.agents['agent_h0']?.alarmed_at != null) alarmed += 1;
    }
    // Ville: P(sup e ≥ 20) ≤ 0.05 under H0 — allow generous Monte Carlo slack.
    expect(alarmed / SEEDS).toBeLessThanOrEqual(0.09);
  });

  it('fires fast when an agent actually goes bad (denial rate 0.8)', () => {
    const random = rng(1234);
    let state = freshCalibrationState();
    let firedAt: number | null = null;
    for (let t = 1; t <= 60; t++) {
      const label: CalibrationLabel = random() < 0.8 ? 'dangerous' : 'benign';
      state = applyAdjudication(state, { riskScore: 90, label, agentId: 'agent_bad' }, SETTINGS, NOW).state;
      if (firedAt == null && state.agents['agent_bad']?.alarmed_at != null) firedAt = t;
    }
    expect(firedAt).not.toBeNull();
    expect(firedAt!).toBeLessThanOrEqual(30);
  });

  it('alarms are sticky: e falling back below the level does not clear alarmed_at', () => {
    let state = freshCalibrationState();
    for (let i = 0; i < 10; i++) {
      state = applyAdjudication(state, { riskScore: 90, label: 'dangerous', agentId: 'a' }, SETTINGS, NOW).state;
    }
    expect(state.agents['a']?.alarmed_at).not.toBeNull();
    for (let i = 0; i < 50; i++) {
      state = applyAdjudication(state, { riskScore: 90, label: 'benign', agentId: 'a' }, SETTINGS, NOW).state;
    }
    expect(state.agents['a']?.e).toBeLessThan(CALIBRATION_DEFAULTS.alarmAt);
    expect(state.agents['a']?.alarmed_at).not.toBeNull();
  });

  it('bounds the per-org agent map and never evicts an alarmed agent', () => {
    let state = freshCalibrationState();
    for (let i = 0; i < 10; i++) {
      state = applyAdjudication(state, { riskScore: 90, label: 'dangerous', agentId: 'alarmed_agent' }, SETTINGS, NOW).state;
    }
    for (let i = 0; i < CALIBRATION_DEFAULTS.agentMapCap + 50; i++) {
      state = applyAdjudication(state, { riskScore: 90, label: 'benign', agentId: `agent_${i}` }, SETTINGS, NOW).state;
    }
    expect(Object.keys(state.agents).length).toBeLessThanOrEqual(CALIBRATION_DEFAULTS.agentMapCap);
    expect(state.agents['alarmed_agent']?.alarmed_at).not.toBeNull();
  });
});

describe('assessment + plumbing helpers', () => {
  it('assessCalibration is a pure threshold/alarm read', () => {
    const state = freshCalibrationState();
    state.theta = 40;
    state.agents['a_bad'] = { e: 25, n: 10, denied: 8, alarmed_at: NOW };
    expect(assessCalibration(state, SETTINGS, 55, null)).toMatchObject({ would_interrupt: true, agent_alarmed: false, theta: 40 });
    expect(assessCalibration(state, SETTINGS, 30, 'a_bad')).toMatchObject({ would_interrupt: false, agent_alarmed: true });
    expect(assessCalibration(state, SETTINGS, 30, 'a_other')).toMatchObject({ would_interrupt: false, agent_alarmed: false });
  });

  it('parseCalibrationSettings: defaults off, validates mode and rate', () => {
    expect(parseCalibrationSettings([])).toEqual({ mode: 'off', targetRate: CALIBRATION_DEFAULTS.targetRate });
    expect(parseCalibrationSettings([
      { key: 'CALIBRATION_CONTROLLER_MODE', value: 'shadow' },
      { key: 'CALIBRATION_TARGET_RATE', value: '0.05' },
    ])).toEqual({ mode: 'shadow', targetRate: 0.05 });
    expect(parseCalibrationSettings([
      { key: 'CALIBRATION_CONTROLLER_MODE', value: 'bogus' },
      { key: 'CALIBRATION_TARGET_RATE', value: '7' },
    ])).toEqual({ mode: 'off', targetRate: CALIBRATION_DEFAULTS.targetRate });
  });

  it('coerceCalibrationState survives garbage and clamps', () => {
    expect(coerceCalibrationState(null)).toEqual(freshCalibrationState());
    expect(coerceCalibrationState('nonsense')).toEqual(freshCalibrationState());
    const coerced = coerceCalibrationState({ theta: 500, labeledTotal: -3, agents: { a: { e: 'x', n: 2 }, b: 7 } });
    expect(coerced.theta).toBe(CALIBRATION_DEFAULTS.thetaMax);
    expect(coerced.labeledTotal).toBe(0);
    expect(coerced.agents['a']).toEqual({ e: 1, n: 2, denied: 0, alarmed_at: null });
    expect(coerced.agents['b']).toBeUndefined();
  });
});
