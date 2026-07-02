/**
 * Policy-tuning proposal engine — owner roadmap item 1.
 * Spec: docs/superpowers/specs/2026-07-01-policy-tuning-proposal-loop.md
 *
 * Pure, rule-based, no LLM. Consumes per-policy interruption stats (guard
 * decision mix + approval outcomes over a rolling window) and emits
 * evidence-carrying proposals. This module never writes anything: accepting
 * a proposal is a human admin PATCH through the existing policies route
 * (constitution §3 — humans ratify policy changes; nothing auto-applies).
 */

import crypto from 'node:crypto';

export interface PolicyFiredCounts {
  warn: number;
  require_approval: number;
  block: number;
  total: number;
}

export interface PolicyApprovalCounts {
  approved: number;
  denied: number;
  pending: number;
}

export interface ApprovedRiskScores {
  min: number;
  p50: number;
  max: number;
}

export interface PolicyTuningStats {
  policy_id: string;
  name: string;
  policy_type: string;
  active: boolean;
  created_at: string | null;
  updated_at: string | null;
  /** Parsed rules object ({} when the stored JSON is malformed). */
  rules: Record<string, unknown>;
  window_days: number;
  /** Start of the evidence window after updated_at clipping (ISO). */
  window_started_at: string;
  fired: PolicyFiredCounts;
  approvals: PolicyApprovalCounts;
  /** approved / (approved + denied); null when nothing resolved. */
  override_rate: number | null;
  approved_risk_scores: ApprovedRiskScores | null;
  last_fired_at: string | null;
  /** Fires over a fixed 60-day window (dead_policy rule input). */
  fired_60d: number;
}

export type ProposalRule = 'raise_risk_threshold' | 'keep_policy' | 'dead_policy';
export type ProposalSeverity = 'actionable' | 'informational';

export interface TuningProposal {
  /** Stable fingerprint: ptp_<sha256(policy|rule|params) first 16 hex>. */
  id: string;
  rule: ProposalRule;
  policy_id: string;
  policy_name: string;
  policy_type: string;
  severity: ProposalSeverity;
  title: string;
  summary: string;
  evidence: {
    window_days: number;
    window_started_at: string;
    fired: PolicyFiredCounts;
    approvals: PolicyApprovalCounts;
    override_rate: number | null;
    approved_risk_scores?: ApprovedRiskScores;
  };
  /** Present only on actionable proposals: the complete rules object to
   *  PATCH (current rules with the tuned key replaced). */
  patch?: { rules: Record<string, unknown> };
}

export const TUNING_DEFAULTS = {
  /** Minimum require_approval interruptions in the window before any
   *  outcome-based rule may fire. */
  minFired: 10,
  /** Minimum resolved (approved + denied) outcomes before rates mean anything. */
  minResolved: 5,
  /** Override rate at or above which raising a threshold is proposed. */
  raiseOverrideRate: 0.9,
  /** Denial rate at or above which the policy earns a keep endorsement. */
  keepDenialRate: 0.8,
  /** Fixed lookback for the dead-policy rule (independent of request window). */
  deadPolicyDays: 60,
  /** How far one accepted proposal moves a risk threshold. */
  thresholdStep: 10,
  /** Never propose a threshold above this (blocks stay meaningful). */
  thresholdCap: 95,
} as const;

export interface DeriveOptions {
  minFired?: number;
  minResolved?: number;
  /** Injectable clock for tests. */
  now?: Date;
}

function fingerprint(policyId: string, rule: ProposalRule, params: Record<string, unknown>): string {
  const digest = crypto
    .createHash('sha256')
    .update(`${policyId}|${rule}|${JSON.stringify(params)}`)
    .digest('hex');
  return `ptp_${digest.slice(0, 16)}`;
}

function pct(rate: number): string {
  return `${Math.round(rate * 1000) / 10}%`;
}

/** Raw per-(policy, decision) row from getDecisionMixByPolicy. */
export interface DecisionMixRow {
  policy_id: string;
  decision: string;
  cnt: number | string;
  last_fired: string | null;
}

/** Raw per-policy row from getApprovalOutcomesByPolicy. */
export interface ApprovalOutcomeRow {
  policy_id: string;
  approved: number | string;
  denied: number | string;
  pending: number | string;
  approved_min: number | string | null;
  approved_p50: number | string | null;
  approved_max: number | string | null;
}

interface PolicyRowLike {
  id?: unknown;
  name?: unknown;
  policy_type?: unknown;
  rules?: unknown;
  active?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
  [field: string]: unknown;
}

function parseRules(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>;
  if (typeof raw !== 'string' || !raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function toIso(value: unknown): string | null {
  if (value == null) return null;
  const d = new Date(value as string | number | Date);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Compose repository rows into per-policy stats. Pure — the evidence window
 * per policy starts at max(now − windowDays, policy.updated_at): a config
 * change resets the evidence (the SQL applies the same clipping; this
 * recomputes the boundary for display).
 */
export function buildTuningStats(
  policies: PolicyRowLike[],
  mixRows: DecisionMixRow[],
  outcomeRows: ApprovalOutcomeRow[],
  fired60: Record<string, { fired: number }>,
  windowDays: number,
  now: Date = new Date()
): PolicyTuningStats[] {
  const mixByPolicy = new Map<string, DecisionMixRow[]>();
  for (const row of mixRows) {
    if (typeof row.policy_id !== 'string') continue;
    const list = mixByPolicy.get(row.policy_id) || [];
    list.push(row);
    mixByPolicy.set(row.policy_id, list);
  }
  const outcomesByPolicy = new Map<string, ApprovalOutcomeRow>();
  for (const row of outcomeRows) {
    if (typeof row.policy_id !== 'string') continue;
    outcomesByPolicy.set(row.policy_id, row);
  }

  const windowStartMs = now.getTime() - windowDays * 86_400_000;

  return policies
    .filter((p): p is PolicyRowLike & { id: string } => typeof p.id === 'string')
    .map((p) => {
      const updatedIso = toIso(p.updated_at);
      const updatedMs = updatedIso ? new Date(updatedIso).getTime() : null;
      const startMs = updatedMs != null && updatedMs > windowStartMs ? updatedMs : windowStartMs;

      const fired: PolicyFiredCounts = { warn: 0, require_approval: 0, block: 0, total: 0 };
      let lastFired: string | null = null;
      for (const row of mixByPolicy.get(p.id) || []) {
        const cnt = Number(row.cnt) || 0;
        fired.total += cnt;
        if (row.decision === 'warn') fired.warn += cnt;
        else if (row.decision === 'require_approval') fired.require_approval += cnt;
        else if (row.decision === 'block') fired.block += cnt;
        const rowLast = toIso(row.last_fired);
        if (rowLast && (!lastFired || rowLast > lastFired)) lastFired = rowLast;
      }

      const outcome = outcomesByPolicy.get(p.id);
      const approvals: PolicyApprovalCounts = {
        approved: Number(outcome?.approved) || 0,
        denied: Number(outcome?.denied) || 0,
        pending: Number(outcome?.pending) || 0,
      };
      const resolved = approvals.approved + approvals.denied;
      const overrideRate = resolved > 0 ? approvals.approved / resolved : null;

      let approvedScores: ApprovedRiskScores | null = null;
      if (outcome && approvals.approved > 0 && outcome.approved_min != null) {
        approvedScores = {
          min: Number(outcome.approved_min) || 0,
          p50: Number(outcome.approved_p50) || 0,
          max: Number(outcome.approved_max) || 0,
        };
      }

      return {
        policy_id: p.id,
        name: typeof p.name === 'string' ? p.name : p.id,
        policy_type: typeof p.policy_type === 'string' ? p.policy_type : 'unknown',
        active: Number(p.active) === 1 || p.active === true,
        created_at: toIso(p.created_at),
        updated_at: updatedIso,
        rules: parseRules(p.rules),
        window_days: windowDays,
        window_started_at: new Date(startMs).toISOString(),
        fired,
        approvals,
        override_rate: overrideRate,
        approved_risk_scores: approvedScores,
        last_fired_at: lastFired,
        fired_60d: Number(fired60[p.id]?.fired) || 0,
      };
    });
}

/**
 * The rule table. Each rule is pure and independently testable; raise and
 * keep are mutually exclusive by construction (override ≥ 0.9 cannot
 * coexist with denial ≥ 0.8). Explicit non-rules per the spec: no
 * tightening (the review feed owns that direction), nothing against
 * block-action policies (blocks produce no approval evidence by design).
 */
export function deriveProposals(stats: PolicyTuningStats[], options: DeriveOptions = {}): TuningProposal[] {
  const minFired = clampInt(options.minFired, 1, 100, TUNING_DEFAULTS.minFired);
  const minResolved = clampInt(options.minResolved, 1, 100, TUNING_DEFAULTS.minResolved);
  const now = options.now ?? new Date();
  const proposals: TuningProposal[] = [];

  for (const s of stats) {
    if (!s.active) continue;
    const resolved = s.approvals.approved + s.approvals.denied;
    const evidence = {
      window_days: s.window_days,
      window_started_at: s.window_started_at,
      fired: s.fired,
      approvals: s.approvals,
      override_rate: s.override_rate,
      ...(s.approved_risk_scores ? { approved_risk_scores: s.approved_risk_scores } : {}),
    };

    // raise_risk_threshold — the policy interrupts and humans almost always
    // wave it through: the threshold sits below where this org actually
    // draws the line.
    if (
      s.policy_type === 'risk_threshold' &&
      s.rules.action === 'require_approval' &&
      s.fired.require_approval >= minFired &&
      resolved >= minResolved &&
      s.override_rate != null &&
      s.override_rate >= TUNING_DEFAULTS.raiseOverrideRate
    ) {
      const current = Number(s.rules.threshold ?? 80);
      const next = Math.min(current + TUNING_DEFAULTS.thresholdStep, TUNING_DEFAULTS.thresholdCap);
      if (next > current) {
        proposals.push({
          id: fingerprint(s.policy_id, 'raise_risk_threshold', { from: current, to: next }),
          rule: 'raise_risk_threshold',
          policy_id: s.policy_id,
          policy_name: s.name,
          policy_type: s.policy_type,
          severity: 'actionable',
          title: `Raise risk threshold ${current} → ${next}`,
          summary:
            `Interrupted ${s.fired.require_approval}× in the last ${s.window_days} days; ` +
            `${s.approvals.approved} approved, ${s.approvals.denied} denied ` +
            `(${pct(s.override_rate)} overridden).`,
          evidence,
          patch: { rules: { ...s.rules, threshold: next } },
        });
        continue;
      }
    }

    // keep_policy — interruptions are mostly denied: evidence the policy
    // catches real problems. Informational endorsement, nothing to apply.
    if (s.fired.require_approval >= minFired && resolved >= minResolved) {
      const denialRate = s.approvals.denied / resolved;
      if (denialRate >= TUNING_DEFAULTS.keepDenialRate) {
        proposals.push({
          id: fingerprint(s.policy_id, 'keep_policy', {}),
          rule: 'keep_policy',
          policy_id: s.policy_id,
          policy_name: s.name,
          policy_type: s.policy_type,
          severity: 'informational',
          title: `Keep "${s.name}" — it is working`,
          summary:
            `${s.approvals.denied} of ${resolved} resolved interruptions were denied ` +
            `(${pct(denialRate)}) — evidence this policy catches real problems.`,
          evidence,
        });
        continue;
      }
    }

    // dead_policy — active for 60+ days, zero matches in the last 60.
    if (s.created_at) {
      const ageDays = Math.floor((now.getTime() - new Date(s.created_at).getTime()) / 86_400_000);
      if (ageDays >= TUNING_DEFAULTS.deadPolicyDays && s.fired_60d === 0) {
        proposals.push({
          id: fingerprint(s.policy_id, 'dead_policy', {}),
          rule: 'dead_policy',
          policy_id: s.policy_id,
          policy_name: s.name,
          policy_type: s.policy_type,
          severity: 'informational',
          title: `"${s.name}" has never fired recently`,
          summary:
            `Active for ${ageDays} days with zero matches in the last ` +
            `${TUNING_DEFAULTS.deadPolicyDays} — confirm it is still needed.`,
          evidence,
        });
      }
    }
  }

  return proposals;
}

export function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number.parseInt(String(value), 10);
  if (!Number.isFinite(n) || Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
