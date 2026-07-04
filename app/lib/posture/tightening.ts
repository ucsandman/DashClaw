// Tightening-proposal engine (roadmap v3.2: findings become proposals).
// Spec: docs/superpowers/specs/2026-07-03-findings-become-proposals-design.md
//
// Pure, rule-based, no LLM — the tuning engine's discipline
// (app/lib/policy-tuning/engine.ts) pointed the other direction: the tuning
// spec explicitly deferred tightening. This module owns it, fed by the same
// ungoverned-allow evidence that mints v3.1's pattern-collapsed
// review_incident posture findings, grouped identically (action_type ×
// riskLevel bucket) so proposal and finding mirror each other one-to-one.

import { createHash } from 'crypto';
import { bucketRiskScore, stableKey } from './model';
import type { RiskLevel } from './types';

export const TIGHTENING_RULE = 'govern_ungoverned_allow';

/** Content-stable id (the cv_ pattern): independent of which decision ids
 *  populate the window, so a dismissed pattern stays dismissed. */
export function tighteningProposalId(actionType: string, riskLevel: string): string {
  return (
    'tp_' +
    createHash('sha256')
      .update(`${TIGHTENING_RULE}\n${actionType}\n${riskLevel}`)
      .digest('hex')
      .slice(0, 16)
  );
}

/** The v3.1 posture finding this proposal mirrors (findings.ts incident keys). */
export function tighteningFindingKey(actionType: string, riskLevel: string): string {
  return stableKey(['enforcement', 'incident', `action_type:${actionType}`, riskLevel]);
}

export interface UngovernedDecisionRow {
  id: unknown;
  risk_score: unknown;
  action_type: unknown;
  agent_id?: unknown;
  created_at?: unknown;
}

export interface ActivePolicyRow {
  policy_type: unknown;
  rules: unknown; // JSON string in guard_policies; tolerate parsed objects
}

export interface TighteningProposal {
  id: string;
  rule: typeof TIGHTENING_RULE;
  action_type: string;
  risk_level: Extract<RiskLevel, 'high' | 'critical'>;
  finding_key: string;
  title: string;
  summary: string;
  evidence: {
    window_days: number;
    observed_count: number;
    risk_min: number;
    risk_max: number;
    example_decision_ids: string[]; // guard_decisions ids (act_gd_*) — /decisions ledger evidence
  };
  patch: {
    name: string;
    policy_type: 'require_approval';
    rules: { action_types: string[]; _tightened: true };
  };
}

// Policy types whose rules.action_types already interrupt an action type.
// An active one covering the pattern suppresses the proposal — this is also
// what retires a proposal after its own ratify: the loop closes through the
// policy, not through bookkeeping.
const GOVERNING_POLICY_TYPES = new Set(['require_approval', 'block_action_type', 'warn_action_type']);

export function governedActionTypes(policies: ActivePolicyRow[]): Set<string> {
  const governed = new Set<string>();
  for (const p of policies) {
    if (!GOVERNING_POLICY_TYPES.has(String(p.policy_type))) continue;
    let rules: unknown = p.rules;
    if (typeof rules === 'string') {
      try { rules = JSON.parse(rules); } catch { continue; }
    }
    const types = (rules as { action_types?: unknown } | null)?.action_types;
    if (!Array.isArray(types)) continue;
    for (const t of types) if (typeof t === 'string' && t) governed.add(t);
  }
  return governed;
}

const RISK_RANK: Record<string, number> = { critical: 0, high: 1 };
const MAX_NAME_ACTION_TYPE = 200; // guard_policies.name is validated ≤256

/**
 * Pure: derive tightening proposals from ungoverned-allow decision rows and
 * the org's active policies. One rule — govern_ungoverned_allow: a pattern of
 * >= minObserved allows at risk >= 50 for the same (action_type, riskLevel)
 * proposes a require_approval policy in the review-verdict "Tighten" shape,
 * unless an active governing policy already lists the action type.
 */
export function deriveTighteningProposals(
  rows: UngovernedDecisionRow[],
  policies: ActivePolicyRow[],
  opts: { windowDays: number; minObserved?: number },
): TighteningProposal[] {
  const minObserved = Math.max(1, opts.minObserved ?? 3);
  const governed = governedActionTypes(policies);

  const groups = new Map<
    string,
    { actionType: string; riskLevel: 'high' | 'critical'; ids: string[]; riskMin: number; riskMax: number }
  >();
  for (const r of rows) {
    const score = Number(r.risk_score) || 0;
    if (score < 50) continue; // already filtered in SQL; guard here for safety
    // Untyped decisions can't be governed by an action_types rule — skip.
    const actionType = r.action_type == null ? '' : String(r.action_type);
    if (!actionType) continue;
    const riskLevel = bucketRiskScore(score) as 'high' | 'critical';
    const gk = `${actionType}\n${riskLevel}`;
    const g = groups.get(gk) ?? { actionType, riskLevel, ids: [], riskMin: score, riskMax: score };
    g.ids.push(String(r.id || ''));
    g.riskMin = Math.min(g.riskMin, score);
    g.riskMax = Math.max(g.riskMax, score);
    groups.set(gk, g);
  }

  const proposals: TighteningProposal[] = [];
  for (const g of groups.values()) {
    if (g.ids.length < minObserved) continue;
    if (governed.has(g.actionType)) continue;
    proposals.push({
      id: tighteningProposalId(g.actionType, g.riskLevel),
      rule: TIGHTENING_RULE,
      action_type: g.actionType,
      risk_level: g.riskLevel,
      finding_key: tighteningFindingKey(g.actionType, g.riskLevel),
      title: `Govern "${g.actionType}" (${g.riskLevel}-risk allows)`,
      summary:
        `${g.ids.length} ungoverned ${g.riskLevel}-risk "${g.actionType}" ` +
        `${g.ids.length === 1 ? 'action' : 'actions'} reached allow in the last ${opts.windowDays} days`,
      evidence: {
        window_days: opts.windowDays,
        observed_count: g.ids.length,
        risk_min: g.riskMin,
        risk_max: g.riskMax,
        example_decision_ids: g.ids.slice(0, 5),
      },
      // The existing review-verdict "Tighten" shape (policies/review/verdict):
      // require_approval — the evidence says "this happened repeatedly and
      // nobody was asked", not "this must never happen". The human can harden
      // the created policy afterward.
      patch: {
        name: `[Tightened] ${g.actionType.slice(0, MAX_NAME_ACTION_TYPE)}`,
        policy_type: 'require_approval',
        rules: { action_types: [g.actionType], _tightened: true },
      },
    });
  }

  return proposals.sort(
    (a, b) =>
      (RISK_RANK[a.risk_level] ?? 9) - (RISK_RANK[b.risk_level] ?? 9) ||
      b.evidence.observed_count - a.evidence.observed_count ||
      a.id.localeCompare(b.id),
  );
}
