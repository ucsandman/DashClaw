/**
 * Signals (I/O boundary) — gathers live data from repositories + the guard
 * evaluator and feeds the pure posture score engine.
 *
 * ALL database I/O lives here and in posture.repository.ts. The engine
 * functions (computeScore, deriveFindings, gradeCoverage) remain pure.
 */

import type { SqlTag } from '../types/db';
import {
  getCapabilityUnits,
  getObservedActionUnits,
  getRecentDecisions,
  getIdentityBoundAgents,
  getX402SpendSurfaces,
  listFindingStates,
} from '../repositories/posture.repository';
import { getActivePolicies } from '../repositories/guardrails.repository';
import { getLatestLiveCanaryRunForOrg } from '../repositories/live-canary.repository';
import { evaluatePolicy } from '../guard';
import { isSyntheticEvent } from '../calibration-mining.js';
import {
  gradeCoverage,
  computeScore,
  bucketRiskScore,
} from './model';
import { deriveFindings, deriveLiveCanaryFinding } from './findings';
import type {
  GovernableUnit,
  Decision,
  Adjustments,
  Incident,
  PostureScore,
  PostureFinding,
} from './types';

// ─────────────────────────────────────────────────────────────────────────────
// Internal types
// ─────────────────────────────────────────────────────────────────────────────

interface PolicyRow {
  id: string;
  name: string;
  policy_type: string;
  rules: string;
  agent_ids?: string | null;
  [field: string]: unknown;
}

interface PolicyRules {
  threshold?: number;
  action?: string;
  action_types?: string[];
  paths?: string[];
  max_actions?: number;
  window_minutes?: number;
  max_spend_usd?: number;
  approval_threshold?: number;
  [k: string]: unknown;
}

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
// Step 2 — build the policy replay map
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Severity ordering for folding multiple policy results into a single decision.
 * Higher = more restrictive.
 */
const DECISION_SEV: Record<string, number> = {
  allow: 0,
  warn: 1,
  require_approval: 2,
  block: 3,
};

const VALID_DECISIONS = new Set<string>(['allow', 'warn', 'require_approval', 'block']);

function toDecision(s: string): Decision {
  return VALID_DECISIONS.has(s) ? (s as Decision) : 'allow';
}

/**
 * Pre-compute a Map<unitKey, Decision> by evaluating every active org-wide
 * policy against a synthetic GuardEvalContext for each unit.
 *
 * Design notes:
 * - We use evaluatePolicy() (single-policy evaluator), NOT evaluateGuard()
 *   (which persists a guard_decisions audit row on every call — forbidden here).
 * - For org-wide posture coverage we evaluate with agent_id=null so only
 *   policies with null/empty agent_ids scope (= apply to ALL agents) count as
 *   coverage. Agent-scoped policies do NOT contribute to the org-wide score
 *   (partial coverage, not universal).
 * - The synthetic context sets action_type / risk_score for risk_threshold and
 *   require_approval/block_action_type policies. For path-based or rate-limit
 *   policies the context carries no target/paths, so they correctly return null
 *   (no coverage for path-gating from a headless context).
 * - evaluatePolicy() returns null when the policy doesn't apply; we fold to the
 *   highest-severity result across all applicable policies.
 */
async function buildReplayMap(
  policies: Record<string, unknown>[],
  units: GovernableUnit[],
  sql: SqlTag,
  orgId: string,
): Promise<Map<string, Decision>> {
  // Only org-wide policies (null/empty agent_ids) count for the coverage score.
  const orgWidePolicies = (policies as PolicyRow[]).filter((p) => {
    if (!p.agent_ids) return true;
    try {
      const scoped = JSON.parse(p.agent_ids);
      return !Array.isArray(scoped) || scoped.length === 0;
    } catch {
      return false; // malformed → skip (fail-closed, same as guard.ts)
    }
  });

  const result = new Map<string, Decision>();
  if (orgWidePolicies.length === 0) return result;

  await Promise.all(
    units.map(async (unit) => {
      // Synthetic context: minimal fields that matter for org-wide policies.
      // risk_score: use the unit's bucketed level mapped back to a representative
      // integer so risk_threshold policies fire correctly.
      const representativeRisk = { low: 10, medium: 35, high: 60, critical: 85 }[unit.riskLevel];

      const context = {
        agent_id: null,
        action_type: unit.surfaceType === 'action_type'
          ? unit.key.replace(/^action_type:/, '')
          : undefined,
        risk_score: representativeRisk,
        reversible: unit.reversible,
        declared_goal: null,
      };

      let bestDecision: Decision = 'allow';
      let bestSev = 0;

      for (const policy of orgWidePolicies) {
        let rules: PolicyRules = {};
        try {
          rules = typeof policy.rules === 'string'
            ? (JSON.parse(policy.rules) as PolicyRules)
            : (policy.rules as PolicyRules) ?? {};
        } catch {
          rules = {};
        }

        let policyResult: { action: string } | null = null;
        try {
          policyResult = await evaluatePolicy(
            policy as PolicyRow,
            rules,
            context,
            sql,
            orgId,
            representativeRisk,
          );
        } catch {
          // evaluatePolicy can throw for side-effectful policy types (e.g.
          // rate_limit hitting the DB with a null agent_id). Treat as no-op —
          // those policy types don't contribute to org-wide structural coverage.
          policyResult = null;
        }

        if (policyResult) {
          const sev = DECISION_SEV[policyResult.action] ?? 0;
          if (sev > bestSev) {
            bestSev = sev;
            bestDecision = toDecision(policyResult.action);
          }
        }
      }

      result.set(unit.key, bestDecision);
    }),
  );

  return result;
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
  decisionRows: { id: unknown; risk_score: unknown; action_type: unknown; agent_id?: unknown; created_at: unknown }[],
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

/**
 * Strip operator attribution (actor identity, free-text note) from findings.
 * Applied at the API boundary for key-authenticated callers: quiet-decision
 * attribution is need-to-know for humans reviewing the surface, not for every
 * agent holding an org key (2026-07-03 security review, MEDIUM). The
 * timestamp stays — "when" is audit-shape, "who/why" is identity.
 */
export function redactFindingAttribution(findings: PostureFinding[]): PostureFinding[] {
  return findings.map((f) =>
    f.statusMeta
      ? { ...f, statusMeta: { actor: null, note: null, updatedAt: f.statusMeta.updatedAt } }
      : f,
  );
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

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

export interface PosturePayload {
  score: PostureScore;
  findings: PostureFinding[];
  unitCount: number;
  /** Units whose coverage grade is 1 (fully governed). Always 0..unitCount. */
  coveredUnits: number;
}

/**
 * Compute the org's current governance posture score.
 *
 * Steps:
 *   1. Gather raw data from repositories in parallel.
 *   2. Build the deduplicated GovernableUnit list.
 *   3. Build the replay map (policy coverage per unit) via evaluatePolicy.
 *   4. Build adjustments (incidents, follow-through, coach gaps).
 *   5. gradeCoverage → coverageByKey.
 *   6. computeScore + deriveFindings (pure engine functions).
 */
export async function computePosturePayload(
  sql: SqlTag,
  orgId: string,
): Promise<PosturePayload> {
  // 7-day lookback for incidents.
  const sinceTs = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // 1. Parallel data fetch.
  const [capUnits, actionUnits, activePolicies, decisionRows, x402Rows, findingStates, canaryRun] = await Promise.all([
    getCapabilityUnits(sql, orgId),
    getObservedActionUnits(sql, orgId),
    getActivePolicies(sql, orgId),
    getRecentDecisions(sql, orgId, sinceTs),
    getX402SpendSurfaces(sql, orgId),
    listFindingStates(sql, orgId),
    getLatestLiveCanaryRunForOrg(sql, orgId),
  ]);

  const x402Slugs = new Set(x402Rows.map((r) => String(r.slug || '')));
  const stateByKey = new Map<string, StoredFindingState>(findingStates.map((s) => [
    s.findingKey,
    { status: s.status, actor: s.actor, note: s.note, updatedAt: s.updatedAt },
  ]));

  // 2. Build unit list.
  const units = buildUnits(capUnits, actionUnits, x402Slugs);

  // 3. Build replay map (async — evaluatePolicy per unit × policy).
  const replayMap = await buildReplayMap(activePolicies, units, sql, orgId);

  // Sync replay function for the pure engine.
  const replay = (unitKey: string): Decision => replayMap.get(unitKey) ?? 'allow';

  // infraOk: for now always true — infra health signals (MCP, embedding service)
  // are not yet surfaced per-unit. Task 8 will add them.
  const infraOk = (_u: GovernableUnit): boolean => true;

  // 4. Build adjustments.
  const adjustments = buildAdjustments(decisionRows);

  // 5. Grade coverage for each unit.
  const coverageByKey: Record<string, number> = {};
  for (const unit of units) {
    const { grade } = gradeCoverage(unit, replay, infraOk);
    coverageByKey[unit.key] = grade;
  }

  // 6. Run the pure engine, then merge stored finding state onto the queue.
  const score = computeScore(units, coverageByKey, adjustments);
  const derived = deriveFindings(units, coverageByKey, adjustments);
  // v3.4: the live-host canary's verdict joins the queue as one collapsed
  // auditability finding (fresh failures only — see deriveLiveCanaryFinding).
  // Appended before the state merge so snooze/accept_risk apply unchanged.
  const canaryFinding = deriveLiveCanaryFinding(canaryRun, Date.now());
  if (canaryFinding) {
    // Keep the queue's scoreDelta-descending order (deriveFindings sorts).
    const idx = derived.findIndex((f) => f.scoreDelta < canaryFinding.scoreDelta);
    if (idx === -1) derived.push(canaryFinding);
    else derived.splice(idx, 0, canaryFinding);
  }
  const findings = applyFindingStates(derived, stateByKey);

  // v3.1: coverage counted from the grades themselves — findings are not
  // units, and this number can never leave 0..unitCount.
  const coveredUnits = units.filter((u) => (coverageByKey[u.key] ?? 0) >= 1).length;

  return { score, findings, unitCount: units.length, coveredUnits };
}
