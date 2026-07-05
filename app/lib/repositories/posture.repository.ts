/**
 * Posture repository — data access for the governance posture score.
 *
 * Two responsibilities:
 *   1. Read queries that feed the score engine (capabilities, observed actions,
 *      recent decisions, identity-bound agents, x402 spend surfaces).
 *   2. Read/write of the posture loop state: posture_findings_state (per-finding
 *      resolution) and posture_snapshots (the trend line).
 *
 * All functions take `sql: SqlTag` as the first argument (tagged-template client)
 * and `orgId: string` as the second, matching the house repository pattern.
 */

import { randomUUID } from 'node:crypto';
import type { SqlTag } from '../types/db';
import { bucketRiskScore } from '../posture/model';
import {
  SYNTHETIC_AGENT_LIKE_PATTERNS,
  SYNTHETIC_ACTION_TYPE_LIKE_PATTERNS,
} from '../calibration-mining.js';
import type { GovernableUnit, RiskLevel, Dimension, DimensionScore } from '../posture/types';

// ─────────────────────────────────────────────────────────────────────────────
// Row types (untrusted DB rows; shaped before use)
// ─────────────────────────────────────────────────────────────────────────────

interface CapabilityPostureRow {
  slug: unknown;
  name: unknown;
  category: unknown;
  source_type: unknown;
  risk_level: unknown;
  requires_approval: unknown;
  pricing_json: unknown;
  [k: string]: unknown;
}

interface ActionTypeRow {
  action_type: unknown;
  risk_score_avg: unknown;
  observed_count: unknown;
  reversible_any: unknown;
  systems_touched_sample: unknown;
  has_cost: unknown;
  [k: string]: unknown;
}

interface IdentityBoundRow {
  agent_id: unknown;
  [k: string]: unknown;
}

interface X402ProviderPostureRow {
  provider_id: unknown;
  slug: unknown;
  [k: string]: unknown;
}

interface DecisionRow {
  id: unknown;            // guard_decisions.id (the decision id, e.g. act_gd_*)
  risk_score: unknown;
  action_type: unknown;
  agent_id: unknown;      // for the JS-side isSyntheticEvent defense filter (v3.1)
  created_at: unknown;
  // evidence-first guard: raw context JSON (text column) — carries
  // intent_source when the guard evaluator persisted one. Parsed in JS, same
  // as every other context reader (context->'x' fails on this TEXT column).
  context: unknown;
  [k: string]: unknown;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const RISK_LEVELS = new Set<string>(['low', 'medium', 'high', 'critical']);

function toRiskLevel(v: unknown): RiskLevel {
  return RISK_LEVELS.has(String(v)) ? (v as RiskLevel) : 'medium';
}

/** Map a capability category to its primary posture dimension. */
function capabilityDimension(category: unknown, sourceType: unknown): Dimension {
  const cat = String(category || '').toLowerCase();
  const src = String(sourceType || '').toLowerCase();
  if (cat === 'identity' || cat === 'auth' || cat === 'authentication') return 'identity';
  if (cat === 'spend' || cat === 'payments' || cat === 'billing' || src === 'external_marketplace') return 'spend';
  if (cat === 'data' || cat === 'storage' || cat === 'database') return 'data_protection';
  if (cat === 'approval' || cat === 'review') return 'approval';
  if (cat === 'logging' || cat === 'audit' || cat === 'monitoring') return 'auditability';
  return 'enforcement';
}

/** Map an action_type string to its primary posture dimension. */
function actionTypeDimension(actionType: string): Dimension {
  const t = actionType.toLowerCase();
  if (t === 'deploy' || t === 'apply' || t === 'migrate' || t === 'security') return 'enforcement';
  if (t === 'api' || t === 'sync' || t === 'post' || t === 'message') return 'data_protection';
  if (t === 'monitor' || t === 'alert' || t === 'review') return 'auditability';
  return 'enforcement';
}

function hasPricing(pricingJson: unknown): boolean {
  if (!pricingJson || pricingJson === '{}') return false;
  if (typeof pricingJson === 'string') {
    try {
      const p = JSON.parse(pricingJson);
      return typeof p === 'object' && p !== null && Object.keys(p).length > 0;
    } catch { return false; }
  }
  if (typeof pricingJson === 'object') return Object.keys(pricingJson as object).length > 0;
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Exported query functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns a GovernableUnit for each capability registered for this org.
 * observedCount is 0 here; it gets merged with observed-action units in signals.ts.
 */
export async function getCapabilityUnits(
  sql: SqlTag,
  orgId: string,
): Promise<GovernableUnit[]> {
  const rows = await sql`
    SELECT slug, name, category, source_type, risk_level, requires_approval, pricing_json
    FROM capabilities
    WHERE org_id = ${orgId}
    ORDER BY updated_at DESC
  `;
  return (rows as CapabilityPostureRow[]).map((r): GovernableUnit => {
    const isExternal = String(r.source_type || '').includes('external') ||
      String(r.source_type || '').includes('marketplace');
    return {
      key: String(r.slug || r.name || 'unknown'),
      surfaceType: 'capability',
      riskLevel: toRiskLevel(r.risk_level),
      reversible: true, // capabilities don't have a per-capability reversible flag; default safe
      hasSpendExposure: hasPricing(r.pricing_json) || isExternal,
      requiresApproval: r.requires_approval === 1 || r.requires_approval === true,
      observedCount: 0,
      dimension: capabilityDimension(r.category, r.source_type),
    };
  });
}

/**
 * Aggregates action_records by action_type to produce GovernableUnit entries.
 * Risk level is bucketed from the average risk_score. observedCount = row count.
 */
export async function getObservedActionUnits(
  sql: SqlTag,
  orgId: string,
): Promise<GovernableUnit[]> {
  const rows = await sql`
    SELECT
      action_type,
      AVG(risk_score)::real             AS risk_score_avg,
      COUNT(*)::int                     AS observed_count,
      MAX(CASE WHEN reversible = 0 THEN 1 ELSE 0 END)::int AS reversible_any,
      MAX(systems_touched)              AS systems_touched_sample,
      MAX(CASE WHEN cost_estimate > 0 THEN 1 ELSE 0 END)::int AS has_cost
    FROM action_records
    WHERE org_id = ${orgId}
      AND action_type IS NOT NULL
      AND action_type <> ''
      -- v3.1 synthetic-traffic exclusion: the platform's own verification
      -- traffic must not mint governable units (same families as the
      -- calibration miner; patterns shared from calibration-mining.js).
      AND action_type NOT LIKE ALL(${SYNTHETIC_ACTION_TYPE_LIKE_PATTERNS}::text[])
      AND (agent_id IS NULL OR agent_id NOT LIKE ALL(${SYNTHETIC_AGENT_LIKE_PATTERNS}::text[]))
    GROUP BY action_type
    ORDER BY observed_count DESC
  `;
  return (rows as ActionTypeRow[]).map((r): GovernableUnit => {
    const avgRisk = Number(r.risk_score_avg) || 0;
    const irreversible = Number(r.reversible_any) === 1;
    return {
      key: `action_type:${String(r.action_type)}`,
      surfaceType: 'action_type',
      riskLevel: bucketRiskScore(avgRisk),
      reversible: !irreversible,
      hasSpendExposure: Number(r.has_cost) === 1,
      requiresApproval: false, // no declared intent; coverage comes from policies
      observedCount: Number(r.observed_count) || 0,
      dimension: actionTypeDimension(String(r.action_type)),
    };
  });
}

/**
 * Returns recent guard_decisions that reached 'allow' despite high/critical risk
 * (ungoverned high-risk actions — incident candidates for the adjustments).
 * sinceTs: ISO timestamp; default 7-day window.
 */
export async function getRecentDecisions(
  sql: SqlTag,
  orgId: string,
  sinceTs: string,
): Promise<DecisionRow[]> {
  // guard_decisions has no action_id/outcome_status column — its own `id`
  // (act_gd_*) identifies the decision. Selecting non-existent columns 500s
  // the whole /api/posture route, so this stays pinned to real columns.
  const rows = await sql`
    SELECT id, risk_score, action_type, agent_id, created_at, context
    FROM guard_decisions
    WHERE org_id = ${orgId}
      AND decision = 'allow'
      AND risk_score >= 50
      AND created_at::timestamptz > ${sinceTs}::timestamptz
      -- v3.1 synthetic-traffic exclusion, BEFORE the LIMIT: smoke traffic is
      -- designed to trip policies and was consuming the whole incident window
      -- on instances that run the harness (patterns from calibration-mining.js).
      AND (action_type IS NULL OR action_type NOT LIKE ALL(${SYNTHETIC_ACTION_TYPE_LIKE_PATTERNS}::text[]))
      AND (agent_id IS NULL OR agent_id NOT LIKE ALL(${SYNTHETIC_AGENT_LIKE_PATTERNS}::text[]))
    ORDER BY created_at DESC
    LIMIT 100
  `;
  return rows as DecisionRow[];
}

/**
 * Returns distinct agent_ids that have been explicitly bound (i.e. appear in
 * guard_policies' agent_ids scope, meaning an operator has targeted them).
 * Used to compute the identity-binding coverage dimension.
 */
export async function getIdentityBoundAgents(
  sql: SqlTag,
  orgId: string,
): Promise<IdentityBoundRow[]> {
  const rows = await sql`
    SELECT DISTINCT jsonb_array_elements_text(agent_ids::jsonb) AS agent_id
    FROM guard_policies
    WHERE org_id = ${orgId}
      AND active = 1
      AND agent_ids IS NOT NULL
      AND agent_ids <> 'null'
      AND agent_ids <> '[]'
  `;
  return rows as IdentityBoundRow[];
}

/**
 * Returns active x402 providers for this org — each represents a spend-exposed
 * surface. Used by signals.ts to set hasSpendExposure on matching units.
 */
export async function getX402SpendSurfaces(
  sql: SqlTag,
  orgId: string,
): Promise<X402ProviderPostureRow[]> {
  const rows = await sql`
    SELECT provider_id, slug
    FROM x402_providers
    WHERE org_id = ${orgId}
      AND status = 'active'
    ORDER BY created_at DESC
  `;
  return rows as X402ProviderPostureRow[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Finding state (posture_findings_state) — read/write. A resolved/snoozed/
// risk-accepted finding stops re-surfacing in the open queue. `drafted` records
// that an INACTIVE policy draft exists (it does NOT count as coverage).
// ─────────────────────────────────────────────────────────────────────────────

/** Valid finding-state statuses (the deterministic finding queue lifecycle). */
export const FINDING_STATUSES = ['open', 'drafted', 'resolved', 'snoozed', 'accepted_risk'] as const;
export type FindingStatus = (typeof FINDING_STATUSES)[number];

interface FindingStateRow {
  finding_key: unknown;
  status: unknown;
  note: unknown;
  actor: unknown;
  created_at: unknown;
  updated_at: unknown;
  [k: string]: unknown;
}

export interface FindingState {
  findingKey: string;
  status: string;
  note: string | null;
  actor: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

function shapeFindingState(row: FindingStateRow): FindingState {
  return {
    findingKey: String(row.finding_key ?? ''),
    status: String(row.status ?? ''),
    note: row.note == null ? null : String(row.note),
    actor: row.actor == null ? null : String(row.actor),
    createdAt: row.created_at == null ? null : String(row.created_at),
    updatedAt: row.updated_at == null ? null : String(row.updated_at),
  };
}

/** Returns the stored state for one finding key, or null if never actioned. */
export async function getFindingState(
  sql: SqlTag,
  orgId: string,
  findingKey: string,
): Promise<FindingState | null> {
  const rows = await sql`
    SELECT finding_key, status, note, actor, created_at, updated_at
    FROM posture_findings_state
    WHERE org_id = ${orgId} AND finding_key = ${findingKey}
    LIMIT 1
  `;
  const row = (rows as FindingStateRow[])[0];
  return row ? shapeFindingState(row) : null;
}

/** Returns every stored finding state for the org (for the signals merge). */
export async function listFindingStates(
  sql: SqlTag,
  orgId: string,
): Promise<FindingState[]> {
  const rows = await sql`
    SELECT finding_key, status, note, actor, created_at, updated_at
    FROM posture_findings_state
    WHERE org_id = ${orgId}
  `;
  return (rows as FindingStateRow[]).map(shapeFindingState);
}

/**
 * Upsert a finding's resolution state (keyed by the deterministic finding_key).
 * created_at is preserved on conflict; only status/note/actor/updated_at change.
 */
export async function setFindingState(
  sql: SqlTag,
  orgId: string,
  findingKey: string,
  status: FindingStatus,
  actor: string | null,
  note: string | null,
): Promise<FindingState | null> {
  const now = new Date().toISOString();
  const rows = await sql`
    INSERT INTO posture_findings_state (org_id, finding_key, status, note, actor, created_at, updated_at)
    VALUES (${orgId}, ${findingKey}, ${status}, ${note ?? null}, ${actor ?? null}, ${now}, ${now})
    ON CONFLICT (org_id, finding_key)
    DO UPDATE SET
      status = EXCLUDED.status,
      note = EXCLUDED.note,
      actor = EXCLUDED.actor,
      updated_at = EXCLUDED.updated_at
    RETURNING finding_key, status, note, actor, created_at, updated_at
  `;
  const row = (rows as FindingStateRow[])[0];
  return row ? shapeFindingState(row) : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Snapshots (posture_snapshots) — trend line, written on explicit scan.
// score is NUMERIC → Neon returns it as a string; coerce Number() on read.
// ─────────────────────────────────────────────────────────────────────────────

interface SnapshotRow {
  id: unknown;
  score: unknown;
  dimensions: unknown;
  created_at: unknown;
  [k: string]: unknown;
}

export interface PostureSnapshot {
  id: string;
  score: number;
  dimensions: DimensionScore[];
  createdAt: string | null;
}

function parseDimensions(v: unknown): DimensionScore[] {
  let value = v;
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { return []; }
  }
  return Array.isArray(value) ? (value as DimensionScore[]) : [];
}

function shapeSnapshot(row: SnapshotRow): PostureSnapshot {
  return {
    id: String(row.id ?? ''),
    score: Number(row.score) || 0, // numeric-as-string coercion (Neon HTTP driver)
    dimensions: parseDimensions(row.dimensions),
    createdAt: row.created_at == null ? null : String(row.created_at),
  };
}

/** Persist a trend snapshot. id is generated (`psnap_` prefix). */
export async function insertPostureSnapshot(
  sql: SqlTag,
  orgId: string,
  score: number,
  dimensions: DimensionScore[],
): Promise<PostureSnapshot | null> {
  const id = `psnap_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
  const now = new Date().toISOString();
  const rows = await sql`
    INSERT INTO posture_snapshots (id, org_id, score, dimensions, created_at)
    VALUES (${id}, ${orgId}, ${score}, ${JSON.stringify(dimensions)}, ${now})
    RETURNING id, score, dimensions, created_at
  `;
  const row = (rows as SnapshotRow[])[0];
  return row ? shapeSnapshot(row) : null;
}

/** Returns the most recent snapshots (newest first) for the trend sparkline. */
export async function listPostureSnapshots(
  sql: SqlTag,
  orgId: string,
  limit = 30,
): Promise<PostureSnapshot[]> {
  const rows = await sql`
    SELECT id, score, dimensions, created_at
    FROM posture_snapshots
    WHERE org_id = ${orgId}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
  return (rows as SnapshotRow[]).map(shapeSnapshot);
}
