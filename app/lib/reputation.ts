/**
 * Agent reputation math (SPEC-mega.md Group B). Deterministic, dependency-free
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

  // Reliability folds outcome success, approval adherence, and the inverse of
  // policy violations into one "behaved well overall" rate; completion is the
  // raw success rate. They share outcome events but differ by prior and inputs.
  const reliabilitySamples = [
    ...samples(byType.outcome),
    ...samples(byType.approval),
    ...samples(byType.policy_violation, (e) => 1 - e.value),
  ];

  const volume_weight = round4(Math.log(1 + allWeights.reduce((a, b) => a + b, 0)));

  return {
    agent_id: agentId,
    reliability_score: round4(bayesianAverage(PRIORS.reliability, reliabilitySamples)),
    completion_rate: round4(bayesianAverage(PRIORS.completion, samples(byType.outcome))),
    policy_violation_rate: round4(bayesianAverage(PRIORS.policy_violation, samples(byType.policy_violation))),
    approval_adherence: round4(bayesianAverage(PRIORS.approval, samples(byType.approval))),
    quality_score: round4(bayesianAverage(PRIORS.quality, samples(byType.quality))),
    risk_score: computeRiskScore(byType.risk),
    volume_weight,
    confidence: round4(1 - Math.exp(-0.1 * volume_weight)),
    total_events: counted,
    last_event_at: lastEventMs != null ? new Date(lastEventMs).toISOString() : null,
    computed_at: nowIso,
  };
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
