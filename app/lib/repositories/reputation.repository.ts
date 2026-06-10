/**
 * Reputation repository (SPEC-mega.md Group B). All SQL for the reputation
 * tables plus evidence sourcing and the recompute orchestrator. Every query is
 * org-scoped (WHERE org_id = ${orgId}); there is no cross-org access. The
 * vector math and receipt signing live in app/lib/reputation.js.
 */

import crypto from 'node:crypto';
import { computeVectorWithBreakdown, buildReputationReceipt, hashVector } from '../reputation';
import type { ReputationVector as CanonicalReputationVector, ReputationBreakdown } from '../reputation';
import { getServerSigningKey } from '../integrity/server-key';

type SqlClient = {
  (s: TemplateStringsArray, ...v: unknown[]): Promise<Record<string, unknown>[]>;
  query: (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
};

interface ReputationVector {
  agent_id?: string;
  reliability_score: number | null;
  completion_rate: number | null;
  policy_violation_rate: number | null;
  approval_adherence: number | null;
  quality_score: number | null;
  risk_score: number | null;
  volume_weight: number | null;
  confidence: number | null;
  total_events: number;
  last_event_at: string | null;
  computed_at: string;
  [k: string]: unknown;
}

interface EvidenceEvent {
  id: string;
  event_type: string;
  value: number;
  occurred_at: string;
  action_id?: string | null;
}

const DEFAULT_LOOKBACK_DAYS = 365;

function genId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

// ---- reputation tables CRUD -------------------------------------------------

export async function listReputationEvents(
  sql: SqlClient,
  orgId: string,
  agentId: string,
  { limit = 50, offset = 0 }: { limit?: number; offset?: number } = {}
): Promise<Record<string, unknown>[]> {
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const off = Math.max(Number(offset) || 0, 0);
  return sql`
    SELECT id, agent_id, source_agent_id, event_type, weight, value, action_id, occurred_at, metadata, created_at
    FROM agent_reputation_events
    WHERE org_id = ${orgId} AND agent_id = ${agentId}
    ORDER BY occurred_at DESC
    LIMIT ${lim} OFFSET ${off}`;
}

export async function getReputationSnapshot(
  sql: SqlClient,
  orgId: string,
  agentId: string
): Promise<Record<string, unknown> | null> {
  const rows = await sql`
    SELECT * FROM agent_reputation_snapshots
    WHERE org_id = ${orgId} AND agent_id = ${agentId}
    LIMIT 1`;
  return rows[0] ?? null;
}

export async function listReputationSnapshots(
  sql: SqlClient,
  orgId: string,
  { limit = 20 }: { limit?: number } = {}
): Promise<Record<string, unknown>[]> {
  const lim = Math.min(Math.max(Number(limit) || 20, 1), 100);
  return sql`
    SELECT * FROM agent_reputation_snapshots
    WHERE org_id = ${orgId}
    ORDER BY reliability_score DESC NULLS LAST, total_events DESC
    LIMIT ${lim}`;
}

export async function upsertReputationSnapshot(
  sql: SqlClient,
  orgId: string,
  agentId: string,
  vector: ReputationVector,
  // Provenance sibling — persisted beside the vector columns, NEVER hashed
  // (vector_hash signs the canonical vector only; receipts must keep verifying).
  breakdown: ReputationBreakdown | null = null
): Promise<Record<string, unknown> | null> {
  const id = genId('ars');
  // The local ReputationVector models nullable DB-snapshot columns; the canonical
  // hashVector takes the non-null computed vector. Same shape at runtime.
  const vectorHash = hashVector(vector as unknown as CanonicalReputationVector);
  const rows = await sql`
    INSERT INTO agent_reputation_snapshots
      (id, org_id, agent_id, reliability_score, completion_rate, policy_violation_rate, approval_adherence,
       quality_score, risk_score, volume_weight, confidence, total_events, last_event_at, computed_at, vector_hash, breakdown)
    VALUES
      (${id}, ${orgId}, ${agentId}, ${vector.reliability_score}, ${vector.completion_rate}, ${vector.policy_violation_rate}, ${vector.approval_adherence},
       ${vector.quality_score}, ${vector.risk_score}, ${vector.volume_weight}, ${vector.confidence}, ${vector.total_events}, ${vector.last_event_at}, ${vector.computed_at}, ${vectorHash}, ${breakdown ? JSON.stringify(breakdown) : null})
    ON CONFLICT (org_id, agent_id) DO UPDATE SET
      reliability_score = EXCLUDED.reliability_score,
      completion_rate = EXCLUDED.completion_rate,
      policy_violation_rate = EXCLUDED.policy_violation_rate,
      approval_adherence = EXCLUDED.approval_adherence,
      quality_score = EXCLUDED.quality_score,
      risk_score = EXCLUDED.risk_score,
      volume_weight = EXCLUDED.volume_weight,
      confidence = EXCLUDED.confidence,
      total_events = EXCLUDED.total_events,
      last_event_at = EXCLUDED.last_event_at,
      computed_at = EXCLUDED.computed_at,
      vector_hash = EXCLUDED.vector_hash,
      breakdown = EXCLUDED.breakdown
    RETURNING *`;
  return rows[0] ?? null;
}

interface ReputationReceiptInput {
  receipt: { vectorHash: string; [k: string]: unknown };
  kid: string;
  issuedAt: string;
}

export async function insertReputationReceipt(
  sql: SqlClient,
  orgId: string,
  agentId: string,
  { receipt, kid, issuedAt }: ReputationReceiptInput
): Promise<Record<string, unknown> | null> {
  const id = genId('arr');
  const rows = await sql`
    INSERT INTO agent_reputation_receipts (id, org_id, agent_id, vector_hash, receipt, kid, issued_at)
    VALUES (${id}, ${orgId}, ${agentId}, ${receipt.vectorHash}, ${JSON.stringify(receipt)}::jsonb, ${kid}, ${issuedAt})
    RETURNING id, org_id, agent_id, vector_hash, kid, issued_at, created_at`;
  return rows[0] ?? null;
}

export async function getLatestReputationReceipt(
  sql: SqlClient,
  orgId: string,
  agentId: string
): Promise<unknown> {
  const rows = await sql`
    SELECT receipt FROM agent_reputation_receipts
    WHERE org_id = ${orgId} AND agent_id = ${agentId}
    ORDER BY created_at DESC
    LIMIT 1`;
  return rows[0]?.receipt ?? null;
}

// ---- evidence sourcing (B4) -------------------------------------------------

function terminalOutcome(outcomeStatus: unknown, status: unknown): number | null {
  if (outcomeStatus === 'completed') return 1;
  if (outcomeStatus === 'failed') return 0;
  if (outcomeStatus === 'partial') return 0.5;
  // Durable-execution sweep verdict: the platform lost confirmation that the
  // action finished. Counts as a failure — previously these silently vanished
  // (no outcome event), which biased reliability upward.
  if (outcomeStatus === 'lost_confirmation') return 0;
  if (outcomeStatus === 'pending' || outcomeStatus == null) {
    if (status === 'completed') return 1;
    if (status === 'failed' || status === 'cancelled' || status === 'blocked') return 0;
  }
  return null; // running / non-terminal -> no outcome event
}

/**
 * Derive reputation events for an agent from the straightforward evidence:
 * action_records (outcome, risk, approval), guard_decisions (policy violations),
 * eval_scores + feedback (quality). Architected so drift / learning / scoring
 * sources can be added behind the same interface later. Each event carries a
 * deterministic id so persistence is idempotent across recomputes.
 */
export async function gatherEvidenceEvents(
  sql: SqlClient,
  orgId: string,
  agentId: string,
  { sinceDays = DEFAULT_LOOKBACK_DAYS }: { sinceDays?: number } = {}
): Promise<EvidenceEvent[]> {
  const events: EvidenceEvent[] = [];

  const actions = await sql`
    SELECT action_id, status, outcome_status, risk_score, approved_by, error_message, created_at
    FROM action_records
    WHERE org_id = ${orgId} AND agent_id = ${agentId}
      AND created_at > NOW() - (${String(sinceDays)} || ' days')::interval`;
  for (const a of actions) {
    const occurred_at = a.created_at as string;
    const outcome = terminalOutcome(a.outcome_status, a.status);
    if (outcome !== null) events.push({ id: `are_o_${a.action_id}`, event_type: 'outcome', value: outcome, occurred_at, action_id: a.action_id as string });
    if (a.risk_score != null) events.push({ id: `are_r_${a.action_id}`, event_type: 'risk', value: Number(a.risk_score) || 0, occurred_at, action_id: a.action_id as string });
    if (a.approved_by) events.push({ id: `are_a_${a.action_id}`, event_type: 'approval', value: 1, occurred_at, action_id: a.action_id as string });
    else if (a.error_message && /denied by human/i.test(a.error_message as string)) events.push({ id: `are_a_${a.action_id}`, event_type: 'approval', value: 0, occurred_at, action_id: a.action_id as string });
  }

  const guard = await sql`
    SELECT id, decision, created_at FROM guard_decisions
    WHERE org_id = ${orgId} AND agent_id = ${agentId}
      AND created_at > NOW() - (${String(sinceDays)} || ' days')::interval`;
  for (const g of guard) {
    events.push({ id: `are_g_${g.id}`, event_type: 'policy_violation', value: g.decision === 'block' ? 1 : 0, occurred_at: g.created_at as string });
  }

  // eval_scores.created_at is TEXT (declared text since the 0000 migration; the
  // app writes ISO strings), unlike the other evidence tables' timestamptz
  // created_at — cast before comparing to the interval or Postgres raises
  // "operator does not exist: text > timestamp with time zone".
  const evals = await sql`
    SELECT es.id, es.score, es.created_at
    FROM eval_scores es
    JOIN action_records ar ON ar.action_id = es.action_id AND ar.org_id = es.org_id
    WHERE es.org_id = ${orgId} AND ar.agent_id = ${agentId}
      AND es.created_at::timestamptz > NOW() - (${String(sinceDays)} || ' days')::interval`;
  for (const e of evals) {
    const v = Number(e.score);
    if (Number.isFinite(v)) events.push({ id: `are_q_${e.id}`, event_type: 'quality', value: Math.max(0, Math.min(1, v)), occurred_at: e.created_at as string });
  }

  const feedback = await sql`
    SELECT id, rating, created_at FROM feedback
    WHERE org_id = ${orgId} AND agent_id = ${agentId} AND rating IS NOT NULL
      AND created_at > NOW() - (${String(sinceDays)} || ' days')::interval`;
  for (const f of feedback) {
    const r = Number(f.rating);
    if (Number.isFinite(r)) events.push({ id: `are_f_${f.id}`, event_type: 'quality', value: Math.max(0, Math.min(1, r / 5)), occurred_at: f.created_at as string });
  }

  return events;
}

// Persist a bounded, most-recent slice of derived events for the timeline
// drill-down. The vector itself is computed from the FULL event set in memory
// (computeVector), so accuracy is unaffected — this only bounds what gets stored
// for the paginated /events view. Critically, this uses ONE multi-row INSERT per
// chunk instead of one HTTP round-trip per event: a high-volume agent can derive
// 150k+ evidence events, and per-row inserts over the Neon HTTP driver would hang
// recompute for the entire request.
const PERSIST_MAX = 2000;
const PERSIST_CHUNK = 500;
async function persistEvents(
  sql: SqlClient,
  orgId: string,
  agentId: string,
  events: EvidenceEvent[]
): Promise<void> {
  if (!events.length) return;
  const recent = events
    .slice()
    .sort((a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime())
    .slice(0, PERSIST_MAX);
  for (let i = 0; i < recent.length; i += PERSIST_CHUNK) {
    const batch = recent.slice(i, i + PERSIST_CHUNK);
    const placeholders: string[] = [];
    const params: unknown[] = [];
    batch.forEach((ev, j) => {
      const b = j * 7;
      placeholders.push(`($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7})`);
      params.push(ev.id, orgId, agentId, ev.event_type, ev.value, ev.action_id || null, ev.occurred_at);
    });
    await sql.query(
      `INSERT INTO agent_reputation_events (id, org_id, agent_id, event_type, value, action_id, occurred_at)
       VALUES ${placeholders.join(', ')}
       ON CONFLICT (id) DO NOTHING`,
      params
    );
  }
}

// ---- recompute orchestrator -------------------------------------------------

interface RecomputeOpts {
  now?: string;
  sinceDays?: number;
}

/**
 * Recompute the reputation vector for an agent from live evidence, persist the
 * derived events (idempotently) and the snapshot, sign and store a receipt, and
 * return { vector, receipt }. Reuses the instance Ed25519 signing key.
 */
export async function recomputeReputation(
  sql: SqlClient,
  orgId: string,
  agentId: string,
  { now = new Date().toISOString(), sinceDays = DEFAULT_LOOKBACK_DAYS }: RecomputeOpts = {}
): Promise<{ vector: ReputationVector; receipt: unknown; breakdown: ReputationBreakdown }> {
  const events = await gatherEvidenceEvents(sql, orgId, agentId, { sinceDays });
  await persistEvents(sql, orgId, agentId, events);

  // The breakdown is a sibling: it is persisted on the snapshot and returned to
  // callers, but the PURE vector is what gets hashed and signed into the receipt.
  const { vector, breakdown } = computeVectorWithBreakdown(agentId, events, { now, lookbackDays: sinceDays });
  // computeVector returns the canonical (non-null) ReputationVector; the local
  // interface that the repo's CRUD/return signatures use is the nullable
  // DB-snapshot variant. Same fields at runtime — bridge at these boundaries.
  await upsertReputationSnapshot(sql, orgId, agentId, vector as unknown as ReputationVector, breakdown);

  const key = await getServerSigningKey(sql);
  const receipt = buildReputationReceipt(vector, { kid: key.kid, privateKeyJwk: key.privateKeyJwk }, vector.computed_at);
  await insertReputationReceipt(sql, orgId, agentId, { receipt: receipt as unknown as ReputationReceiptInput['receipt'], kid: key.kid, issuedAt: vector.computed_at });

  return { vector: vector as unknown as ReputationVector, receipt, breakdown };
}

/**
 * Read-only: compute the current vector from live evidence without persisting
 * anything. Used by GET endpoints so a read never has side effects; the
 * persisting + signing path is recomputeReputation (POST).
 */
export async function computeReputationVector(
  sql: SqlClient,
  orgId: string,
  agentId: string,
  { now = new Date().toISOString(), sinceDays = DEFAULT_LOOKBACK_DAYS }: RecomputeOpts = {}
): Promise<ReputationVector> {
  const { vector } = await computeReputationVectorWithBreakdown(sql, orgId, agentId, { now, sinceDays });
  return vector;
}

/**
 * Read-only live computation returning the provenance breakdown beside the
 * vector. The breakdown never enters the hashed/signed vector.
 */
export async function computeReputationVectorWithBreakdown(
  sql: SqlClient,
  orgId: string,
  agentId: string,
  { now = new Date().toISOString(), sinceDays = DEFAULT_LOOKBACK_DAYS }: RecomputeOpts = {}
): Promise<{ vector: ReputationVector; breakdown: ReputationBreakdown }> {
  const events = await gatherEvidenceEvents(sql, orgId, agentId, { sinceDays });
  // computeVector yields the canonical (non-null) variant; this fn's signature
  // declares the local nullable DB-snapshot variant — same fields at runtime.
  const { vector, breakdown } = computeVectorWithBreakdown(agentId, events, { now, lookbackDays: sinceDays });
  return { vector: vector as unknown as ReputationVector, breakdown };
}

/**
 * Read-only: compute the current vector and sign a receipt for it without
 * persisting. Used by GET .../receipt when no stored receipt exists yet.
 */
export async function buildCurrentReceipt(
  sql: SqlClient,
  orgId: string,
  agentId: string,
  opts: RecomputeOpts = {}
): Promise<unknown> {
  const vector = await computeReputationVector(sql, orgId, agentId, opts);
  const key = await getServerSigningKey(sql);
  // vector is the local nullable variant; buildReputationReceipt takes the
  // canonical non-null one — same shape at runtime.
  return buildReputationReceipt(vector as unknown as CanonicalReputationVector, { kid: key.kid, privateKeyJwk: key.privateKeyJwk }, vector.computed_at);
}

/**
 * Coerce a stored snapshot row into the vector shape. The Neon HTTP driver
 * returns numeric columns as strings, so coerce with Number() before returning.
 */
export function snapshotToVector(
  s: Record<string, unknown> | null | undefined
): ReputationVector | null {
  if (!s) return null;
  const num = (v: unknown): number | null => (v == null ? null : Number(v));
  // jsonb may arrive as an object (Neon) or string (some drivers/tests) —
  // normalize to an object; malformed payloads degrade to null, never throw.
  let breakdown: unknown = s.breakdown ?? null;
  if (typeof breakdown === 'string') {
    try { breakdown = JSON.parse(breakdown); } catch { breakdown = null; }
  }
  return {
    agent_id: s.agent_id as string,
    reliability_score: num(s.reliability_score),
    completion_rate: num(s.completion_rate),
    policy_violation_rate: num(s.policy_violation_rate),
    approval_adherence: num(s.approval_adherence),
    quality_score: num(s.quality_score),
    risk_score: s.risk_score == null ? null : Number(s.risk_score),
    volume_weight: num(s.volume_weight),
    confidence: num(s.confidence),
    total_events: Number(s.total_events) || 0,
    last_event_at: s.last_event_at as string | null,
    computed_at: s.computed_at as string,
    // Provenance sibling (not part of the canonical hashed vector).
    breakdown,
  };
}
