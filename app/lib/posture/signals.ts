/**
 * Signals (I/O boundary) — gathers live data from repositories + the guard
 * evaluator and feeds the pure posture score engine.
 *
 * ALL database I/O lives here and in posture.repository.ts. The engine
 * functions (computeScore, deriveFindings, gradeCoverage) remain pure.
 */

import { isSyntheticEvent } from '../calibration-mining.js';
import {
  bucketRiskScore,
} from './model';
import type {
  GovernableUnit,
  Adjustments,
  Incident,
  PostureFinding,
} from './types';

// ─────────────────────────────────────────────────────────────────────────────
// Step 1 — build the deduplicated unit list
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Merge capability units and observed-action units, deduplicating on key.
 * Capability units win on riskLevel/requiresApproval/dimension; observed-action
 * units contribute their observedCount back into matching capability entries.
 *
 * x402 spend surfaces are used to flip hasSpendExposure on matching action units.
 */
export function buildUnits(
  capUnits: GovernableUnit[],
  actionUnits: GovernableUnit[],
  x402Slugs: Set<string>,
): GovernableUnit[] {
  const byKey = new Map<string, GovernableUnit>();

  // Capability units first (authoritative for riskLevel/dimension/requiresApproval).
  for (const u of capUnits) {
    byKey.set(u.key, u);
  }

  // Observed-action units: if a capability with the same key already exists
  // (unlikely — different key spaces), merge; otherwise add as action_type unit.
  for (const u of actionUnits) {
    const existing = byKey.get(u.key);
    if (existing) {
      // Same key: bump observedCount on the existing capability entry.
      byKey.set(u.key, { ...existing, observedCount: existing.observedCount + u.observedCount });
    } else {
      byKey.set(u.key, u);
    }
  }

  // x402 spend surfaces: any unit whose key matches an active x402 provider slug
  // is spend-exposed. Capability units key on their slug, so x402-backed
  // capabilities light up here.
  if (x402Slugs.size > 0) {
    for (const [key, u] of byKey) {
      if (!u.hasSpendExposure && x402Slugs.has(key)) {
        byKey.set(key, { ...u, hasSpendExposure: true });
      }
    }
  }

  return Array.from(byKey.values());
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 3 — build adjustments
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build the Adjustments object from live data.
 *
 * - incidents: guard_decisions that reached 'allow' at high/critical risk in the
 *   trailing 7-day window (ungoverned leaks that should penalise the score).
 * - approvalFollowThrough: 1 (deferred — requires a separate pending-approval
 *   query and outcome-sweep data that Task 8 surfaces via snapshots).
 * - coachOpenGapUnitKeys: [] (deferred — Policy Coach suggestion state is not
 *   yet read here; Task 8 will wire this).
 */
export function buildAdjustments(
  decisionRows: { id: unknown; risk_score: unknown; action_type: unknown; agent_id?: unknown; created_at: unknown; context?: unknown }[],
): Adjustments {
  const incidents: Incident[] = decisionRows
    .filter((r) => {
      const score = Number(r.risk_score) || 0;
      return score >= 50; // already filtered in SQL; guard here for safety
    })
    // v3.1: synthetic verification traffic never becomes an incident. The SQL
    // already excludes it; this JS re-check keeps the shared predicate
    // (calibration-mining.js) authoritative even if a caller feeds raw rows.
    .filter((r) => !isSyntheticEvent({
      agent_id: r.agent_id == null ? null : String(r.agent_id),
      action_type: r.action_type == null ? null : String(r.action_type),
    }))
    .map((r): Incident => ({
      unitKey: r.action_type ? `action_type:${String(r.action_type)}` : 'action_type:unknown',
      // guard_decisions.id (act_gd_*) is the decision identifier — the surfaced
      // evidence id for the leak (guard_decisions carries no action_records FK).
      actionId: String(r.id || ''),
      riskLevel: bucketRiskScore(Number(r.risk_score) || 0),
      ts: String(r.created_at || new Date().toISOString()),
    }));

  return {
    incidents,
    approvalFollowThrough: 1, // deferred to Task 8
    coachOpenGapUnitKeys: [], // deferred to Task 8
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 3b — evidence-first guard: intent-source signal per unit
// ─────────────────────────────────────────────────────────────────────────────

/** Evidence/declared mix shown on the enforcement dimension detail (/posture). */
export interface EvidenceMix { evidence: number; declared: number }

function parseIntentSource(context: unknown): 'evidence' | 'declared' | null {
  let ctx: Record<string, unknown> | null = null;
  if (context && typeof context === 'object') ctx = context as Record<string, unknown>;
  else if (typeof context === 'string') {
    try { ctx = JSON.parse(context) as Record<string, unknown>; } catch { ctx = null; }
  }
  const v = ctx?.intent_source;
  return v === 'evidence' || v === 'declared' ? v : null;
}

/**
 * Build the per-unit intent-source lookup + the aggregate evidence/declared
 * mix for the enforcement dimension, from the SAME decision rows already
 * fetched for incidents (no new query — spec §6). This is necessarily a
 * narrow sample (getRecentDecisions only returns high-risk `allow` decisions),
 * so it undercounts total enforcement traffic; treat it as "is this unit's
 * recent leak evidence-graded or self-declared", not a claim of full
 * coverage. Rows lacking a persisted intent_source (pre-upgrade decisions, or
 * a decision the classifier never touched) contribute no signal —
 * gradeCoverage then grades at full strength (handle absence gracefully).
 */
export function buildIntentSourceSignal(
  decisionRows: { action_type: unknown; context?: unknown }[],
): { byUnitKey: Map<string, 'evidence' | 'declared'>; enforcementMix: EvidenceMix } {
  const byUnitKey = new Map<string, 'evidence' | 'declared'>();
  const enforcementMix: EvidenceMix = { evidence: 0, declared: 0 };
  // Rows are ordered created_at DESC (getRecentDecisions), so the first row
  // seen per action_type is the most recent — first-write-wins below.
  for (const r of decisionRows) {
    const src = parseIntentSource(r.context);
    if (!src) continue;
    if (src === 'evidence') enforcementMix.evidence += 1; else enforcementMix.declared += 1;
    const unitKey = r.action_type ? `action_type:${String(r.action_type)}` : null;
    if (unitKey && !byUnitKey.has(unitKey)) byUnitKey.set(unitKey, src);
  }
  return { byUnitKey, enforcementMix };
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 4 — merge stored finding state onto the derived (open) findings
// ─────────────────────────────────────────────────────────────────────────────

const VALID_FINDING_STATUSES = new Set<PostureFinding['status']>([
  'open', 'drafted', 'resolved', 'snoozed', 'accepted_risk',
]);

/**
 * Apply stored resolution state onto freshly-derived findings. A finding the
 * operator has resolved/snoozed/accepted/drafted carries that status forward so
 * the queue and ledger consumers can filter it. Findings with no stored state
 * stay `open`. This is pure (the I/O happens in computePosturePayload) so the
 * merge invariant is unit-testable.
 *
 * v3.1: non-open findings also carry the stored decision's metadata
 * (actor/note/updatedAt) so quieting a finding is a visible, attributed act
 * on the surface — not a disappearance.
 *
 * Note: finding STATE never changes the SCORE — the score is coverage-derived.
 * Snoozing or accepting a finding hides it from the queue but cannot raise the
 * number (the honesty property holds at the engine boundary).
 */
export interface StoredFindingState {
  status: string;
  actor?: string | null;
  note?: string | null;
  updatedAt?: string | null;
}

export function applyFindingStates(
  findings: PostureFinding[],
  states: Map<string, StoredFindingState>,
): PostureFinding[] {
  if (states.size === 0) return findings;
  return findings.map((f) => {
    const stored = states.get(f.key);
    if (!stored || !VALID_FINDING_STATUSES.has(stored.status as PostureFinding['status'])) return f;
    return {
      ...f,
      status: stored.status as PostureFinding['status'],
      statusMeta: {
        actor: stored.actor ?? null,
        note: stored.note ?? null,
        updatedAt: stored.updatedAt ?? null,
      },
    };
  });
}
