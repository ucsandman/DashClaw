/**
 * Server-side risk scoring: the per-action heuristic, the org risk-template
 * fold, and the full derivation ledger (RiskBreakdown) persisted with every
 * decision.
 */

import type { GuardSql, GuardEvalContext } from './types';
import { loadOrgRiskTemplates } from './caches';
import { computeAutoRisk } from './riskTemplates';

const ACTION_TYPE_BASE_SCORES = {
  deploy: 75, security: 80, migrate: 70, apply: 60, sync: 40,
  api: 35, build: 25, fix: 20, refactor: 20, test: 15,
  config: 30, monitor: 10, alert: 10, cleanup: 30, post: 25,
  message: 15, calendar: 10, research: 10, review: 10, other: 20,
} as const;
const baseScore = (t: unknown): number =>
  (typeof t === 'string' ? (ACTION_TYPE_BASE_SCORES as Record<string, number>)[t] : undefined) ?? ACTION_TYPE_BASE_SCORES.other;

const HIGH_RISK_SYSTEMS = ['production', 'database', 'postgres', 'neon', 'redis'];
const MODERATE_RISK_SYSTEMS = ['filesystem', 'shell'];
// Word-bounded: the old unanchored substrings flipped scores on wording alone
// ('monkey' matched /key/ +15, 'pushback' matched /push/ +10, 'formatting'
// matched /format/ +20) — a top source of the "risk looks random" perception.
// 'format' additionally rejects flag forms: punctuation satisfies \b, so
// `--format=""` scored +20 on read-only commands (calibration vector
// git-show-format-flag). Prose ("format the disk") still matches.
const DESTRUCTIVE_GOAL_PATTERNS = /rm\s+-rf|drop\s+table|delete\s+from|\btruncate\b|(?<!-)\bformat\b|\bwipe\b/i;
const DEPLOYMENT_GOAL_PATTERNS = /\bpush(?:es|ed|ing)?\b|\bdeploy|\brelease|\bship(?:s|ped|ping)?\b|\bmigrat/i;
const SECRET_GOAL_PATTERNS = /\bsecrets?\b|\bcredentials?\b|\bpasswords?\b|\btokens?\b|\bkeys?\b|\.env\b/i;

/** One additive term of the server-side risk formula. */
export interface RiskFactor {
  factor: string;
  delta: number;
}

// Additional risk from the systems an action touches (high vs moderate tiers).
function systemsTouchedFactors(systemsTouched: unknown): RiskFactor[] {
  if (!Array.isArray(systemsTouched)) return [];
  const systems = systemsTouched.map((s) => (typeof s === 'string' ? s.toLowerCase() : ''));
  const factors: RiskFactor[] = [];
  const high = systems.find((s) => HIGH_RISK_SYSTEMS.includes(s));
  if (high) factors.push({ factor: `systems:${high}`, delta: 10 });
  const moderate = systems.find((s) => MODERATE_RISK_SYSTEMS.includes(s));
  if (moderate) factors.push({ factor: `systems:${moderate}`, delta: 5 });
  return factors;
}

// Additional risk from destructive/deployment/secret patterns in the declared goal.
function declaredGoalFactors(declaredGoal: unknown): RiskFactor[] {
  if (typeof declaredGoal !== 'string') return [];
  const factors: RiskFactor[] = [];
  if (DESTRUCTIVE_GOAL_PATTERNS.test(declaredGoal)) factors.push({ factor: 'goal:destructive-pattern', delta: 20 });
  if (DEPLOYMENT_GOAL_PATTERNS.test(declaredGoal)) factors.push({ factor: 'goal:deployment-pattern', delta: 10 });
  if (SECRET_GOAL_PATTERNS.test(declaredGoal)) factors.push({ factor: 'goal:secret-pattern', delta: 15 });
  return factors;
}

// The shared term computation behind computeRiskScore and the breakdown.
// NOTE: this is the per-action guard heuristic — unrelated to reputation.ts's
// computeRiskScore (a decay-weighted mean of these persisted values).
export function serverRiskTerms(context: GuardEvalContext): { base: { action_type: string; score: number }; modifiers: RiskFactor[]; total: number } {
  const base = { action_type: typeof context.action_type === 'string' ? context.action_type : 'other', score: baseScore(context.action_type) };
  const modifiers: RiskFactor[] = [];
  if (context.reversible === false) modifiers.push({ factor: 'irreversible', delta: 15 });
  modifiers.push(...systemsTouchedFactors(context.systems_touched));
  modifiers.push(...declaredGoalFactors(context.declared_goal));
  const total = Math.max(0, Math.min(base.score + modifiers.reduce((s, m) => s + m.delta, 0), 100));
  return { base, modifiers, total };
}

/**
 * Compute an authoritative risk score from structured guard context fields.
 * Returns an integer 0-100.
 */
export function computeRiskScore(context: GuardEvalContext): number {
  return serverRiskTerms(context).total;
}

// Server-computed risk FLOOR: use the higher of server-computed vs
// agent-reported (agents may have internal knowledge). NOT fact-checking —
// the server score derives from client-declared descriptors (action_type,
// systems_touched, reversible...), so max() guarantees the declared risk
// number can only raise the score, never that the declarations are true.
// The trust boundary is documented in docs/architecture/trust-and-failure-model.md (D1).
export function computeEffectiveRisk(context: GuardEvalContext): { agentRiskScore: number | null; effectiveRiskScore: number } {
  const authoritativeRiskScore = computeRiskScore(context);
  const agentRiskScore = context.risk_score != null ? Number(context.risk_score) : null;
  const effectiveRiskScore = agentRiskScore != null
    ? Math.max(authoritativeRiskScore, Math.max(0, Math.min(agentRiskScore, 100)))
    : authoritativeRiskScore;
  return { agentRiskScore, effectiveRiskScore };
}

/**
 * Evidence-derived risk sibling: the score the server classified from the
 * caller-attached act. A SIBLING term of the breakdown — it folds into
 * `effective` via max (evidence only RAISES) but never enters any hashed or
 * signed vector (score-provenance invariant).
 */
export interface EvidenceDerivedBreakdown {
  derived_action_type: string;
  base_risk: number;
  modifiers: { reason: string; delta: number }[];
  total: number;
  mismatch: boolean;
  /**
   * The act classifier's own tags for this call (`regenerable_artifact`,
   * `destructive`, `protected_target`, `remote_exec`, …). The server already
   * computes these to grade the act and then discarded them; keeping them is
   * what lets a decision record WHAT KIND of act was graded rather than only
   * the number it produced.
   *
   * Sibling term, exactly like the rest of this interface: it folds into the
   * effective score via max() and NEVER enters any hashed or signed vector
   * (score-provenance invariant, see the note above `EvidenceDerivedBreakdown`).
   */
  flags: string[];
}

/** Full derivation ledger for one guard evaluation's risk score. */
export interface RiskBreakdown {
  /** Server heuristic: action-type base score. */
  base: { action_type: string; score: number };
  /** Additive server modifiers (irreversible, systems, goal patterns). */
  modifiers: RiskFactor[];
  /** Server heuristic total (base + modifiers, clamped 0-100). */
  server_total: number;
  /** Org risk-template layer (null when no active template matches). */
  template: { id: string; name: string; score: number } | null;
  /** Agent-reported risk_score from the request (null when absent). */
  client_reported: number | null;
  /** max(server_total, template.score, client_reported) — pre-predictive. */
  effective: number;
  /**
   * Predictive history adjustment (null when disabled/unavailable).
   * `adjustment` is the applied total; `statistical_adjustment` + `llm` split
   * it so forensics never have to infer the LLM term by subtraction.
   */
  predictive: {
    adjustment: number;
    basis?: string;
    failure_rate?: number;
    total_actions?: number;
    velocity?: number;
    statistical_adjustment?: number;
    llm?: { adjustment: number; model: string; reasoning: string } | null;
    /** Why the LLM amplifier didn't run when its trigger fired (v2.1). */
    llm_skipped?: string;
  } | null;
  /** The persisted guard_decisions.risk_score (effective + predictive, clamped). */
  final: number;
  /** Evidence-derived sibling term (null when no valid act was classified). */
  evidence_derived?: EvidenceDerivedBreakdown | null;
}

// Coerce a risk_templates row into computeAutoRisk's template shape (rules is
// jsonb — object from Neon, string from some drivers/tests).
function coerceRiskTemplate(row: Record<string, unknown>): { status: string; action_type: string | null; base_risk: number; rules: Array<{ condition: string; add: number }>; id: string; name: string } {
  let rules: unknown = row.rules;
  if (typeof rules === 'string') {
    try { rules = JSON.parse(rules); } catch { rules = []; }
  }
  return {
    id: String(row.id),
    name: String(row.name ?? ''),
    status: String(row.status ?? 'active'),
    action_type: (row.action_type as string | null) ?? null,
    base_risk: Number(row.base_risk) || 0,
    rules: Array.isArray(rules) ? (rules as Array<{ condition: string; add: number }>) : [],
  };
}

// Effective risk including the org risk-template layer (the /scoring "Risk
// Templates" tab — previously a dead wire). Templates can only RAISE the
// effective score (folded via max), so an org with no templates is untouched.
export async function computeRiskAssessment(
  sql: GuardSql,
  orgId: string,
  context: GuardEvalContext,
  evidenceDerived?: EvidenceDerivedBreakdown | null,
): Promise<{ agentRiskScore: number | null; effectiveRiskScore: number; breakdownBase: Omit<RiskBreakdown, 'predictive' | 'final'> }> {
  const terms = serverRiskTerms(context);
  const { agentRiskScore } = computeEffectiveRisk(context);

  let template: RiskBreakdown['template'] = null;
  try {
    const rows = await loadOrgRiskTemplates(sql, orgId);
    if (rows.length > 0) {
      const templates = rows.map(coerceRiskTemplate);
      const result = computeAutoRisk(context as Parameters<typeof computeAutoRisk>[0], templates);
      if (result != null) {
        // Attribute to the SAME template computeAutoRisk matched — do not
        // re-derive the match here (that independently-searched selection
        // could disagree with the one that actually produced the score,
        // and the persisted audit trail would name the loser).
        template = { id: String(result.template.id ?? ''), name: String(result.template.name ?? ''), score: result.score };
      }
    }
  } catch (err) {
    console.warn('[Guard] risk-template evaluation failed (continuing without):', (err as Error).message);
  }

  const clientClamped = agentRiskScore != null ? Math.max(0, Math.min(agentRiskScore, 100)) : null;
  // Evidence folds in like templates and client-reported: max only, so it can
  // only RAISE the effective score (trust-model D1).
  const effectiveRiskScore = Math.max(
    terms.total,
    template?.score ?? 0,
    clientClamped ?? 0,
    evidenceDerived?.total ?? 0,
  );

  return {
    agentRiskScore,
    effectiveRiskScore,
    breakdownBase: {
      base: terms.base,
      modifiers: terms.modifiers,
      server_total: terms.total,
      template,
      client_reported: clientClamped,
      effective: effectiveRiskScore,
      evidence_derived: evidenceDerived ?? null,
    },
  };
}
