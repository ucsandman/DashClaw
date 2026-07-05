/**
 * Agent reputation math (docs/archive/SPEC-mega.md Group B). Deterministic, dependency-free
 * except for DashClaw's existing integrity layer (canonical-json hashing +
 * Ed25519 signing via node:crypto) and the timing-safe comparator. Ported from
 * the Agent-Reputation-Oracle math (decay, Bayesian smoothing, volume,
 * confidence). Collusion and marketplace defenses are intentionally out of
 * scope for the self-sourced v1 (see docs/absorbed-projects.md section 5).
 *
 * No new crypto dependency: hashing is digestJson (canonical-json), signing is
 * the integrity layer's Ed25519 signer, verification is verifyCanonical plus a
 * constant-time compare of the vector hash.
 */

import { digestJson } from './integrity/canonicalize';
import { signCanonical, verifyCanonical } from './integrity/sign';
import { timingSafeCompare } from './timing-safe';

export const HALF_LIFE_DAYS = 90;
const DAY_MS = 86_400_000;

interface Prior {
  weight: number;
  value: number;
}

// Pseudo-count Bayesian priors: weight is the prior strength, value the default
// before any data. With zero events a dimension equals its prior value.
export const PRIORS: Record<'reliability' | 'completion' | 'policy_violation' | 'approval' | 'quality', Prior> = {
  reliability: { weight: 5, value: 0.5 },
  completion: { weight: 3, value: 0.7 },
  policy_violation: { weight: 5, value: 0.05 },
  approval: { weight: 2, value: 0.8 },
  quality: { weight: 3, value: 0.7 },
};

export const RECEIPT_VERSION = 'dashclaw-reputation/v1';

const EVENT_TYPES = ['outcome', 'policy_violation', 'approval', 'quality', 'risk'] as const;
type EventType = (typeof EVENT_TYPES)[number];

export function decayWeight(occurredAtMs: number, nowMs: number, halfLifeDays = HALF_LIFE_DAYS): number {
  const lambda = Math.LN2 / halfLifeDays;
  const deltaDays = (nowMs - occurredAtMs) / DAY_MS;
  if (!Number.isFinite(deltaDays) || deltaDays <= 0) return 1; // future / now clamps to full weight
  return Math.exp(-lambda * deltaDays);
}

interface Sample {
  w: number;
  x: number;
}

export function bayesianAverage(prior: Prior, samples: Sample[]): number {
  let num = prior.weight * prior.value;
  let den = prior.weight;
  for (const s of samples) {
    num += s.w * s.x;
    den += s.w;
  }
  return den > 0 ? num / den : prior.value;
}

function toMs(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === 'number') return value;
  if (value instanceof Date) return value.getTime();
  const t = Date.parse(value as string);
  return Number.isFinite(t) ? t : null;
}

function round4(n: unknown): number {
  return Math.round((Number(n) || 0) * 10000) / 10000;
}

interface RiskEvent {
  dw: number;
  value: number;
  ms: number;
}

function computeRiskScore(riskEvents: RiskEvent[]): number {
  if (!riskEvents.length) return 0;
  let num = 0;
  let den = 0;
  for (const e of riskEvents) { num += e.dw * e.value; den += e.dw; }
  if (den === 0) return 0;
  return Math.max(0, Math.min(100, Math.round(num / den)));
}

/** A reputation event from the flat input list. */
export interface ReputationEvent {
  event_type: EventType | string;
  value: unknown;
  occurred_at: string | number | Date | null;
  weight?: number;
}

export interface ReputationVector {
  agent_id: string;
  reliability_score: number;
  completion_rate: number;
  policy_violation_rate: number;
  approval_adherence: number;
  quality_score: number;
  risk_score: number;
  volume_weight: number;
  confidence: number;
  total_events: number;
  last_event_at: string | null;
  computed_at: string;
}

export interface ComputeVectorOpts {
  nowMs?: number | null;
  now?: string | null;
  /** Echoed into the breakdown for provenance display only. */
  lookbackDays?: number | null;
}

// Reliability composite blend weights. Replaces the old flat sample pooling,
// where every non-block guard decision contributed a full-weight 1.0 sample —
// at fleet guard volume that drowned the rare negatives and pegged every agent
// at >= 0.995 ("always 100%"). Per-dimension Bayesian rates stay as-is; the
// composite is a weighted blend renormalized over dimensions that actually
// have evidence (so a quality-less agent isn't propped up by the 0.7 prior).
export const RELIABILITY_BLEND_WEIGHTS = {
  completion: 0.45,
  approval: 0.20,
  policy_violation: 0.25,
  quality: 0.10,
} as const;

// A violation rate at/above this maps to full penalty (blend score 0): 3
// blocks in 5,000 guard calls still costs visible points instead of drowning.
export const VIOLATION_PENALTY_CEILING_RATE = 0.10;

interface BreakdownDimension {
  key: EventType;
  event_count: number;
  /** Sum of post-decay sample weights. */
  effective_weight: number;
  /** Unsmoothed decay-weighted mean (null with zero events). */
  raw_rate: number | null;
  prior: Prior;
  /** Bayesian-smoothed rate (the vector's published per-dimension value). */
  smoothed: number;
  /** The value this dimension feeds into the reliability blend (null = not blended). */
  blend_score: number | null;
  /** normalized blend weight × blend_score (null when not in the blend). */
  contribution: number | null;
}

export interface ReputationBreakdown {
  formula: 'weighted_blend/v1';
  half_life_days: number;
  lookback_days: number | null;
  composite_weights: Record<string, number>;
  /** Weights after renormalizing over evidence-bearing dimensions. */
  normalized_weights: Record<string, number>;
  violation_penalty: { rate: number; ceiling_rate: number; penalty: number };
  reliability_unrounded: number;
  dimensions: BreakdownDimension[];
  /** The two scores are independent — stated to preempt the obvious question. */
  note: string;
}

/**
 * Compute the reputation vector from a flat list of events.
 * Each event: { event_type, value, occurred_at (ISO|ms|Date), weight? }.
 * value is in [0,1] for the Bayesian dimensions; for 'risk' it is 0-100.
 */
export function computeVector(
  agentId: string,
  events: ReputationEvent[] | null | undefined,
  opts: ComputeVectorOpts = {},
): ReputationVector {
  return computeVectorWithBreakdown(agentId, events, opts).vector;
}

/**
 * Same computation, plus the provenance breakdown as a SIBLING object. The
 * breakdown must never enter the signed/hashed vector (hashVector + receipts
 * sign the canonical vector; stored receipts must keep verifying), so callers
 * persist/expose it beside the vector, never inside it.
 */
export function computeVectorWithBreakdown(
  agentId: string,
  events: ReputationEvent[] | null | undefined,
  opts: ComputeVectorOpts = {},
): { vector: ReputationVector; breakdown: ReputationBreakdown } {
  const nowMs = opts.nowMs != null ? opts.nowMs : (opts.now ? Date.parse(opts.now) : Date.now());
  const nowIso = opts.now || new Date(nowMs).toISOString();

  interface TypedEvent { dw: number; value: number; ms: number; }
  const byType: Record<EventType, TypedEvent[]> = { outcome: [], policy_violation: [], approval: [], quality: [], risk: [] };
  let lastEventMs: number | null = null;
  const allWeights: number[] = [];
  let counted = 0;

  for (const ev of events || []) {
    if (!ev || !EVENT_TYPES.includes(ev.event_type as EventType)) continue;
    const ms = toMs(ev.occurred_at);
    if (ms == null) continue;
    const dw = decayWeight(ms, nowMs) * (Number.isFinite(ev.weight) ? (ev.weight as number) : 1);
    byType[ev.event_type as EventType].push({ dw, value: Number(ev.value) || 0, ms });
    allWeights.push(dw);
    counted += 1;
    if (lastEventMs == null || ms > lastEventMs) lastEventMs = ms;
  }

  const samples = (arr: TypedEvent[], map: (e: TypedEvent) => number = (e) => e.value): Sample[] =>
    arr.map((e) => ({ w: e.dw, x: map(e) }));

  const completion_rate = bayesianAverage(PRIORS.completion, samples(byType.outcome));
  const policy_violation_rate = bayesianAverage(PRIORS.policy_violation, samples(byType.policy_violation));
  const approval_adherence = bayesianAverage(PRIORS.approval, samples(byType.approval));
  const quality_score = bayesianAverage(PRIORS.quality, samples(byType.quality));

  // Reliability = weighted blend of the per-dimension Bayesian rates. The
  // violation dimension enters as (1 - penalty), where the penalty scales the
  // (rare) block rate against VIOLATION_PENALTY_CEILING_RATE.
  const violationPenalty = Math.min(1, policy_violation_rate / VIOLATION_PENALTY_CEILING_RATE);
  const blendDims: Array<{ key: EventType; weight: number; score: number; has: boolean }> = [
    { key: 'outcome', weight: RELIABILITY_BLEND_WEIGHTS.completion, score: completion_rate, has: byType.outcome.length > 0 },
    { key: 'approval', weight: RELIABILITY_BLEND_WEIGHTS.approval, score: approval_adherence, has: byType.approval.length > 0 },
    { key: 'policy_violation', weight: RELIABILITY_BLEND_WEIGHTS.policy_violation, score: 1 - violationPenalty, has: byType.policy_violation.length > 0 },
    { key: 'quality', weight: RELIABILITY_BLEND_WEIGHTS.quality, score: quality_score, has: byType.quality.length > 0 },
  ];
  const active = blendDims.filter((d) => d.has);
  const activeWeightSum = active.reduce((s, d) => s + d.weight, 0);
  // Zero evidence anywhere -> the reliability prior (0.5), preserving the
  // prior-only invariant the receipt tests pin.
  const reliabilityUnrounded = active.length === 0
    ? PRIORS.reliability.value
    : active.reduce((s, d) => s + (d.weight / activeWeightSum) * d.score, 0);

  const volume_weight = round4(Math.log(1 + allWeights.reduce((a, b) => a + b, 0)));

  const vector: ReputationVector = {
    agent_id: agentId,
    reliability_score: round4(reliabilityUnrounded),
    completion_rate: round4(completion_rate),
    policy_violation_rate: round4(policy_violation_rate),
    approval_adherence: round4(approval_adherence),
    quality_score: round4(quality_score),
    risk_score: computeRiskScore(byType.risk),
    volume_weight,
    confidence: round4(1 - Math.exp(-0.1 * volume_weight)),
    total_events: counted,
    last_event_at: lastEventMs != null ? new Date(lastEventMs).toISOString() : null,
    computed_at: nowIso,
  };

  const rawRate = (arr: TypedEvent[], map: (e: TypedEvent) => number = (e) => e.value): number | null => {
    if (!arr.length) return null;
    let num = 0; let den = 0;
    for (const e of arr) { num += e.dw * map(e); den += e.dw; }
    return den > 0 ? round4(num / den) : null;
  };
  const effWeight = (arr: TypedEvent[]): number => round4(arr.reduce((s, e) => s + e.dw, 0));
  const normalizedWeights: Record<string, number> = {};
  for (const d of active) normalizedWeights[d.key] = round4(d.weight / activeWeightSum);
  const blendByKey = new Map(blendDims.map((d) => [d.key, d]));
  const dimension = (key: EventType, prior: Prior, smoothed: number): BreakdownDimension => {
    const blend = blendByKey.get(key);
    const inBlend = !!blend && blend.has;
    return {
      key,
      event_count: byType[key].length,
      effective_weight: effWeight(byType[key]),
      raw_rate: rawRate(byType[key]),
      prior,
      smoothed: round4(smoothed),
      blend_score: inBlend ? round4(blend.score) : null,
      contribution: inBlend ? round4((normalizedWeights[key] ?? 0) * blend.score) : null,
    };
  };

  const breakdown: ReputationBreakdown = {
    formula: 'weighted_blend/v1',
    half_life_days: HALF_LIFE_DAYS,
    lookback_days: opts.lookbackDays ?? null,
    composite_weights: { ...RELIABILITY_BLEND_WEIGHTS },
    normalized_weights: normalizedWeights,
    violation_penalty: {
      rate: round4(policy_violation_rate),
      ceiling_rate: VIOLATION_PENALTY_CEILING_RATE,
      penalty: round4(violationPenalty),
    },
    reliability_unrounded: reliabilityUnrounded,
    dimensions: [
      dimension('outcome', PRIORS.completion, completion_rate),
      dimension('approval', PRIORS.approval, approval_adherence),
      dimension('policy_violation', PRIORS.policy_violation, policy_violation_rate),
      dimension('quality', PRIORS.quality, quality_score),
      // Risk is shown for completeness but never enters the reliability blend.
      dimension('risk', { weight: 0, value: 0 }, vector.risk_score),
    ],
    note: 'Risk is tracked separately (decay-weighted mean of per-action risk scores) and is not folded into reliability.',
  };

  return { vector, breakdown };
}

export function hashVector(vector: ReputationVector): string {
  return digestJson(vector);
}

export interface ReputationReceipt {
  version: string;
  issuedAt: string;
  agentId: string;
  vectorHash: string;
  totalEvents: number;
  vector: ReputationVector;
  signature: unknown;
}

/**
 * Build a signed reputation receipt. The signature binds the vector hash,
 * agent, issuer-asserted time, and event count; the receipt also embeds the
 * full vector for the verifier. issuedAt is issuer-asserted, not a trusted
 * timestamp (same caveat as the integrity receipt/bundle envelopes).
 */
export function buildReputationReceipt(
  vector: ReputationVector,
  key: unknown,
  issuedAt: string,
): ReputationReceipt {
  const base = {
    version: RECEIPT_VERSION,
    issuedAt,
    agentId: vector.agent_id,
    vectorHash: hashVector(vector),
    totalEvents: vector.total_events,
  };
  const signature = signCanonical(base, key as Parameters<typeof signCanonical>[1]);
  return { ...base, vector, signature };
}

export type VerifyReceiptResult =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Verify a reputation receipt: the embedded vector must hash to the signed
 * vectorHash (constant-time compare), and the signature must verify against the
 * public JWK.
 */
export function verifyReputationReceipt(
  receipt: unknown,
  publicKeyJwk: unknown,
): VerifyReceiptResult {
  if (!receipt || typeof receipt !== 'object' || !(receipt as ReputationReceipt).signature || !(receipt as ReputationReceipt).vector) {
    return { ok: false, reason: 'malformed' };
  }
  const r = receipt as ReputationReceipt;
  const recomputed = hashVector(r.vector);
  if (!timingSafeCompare(recomputed, String(r.vectorHash || ''))) {
    return { ok: false, reason: 'vector_hash_mismatch' };
  }
  const { vector, signature, ...base } = r;
  void vector;
  const ok = verifyCanonical(base, signature as Parameters<typeof verifyCanonical>[1], publicKeyJwk as Parameters<typeof verifyCanonical>[2]);
  return ok ? { ok: true } : { ok: false, reason: 'bad_signature' };
}
