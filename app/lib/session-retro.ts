/**
 * Session retro — "was I manipulated" (owner roadmap v2.5, Advocate v2b).
 *
 * Pure shaping — no IO. Rolls the per-action agent_defense rollup up across
 * every action attributed to a session and adds the session-level detectors
 * (goal drift, risk spike, spend anomalies) that no single action can see.
 * Spec: docs/superpowers/specs/2026-07-02-session-retro-design.md — the
 * detector table there is the contract; thresholds are copied verbatim.
 *
 * Honesty rule (inherited from agent-defense.ts, carried up a level): an
 * ungoverned action lowers coverage, it never fabricates a "clean". Posture
 * is derived purely from finding severities — no invented score.
 */

import { buildAgentDefense } from './agent-defense';

type Row = Record<string, any>;

export type RetroSeverity = 'low' | 'medium' | 'high';
export type RetroPosture = 'clean' | 'review' | 'flagged';

export interface RetroFinding {
  kind: 'injection' | 'non_fabrication' | 'goal_drift' | 'risk_spike' | 'spend' | 'intervention' | 'assumption';
  severity: RetroSeverity;
  action_id: string | null;
  guard_decision_id: string | null;
  summary: string;
  evidence: Record<string, unknown>;
}

export interface SessionRetroData {
  session: Row;
  actions: Row[]; // chronological ASC — drift/novelty detectors depend on order
  actionsTotal: number;
  decisions: Row[];
  assumptions: Row[];
  purchases: Row[];
}

export interface SessionRetro {
  session: {
    id: string; agent_id: string | null; status: string | null;
    created_at: unknown; ended_at: unknown; action_count: number;
  };
  posture: RetroPosture;
  counts: { high: number; medium: number; low: number };
  coverage: {
    actions_total: number; actions_analyzed: number;
    actions_with_guard_decision: number; actions_with_shields_recorded: number;
  };
  goal_timeline: Array<{ goal: string; first_action_id: string | null; action_count: number }>;
  findings: RetroFinding[];
  spend: { total: number; currency: string | null; purchases: number } | null;
}

// Mirrors TERMINAL_STATUSES in app/lib/sessions.ts (not imported to keep this
// module dependency-free of the DB layer for unit testing).
const TERMINAL = new Set(['finished', 'failed', 'closed', 'completed', 'cancelled']);

const DRIFT_RISK_FLOOR = 40;
const SPIKE_RISK_FLOOR = 70;
const SPIKE_MEDIAN_MULTIPLE = 2;
const LATE_NOVEL_MIN_PRIOR = 5;
const OUTLIER_MEDIAN_MULTIPLE = 5;
const OUTLIER_MIN_PURCHASES = 3;
// Canonical "spend that counted" predicate — matches sumWindowSpend in
// app/lib/repositories/x402.repository.ts.
const SPEND_EXCLUDED = new Set(['failed', 'denied', 'expired']);

function normalizeGoal(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const s = value.toLowerCase().trim().replace(/\s+/g, ' ');
  return s.length > 0 ? s : null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  // Non-null assertions: mid is always a valid index once length > 0 is
  // established above; tsconfig's noUncheckedIndexedAccess can't see that.
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function riskOf(action: Row): number | null {
  const n = Number(action.risk_score);
  return Number.isFinite(n) ? n : null;
}

export function buildSessionRetro(data: SessionRetroData): SessionRetro {
  const { session, actions, actionsTotal, decisions, assumptions, purchases } = data;

  const decisionsById = new Map<string, Row>();
  for (const d of decisions) if (d?.id) decisionsById.set(String(d.id), d);
  const assumptionsByAction = new Map<string, Row[]>();
  for (const a of assumptions) {
    const key = String(a?.action_id ?? '');
    if (!key) continue;
    const list = assumptionsByAction.get(key) ?? [];
    list.push(a);
    assumptionsByAction.set(key, list);
  }

  const findings: RetroFinding[] = [];
  const add = (f: RetroFinding) => findings.push(f);

  // Session baselines (computed over the analyzed window).
  const riskValues = actions.map(riskOf).filter((n): n is number => n != null);
  const medianRisk = median(riskValues);
  const firstGoal = actions.map((a) => normalizeGoal(a.declared_goal)).find((g) => g != null) ?? null;

  // Per-action detectors, in chronological order.
  const seenTypes = new Set<string>();
  let withDecision = 0;
  let withShields = 0;
  const timeline: SessionRetro['goal_timeline'] = [];
  const timelineIndex = new Map<string, number>();

  actions.forEach((action, index) => {
    const actionId = typeof action.action_id === 'string' ? action.action_id : null;
    const gdId = typeof action.guard_decision_id === 'string' ? action.guard_decision_id : null;
    const linked = gdId ? (decisionsById.get(gdId) ?? null) : null;
    const defense = buildAgentDefense(action, linked, assumptionsByAction.get(actionId ?? '') ?? []);
    const risk = riskOf(action);

    if (defense.decision.linked) withDecision += 1;
    if (defense.shields.prompt_injection.status !== 'not_recorded') withShields += 1;

    // 1 / 1b — injection shield
    const inj = defense.shields.prompt_injection.status;
    if (inj === 'warned' || inj === 'blocked') {
      add({
        kind: 'injection', severity: inj === 'blocked' ? 'high' : 'medium',
        action_id: actionId, guard_decision_id: gdId,
        summary: `prompt-injection shield ${inj} this action`,
        evidence: { shield_status: inj },
      });
    }

    // 2 — non-fabrication block
    if (defense.shields.non_fabrication.evaluated && defense.shields.non_fabrication.verdict === 'block') {
      add({
        kind: 'non_fabrication', severity: 'high',
        action_id: actionId, guard_decision_id: gdId,
        summary: 'non-fabrication shield returned a block verdict',
        evidence: { violations: defense.shields.non_fabrication.violations },
      });
    }

    // 6 — intervention (block decision)
    if (defense.decision.linked && defense.decision.decision === 'block') {
      add({
        kind: 'intervention', severity: 'medium',
        action_id: actionId, guard_decision_id: gdId,
        summary: 'guard blocked this action',
        evidence: { matched_policies: defense.decision.matched_policies, reason: defense.decision.reason },
      });
    }

    // 3a / 3b — goal drift vs the session's first declared goal
    const goal = normalizeGoal(action.declared_goal);
    if (goal == null && risk != null && risk >= DRIFT_RISK_FLOOR) {
      add({
        kind: 'goal_drift', severity: 'low',
        action_id: actionId, guard_decision_id: gdId,
        summary: `no declared goal on an action with risk ${risk}`,
        evidence: { rule: 'missing_declared_goal', risk_score: risk },
      });
    } else if (goal != null && firstGoal != null && goal !== firstGoal && risk != null && risk >= DRIFT_RISK_FLOOR) {
      add({
        kind: 'goal_drift', severity: 'medium',
        action_id: actionId, guard_decision_id: gdId,
        summary: 'acted outside the session\'s initial declared goal',
        evidence: { rule: 'goal_divergence', declared_goal: action.declared_goal, initial_goal: firstGoal, risk_score: risk },
      });
    }

    // 3c — late novel action type
    const type = typeof action.action_type === 'string' ? action.action_type : '';
    if (type && !seenTypes.has(type)) {
      seenTypes.add(type);
      const escalates = (risk != null && risk >= SPIKE_RISK_FLOOR) || type === 'x402_purchase';
      if (index >= LATE_NOVEL_MIN_PRIOR && escalates) {
        add({
          kind: 'goal_drift', severity: 'medium',
          action_id: actionId, guard_decision_id: gdId,
          summary: `first '${type}' of the session appeared after ${index} prior actions`,
          evidence: { rule: 'late_novel_type', action_type: type, prior_actions: index, risk_score: risk },
        });
      }
    }

    // 4 — risk spike vs session median
    if (risk != null && medianRisk != null && risk >= SPIKE_RISK_FLOOR && risk >= SPIKE_MEDIAN_MULTIPLE * medianRisk) {
      add({
        kind: 'risk_spike', severity: 'medium',
        action_id: actionId, guard_decision_id: gdId,
        summary: `risk ${risk} vs session median ${medianRisk}`,
        evidence: { risk_score: risk, session_median: medianRisk },
      });
    }

    // Goal timeline (informational, distinct normalized goals in order).
    if (goal != null) {
      const at = timelineIndex.get(goal);
      if (at == null) {
        timelineIndex.set(goal, timeline.length);
        timeline.push({ goal: String(action.declared_goal).trim(), first_action_id: actionId, action_count: 1 });
      } else {
        // Safe: `at` came from timelineIndex, which only ever stores indices
        // already pushed into `timeline` above.
        timeline[at]!.action_count += 1;
      }
    }
  });

  // 5a / 5b — spend anomalies
  const amounts = purchases.map((p) => Number(p.spend_amount)).filter((n) => Number.isFinite(n));
  const medianPurchase = median(amounts);
  for (const p of purchases) {
    const amount = Number(p.spend_amount);
    const status = typeof p.execution_status === 'string' ? p.execution_status : null;
    const actionId = typeof p.action_id === 'string' ? p.action_id : null;
    if (status === 'denied' || status === 'expired') {
      add({
        kind: 'spend', severity: 'medium',
        action_id: actionId, guard_decision_id: null,
        summary: `purchase ${status} (${Number.isFinite(amount) ? amount : '?'} ${p.currency ?? ''})`.trim(),
        evidence: { rule: 'purchase_denied_or_expired', execution_status: status, amount: Number.isFinite(amount) ? amount : null },
      });
    }
    if (
      purchases.length >= OUTLIER_MIN_PURCHASES && medianPurchase != null && medianPurchase > 0 &&
      Number.isFinite(amount) && amount >= OUTLIER_MEDIAN_MULTIPLE * medianPurchase
    ) {
      add({
        kind: 'spend', severity: 'medium',
        action_id: actionId, guard_decision_id: null,
        summary: `purchase of ${amount} is ≥${OUTLIER_MEDIAN_MULTIPLE}× the session median (${medianPurchase})`,
        evidence: { rule: 'outlier_amount', amount, session_median: medianPurchase },
      });
    }
  }

  // 7 — assumptions later invalidated (the alibi angle: the agent acted on
  // then-valid information; record when the ground truth shifted).
  for (const a of assumptions) {
    if (a.invalidated === 1 || a.invalidated === true || a.invalidated === '1') {
      add({
        kind: 'assumption', severity: 'low',
        action_id: typeof a.action_id === 'string' ? a.action_id : null, guard_decision_id: null,
        summary: 'an assumption this session acted on was later invalidated',
        evidence: {
          assumption_id: a.assumption_id ?? null, assumption: a.assumption ?? null,
          invalidated_reason: a.invalidated_reason ?? null, invalidated_at: a.invalidated_at ?? null,
        },
      });
    }
  }

  const counts = { high: 0, medium: 0, low: 0 };
  for (const f of findings) counts[f.severity] += 1;
  const posture: RetroPosture = counts.high > 0 ? 'flagged' : findings.length > 0 ? 'review' : 'clean';

  const countedSpend = purchases.filter((p) => !SPEND_EXCLUDED.has(String(p.execution_status)));
  const spendTotal = countedSpend.reduce((sum, p) => sum + (Number(p.spend_amount) || 0), 0);

  return {
    session: {
      id: String(session.id ?? ''),
      agent_id: typeof session.agent_id === 'string' ? session.agent_id : null,
      status: typeof session.status === 'string' ? session.status : null,
      created_at: session.created_at ?? null,
      ended_at: TERMINAL.has(String(session.status)) ? (session.updated_at ?? null) : null,
      action_count: actionsTotal,
    },
    posture,
    counts,
    coverage: {
      actions_total: actionsTotal,
      actions_analyzed: actions.length,
      actions_with_guard_decision: withDecision,
      actions_with_shields_recorded: withShields,
    },
    goal_timeline: timeline,
    findings,
    spend: purchases.length > 0
      ? { total: Math.round(spendTotal * 100) / 100, currency: (countedSpend[0]?.currency ?? purchases[0]?.currency ?? null) as string | null, purchases: purchases.length }
      : null,
  };
}
