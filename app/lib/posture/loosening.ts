// Loosening-proposal engine (roadmap v4.5: proposals that relax).
// Spec: docs/superpowers/specs/2026-07-05-loosening-direction.md
//
// Pure, rule-based, no LLM — the v3.2 tightening mirror. Tightening's
// evidence is ungoverned allows; loosening's is governed interrupts humans
// almost always wave through. The tuning engine already owns one relaxation
// (raise_risk_threshold, risk_threshold policies only); this module owns the
// policy types tuning explicitly cannot touch — require_approval envelopes
// (the type every tightening ratify creates), protected_path, rate_limit —
// at two grains: carve one always-approved action type out of an envelope,
// or deactivate a policy whose interrupts are always overridden.

import { createHash } from 'crypto';
import {
  normalizeFlags,
  precedentKey,
  precedentEligible,
  PRECEDENT_TTL_DAYS,
} from '../policy-shapes';
import { TUNING_DEFAULTS } from '../policy-tuning/engine';

export const RELAX_RULE = 'relax_policy_scope';
export const DEACTIVATE_RULE = 'deactivate_policy';
/** Interruption budget: a policy interrupting far past a sustainable rate is
 *  reported as a defect on VOLUME ALONE. See INTERRUPTION_BUDGET_DEFAULTS. */
export const BUDGET_RULE = 'over_interruption_budget';
/** Precedent: a shape the operator has personally waved through, repeatedly,
 *  across days, becomes a narrow standing grant. See PRECEDENT_DEFAULTS. */
export const PRECEDENT_RULE = 'precedent_grant';
export type LooseningRule =
  | typeof RELAX_RULE
  | typeof DEACTIVATE_RULE
  | typeof PRECEDENT_RULE
  | typeof BUDGET_RULE;

export const LOOSENING_DEFAULTS = {
  /** Override rate at or above which relaxation is proposed. Stricter than
   *  tuning's 0.9 raise bar: these patches remove governance, not move a dial. */
  relaxOverrideRate: 0.95,
  /** Minimum require_approval interruptions in the window (per grain). */
  minFired: 10,
  /** Minimum resolved (approved + denied) outcomes before rates mean anything. */
  minResolved: 5,
} as const;

/** Content-stable id (the tp_ pattern): independent of which decision ids
 *  populate the window, so a dismissed pattern stays dismissed. */
export function looseningProposalId(
  rule: LooseningRule,
  policyId: string,
  actionType = '',
): string {
  return (
    'lp_' +
    createHash('sha256')
      .update(`${rule}\n${policyId}\n${actionType}`)
      .digest('hex')
      .slice(0, 16)
  );
}

/** Raw per-(policy, action_type) row from getInterruptOutcomesByPolicyAction. */
export interface InterruptOutcomeRow {
  policy_id: unknown;
  action_type: unknown; // '' for untyped decisions (COALESCEd in SQL)
  fired: unknown;
  approved: unknown;
  denied: unknown;
  pending: unknown;
  example_decision_ids?: unknown;
}

/** Active guard-policy row (getActivePolicies returns full rows). */
export interface LooseningPolicyRow {
  id?: unknown;
  name?: unknown;
  policy_type?: unknown;
  rules?: unknown; // JSON string in guard_policies; tolerate parsed objects
  updated_at?: unknown;
  [field: string]: unknown;
}

export interface LooseningProposal {
  id: string;
  rule: LooseningRule;
  policy_id: string;
  policy_name: string;
  policy_type: string;
  /** The carved-out action type (relax_policy_scope only). */
  action_type: string | null;
  title: string;
  summary: string;
  evidence: {
    window_days: number;
    window_started_at: string;
    fired: number;
    approvals: { approved: number; denied: number; pending: number };
    override_rate: number;
    example_decision_ids: string[];
  };
  /** Display only — the server rebuilds the change from current rules on
   *  ratify; the client-sent patch is never trusted. */
  patch:
    | { rules: Record<string, unknown> }
    | { active: false };
}

export interface DeriveLooseningOptions {
  windowDays: number;
  minFired?: number;
  minResolved?: number;
  relaxOverrideRate?: number;
  /** Injectable clock for tests. */
  now?: Date;
}

// The one relaxation direction tuning already owns. Loosening never
// double-queues a risk_threshold policy to the same human (v4.4 thesis).
const TUNING_OWNED_POLICY_TYPES = new Set(['risk_threshold']);

/**
 * Does the tuning engine actually have a move available on this policy?
 *
 * "Tuning owns risk_threshold" was true as a division of labour and false as a
 * guarantee of coverage. Tuning's only relaxation is raise_risk_threshold, and
 * it computes `next = min(threshold + step, thresholdCap)` then requires
 * `next > current` (policy-tuning/engine.ts). A policy at or above the cap
 * therefore yields `next <= current` and is silently skipped — by tuning
 * because the arithmetic gives it nothing to propose, and by loosening because
 * it deferred to tuning. The org's threshold-100 rule fell in that seam and no
 * engine on either side could ever offer relief for it.
 *
 * 2026-08-16 incident: that seam is where 1,759 interruptions in seven days
 * went unanswered, and it is the direct reason the operator disabled the whole
 * policy set. Loosening now claims any risk_threshold policy tuning cannot move.
 */
export function tuningCanMove(policyType: string, rules: Record<string, unknown>): boolean {
  if (!TUNING_OWNED_POLICY_TYPES.has(policyType)) return false;
  const current = Number(rules.threshold ?? 80);
  if (!Number.isFinite(current)) return false;
  return Math.min(current + TUNING_DEFAULTS.thresholdStep, TUNING_DEFAULTS.thresholdCap) > current;
}

function pct(rate: number): string {
  return `${Math.round(rate * 1000) / 10}%`;
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

/** The policy's action_types envelope, or null when it has none. */
export function policyEnvelope(rules: Record<string, unknown>): string[] | null {
  const types = rules.action_types;
  if (!Array.isArray(types)) return null;
  const clean = types.filter((t): t is string => typeof t === 'string' && t.length > 0);
  return clean.length > 0 ? clean : null;
}

interface Grain {
  actionType: string;
  fired: number;
  approved: number;
  denied: number;
  pending: number;
  exampleIds: string[];
}

function toGrain(row: InterruptOutcomeRow): Grain {
  const ids = Array.isArray(row.example_decision_ids)
    ? row.example_decision_ids.map((v) => String(v ?? '')).filter(Boolean)
    : [];
  return {
    actionType: row.action_type == null ? '' : String(row.action_type),
    fired: Number(row.fired) || 0,
    approved: Number(row.approved) || 0,
    denied: Number(row.denied) || 0,
    pending: Number(row.pending) || 0,
    exampleIds: ids.slice(0, 5),
  };
}

function qualifies(
  g: { fired: number; approved: number; denied: number },
  minFired: number,
  minResolved: number,
  bar: number,
): boolean {
  const resolved = g.approved + g.denied;
  return g.fired >= minFired && resolved >= minResolved && g.approved / resolved >= bar;
}

/**
 * Pure: derive loosening proposals from per-(policy, action_type) interrupt
 * outcomes and the org's active policies. Two rules:
 *
 *  - relax_policy_scope: within a policy's action_types envelope, one type's
 *    interrupts are ≥bar approved with volume — carve it out, keep the rest
 *    governed. Emitted only when something remains (a carve-out that empties
 *    the envelope is a deactivation wearing a smaller name).
 *  - deactivate_policy: the policy's interrupts as a whole are ≥bar approved
 *    with volume and no surgical carve-out applies.
 *
 * One proposal direction per policy: when carve-outs exist, deactivation is
 * not also proposed — the surgical fix wins the queue slot.
 */
export function deriveLooseningProposals(
  rows: InterruptOutcomeRow[],
  policies: LooseningPolicyRow[],
  opts: DeriveLooseningOptions,
): LooseningProposal[] {
  const minFired = Math.max(1, opts.minFired ?? LOOSENING_DEFAULTS.minFired);
  const minResolved = Math.max(1, opts.minResolved ?? LOOSENING_DEFAULTS.minResolved);
  const bar = opts.relaxOverrideRate ?? LOOSENING_DEFAULTS.relaxOverrideRate;
  const now = opts.now ?? new Date();
  const windowStartMs = now.getTime() - opts.windowDays * 86_400_000;

  const grainsByPolicy = new Map<string, Grain[]>();
  for (const row of rows) {
    if (typeof row.policy_id !== 'string' || !row.policy_id) continue;
    const list = grainsByPolicy.get(row.policy_id) ?? [];
    list.push(toGrain(row));
    grainsByPolicy.set(row.policy_id, list);
  }

  const proposals: LooseningProposal[] = [];

  for (const p of policies) {
    const policyId = typeof p.id === 'string' ? p.id : '';
    if (!policyId) continue;
    const policyType = typeof p.policy_type === 'string' ? p.policy_type : 'unknown';
    const rules = parseRules(p.rules);
    // Defer to tuning only where tuning actually has a move. A risk_threshold
    // policy at/above thresholdCap is unreachable by tuning's arithmetic, so
    // skipping it here would leave it unreachable by BOTH engines.
    if (tuningCanMove(policyType, rules)) continue;
    const grains = grainsByPolicy.get(policyId);
    if (!grains || grains.length === 0) continue;

    const policyName = typeof p.name === 'string' ? p.name : policyId;
    const envelope = policyEnvelope(rules);

    const updatedMs = p.updated_at == null ? NaN : new Date(p.updated_at as string | number | Date).getTime();
    const startMs = Number.isFinite(updatedMs) && updatedMs > windowStartMs ? updatedMs : windowStartMs;
    const windowStartedAt = new Date(startMs).toISOString();

    const totals = grains.reduce(
      (acc, g) => ({
        fired: acc.fired + g.fired,
        approved: acc.approved + g.approved,
        denied: acc.denied + g.denied,
        pending: acc.pending + g.pending,
        exampleIds: acc.exampleIds.concat(g.exampleIds),
      }),
      { fired: 0, approved: 0, denied: 0, pending: 0, exampleIds: [] as string[] },
    );

    const evidenceOf = (g: { fired: number; approved: number; denied: number; pending: number; exampleIds: string[] }) => ({
      window_days: opts.windowDays,
      window_started_at: windowStartedAt,
      fired: g.fired,
      approvals: { approved: g.approved, denied: g.denied, pending: g.pending },
      override_rate: g.approved / (g.approved + g.denied),
      example_decision_ids: g.exampleIds.slice(0, 5),
    });

    // Carve-out pass: only envelope types can be carved, and only while the
    // envelope keeps at least one governed type.
    const carvable = envelope
      ? grains.filter(
          (g) => g.actionType && envelope.includes(g.actionType) && qualifies(g, minFired, minResolved, bar),
        )
      : [];

    if (envelope && carvable.length > 0 && carvable.length < envelope.length) {
      for (const g of carvable) {
        const remaining = envelope.filter((t) => t !== g.actionType);
        const ev = evidenceOf(g);
        proposals.push({
          id: looseningProposalId(RELAX_RULE, policyId, g.actionType),
          rule: RELAX_RULE,
          policy_id: policyId,
          policy_name: policyName,
          policy_type: policyType,
          action_type: g.actionType,
          title: `Stop interrupting "${g.actionType}" — always approved`,
          summary:
            `"${policyName}" interrupted "${g.actionType}" ${g.fired}× in the last ` +
            `${opts.windowDays} days; ${g.approved} approved, ${g.denied} denied ` +
            `(${pct(ev.override_rate)} overridden). Remove it from the policy's action types.`,
          evidence: ev,
          patch: { rules: { ...rules, action_types: remaining } },
        });
      }
      continue;
    }

    // Deactivation pass: the whole policy is waved through — no surgical fix
    // exists (no envelope, or carving would empty it).
    if (qualifies(totals, minFired, minResolved, bar)) {
      const ev = evidenceOf(totals);
      proposals.push({
        id: looseningProposalId(DEACTIVATE_RULE, policyId),
        rule: DEACTIVATE_RULE,
        policy_id: policyId,
        policy_name: policyName,
        policy_type: policyType,
        action_type: null,
        title: `Deactivate "${policyName}" — its interrupts are always approved`,
        summary:
          `${totals.fired} interruptions in the last ${opts.windowDays} days; ` +
          `${totals.approved} approved, ${totals.denied} denied ` +
          `(${pct(ev.override_rate)} overridden).`,
        evidence: ev,
        patch: { active: false },
      });
    }
  }

  return proposals.sort(
    (a, b) =>
      b.evidence.approvals.approved + b.evidence.approvals.denied -
        (a.evidence.approvals.approved + a.evidence.approvals.denied) ||
      a.id.localeCompare(b.id),
  );
}

// ── Precedent proposals ─────────────────────────────────────────────────────
// The other two rules edit an existing policy. A precedent instead proposes a
// NEW, narrow allow_grant for a shape — (action_type, exact server-computed
// evidence flag set) — that the operator has personally approved again and
// again. It is the tournament's winning design, and its safety comes almost
// entirely from policy-shapes.ts: a closed eligibility allowlist, exact flag-set
// equality, and a scope the governed agent cannot author.
//
// The gates below are deliberately stricter than the relax/deactivate bar. A
// precedent creates standing authority rather than trimming existing authority,
// so it needs repetition (minApprovals), persistence across sessions
// (minDistinctDays — five approvals in one frantic hour is one decision, not
// five), and an unblemished record (maxDenials: a single deny means the operator
// does NOT always want this, and the shape stops being proposed).

export const PRECEDENT_DEFAULTS = {
  /** Distinct human approvals of the shape required before proposing. */
  minApprovals: 5,
  /** Distinct CALENDAR DAYS those approvals span. Stops one bad session
   *  from minting standing authority. */
  minDistinctDays: 2,
  /** Any denial at all disqualifies the shape. */
  maxDenials: 0,
} as const;

/** Raw per-(action_type, flag set) row from getPrecedentOutcomes. */
export interface PrecedentOutcomeRow {
  action_type: unknown;
  flags: unknown; // jsonb array of strings
  approved: unknown;
  denied: unknown;
  distinct_days: unknown;
  example_decision_ids?: unknown;
}

export interface PrecedentProposal {
  id: string;
  rule: typeof PRECEDENT_RULE;
  /** Always null: a precedent creates a grant, it does not edit a policy. */
  policy_id: null;
  policy_name: null;
  policy_type: 'allow_grant';
  action_type: string;
  precedent_flags: string[];
  precedent_key: string;
  ttl_days: number;
  title: string;
  summary: string;
  evidence: {
    window_days: number;
    approved: number;
    denied: number;
    distinct_days: number;
    example_decision_ids: string[];
  };
}

/** Content-stable id, same lp_ shape the route's PROPOSAL_ID_RE accepts. */
export function precedentProposalId(actionType: string, flags: string[]): string {
  return (
    'lp_' +
    createHash('sha256')
      .update(`${PRECEDENT_RULE}\n${precedentKey(actionType, flags)}`)
      .digest('hex')
      .slice(0, 16)
  );
}

export interface DerivePrecedentOptions {
  windowDays: number;
  minApprovals?: number;
  minDistinctDays?: number;
  maxDenials?: number;
}

/**
 * Pure: mine adjudicated approvals for shapes that have earned a precedent.
 *
 * Every gate here is a REJECTION gate — a shape must clear eligibility, volume,
 * spread and a clean record. Nothing in this function can widen what
 * precedentEligible() allows; it can only decline to propose.
 */
export function derivePrecedentProposals(
  rows: PrecedentOutcomeRow[],
  opts: DerivePrecedentOptions,
): PrecedentProposal[] {
  const minApprovals = Math.max(1, opts.minApprovals ?? PRECEDENT_DEFAULTS.minApprovals);
  const minDays = Math.max(1, opts.minDistinctDays ?? PRECEDENT_DEFAULTS.minDistinctDays);
  const maxDenials = Math.max(0, opts.maxDenials ?? PRECEDENT_DEFAULTS.maxDenials);

  const out: PrecedentProposal[] = [];

  for (const row of rows) {
    const actionType = typeof row.action_type === 'string' ? row.action_type : '';
    if (!actionType) continue;

    const flags = normalizeFlags(row.flags);
    if (!flags) continue;

    // THE gate. A shape outside the closed allowlist can never be proposed,
    // however much evidence accumulates behind it.
    if (!precedentEligible(actionType, flags)) continue;

    const approved = Number(row.approved) || 0;
    const denied = Number(row.denied) || 0;
    const distinctDays = Number(row.distinct_days) || 0;

    if (denied > maxDenials) continue;
    if (approved < minApprovals) continue;
    if (distinctDays < minDays) continue;

    const exampleIds = Array.isArray(row.example_decision_ids)
      ? row.example_decision_ids.map((v) => String(v ?? '')).filter(Boolean).slice(0, 5)
      : [];

    out.push({
      id: precedentProposalId(actionType, flags),
      rule: PRECEDENT_RULE,
      policy_id: null,
      policy_name: null,
      policy_type: 'allow_grant',
      action_type: actionType,
      precedent_flags: flags,
      precedent_key: precedentKey(actionType, flags),
      ttl_days: PRECEDENT_TTL_DAYS,
      title: 'Stop asking about: deleting regenerable build artifacts',
      summary:
        `You approved this ${approved}× across ${distinctDays} days. Never denied. ` +
        `Covers recursive deletes of build output only — folders like dist, .next and ` +
        `node_modules, anything inside them, and OS temp scratch. Never your home ` +
        `directory, never secrets, never force pushes, never package installs. ` +
        `Expires in ${PRECEDENT_TTL_DAYS} days.`,
      evidence: {
        window_days: opts.windowDays,
        approved,
        denied,
        distinct_days: distinctDays,
        example_decision_ids: exampleIds,
      },
    });
  }

  return out.sort((a, b) => b.evidence.approved - a.evidence.approved || a.id.localeCompare(b.id));
}

// ── Interruption budget ─────────────────────────────────────────────────────
// The other three rules all gate on ADJUDICATED outcomes: `resolved >= 5` plus
// an override rate. That makes their evidence channel identical to the pain
// channel, so it dries up exactly when relief is most needed — the operator
// who is drowning is the one who stops clicking, and their silence reads as
// "no evidence" rather than "maximum evidence". The 2026-08-16 incident is the
// proof: 1,759 interruptions in seven days, ~zero resolutions, zero proposals
// from any engine, and the operator disabled the entire policy set.
//
// This rule reads the one signal that survives an operator who has given up:
// how often the policy fired. No join, no rate, no clicks.
//
// It is a DEFECT REPORT, not an authorization. Volume says a rule is
// miscalibrated; it never says the underlying act is safe. So the enforcement
// side (applyInterruptionBudget, guard/evaluate.ts) only ever demotes
// require_approval to `warn` — the action still lands in the ledger, still
// renders, and can still be reviewed after the fact. It never reaches `allow`,
// never touches `block`, and never demotes a rule the operator marked
// `ungrantable` (F1) — an attacker who can make a rule fire must not be able
// to disarm it by firing it.

export const INTERRUPTION_BUDGET_DEFAULTS = {
  /** Interruptions per rolling window past which a policy is over budget.
   *  ~2/hour sustained. Wes's org ran at 251/day against this. */
  perWindow: 50,
  /** Rolling evidence window. */
  windowHours: 24,
  /**
   * Per-COMMAND-SHAPE budget, the surgical sibling of perWindow. Far lower,
   * because it is far narrower: `git log` repeating 10× in a day is already
   * plainly routine, while a whole policy needs more evidence before its rate
   * is judged unlivable. Shape relief leaves the policy fully enforcing for
   * every other command it covers — the rule keeps working, one noisy verb
   * stops asking.
   */
  shapePerWindow: 10,
  /** How long one auto-demotion lasts before the policy re-asserts itself and
   *  has to earn the demotion again. Deliberately short: a demotion is a
   *  symptom report, and the posture must restore itself without anyone
   *  remembering (same self-healing contract as the approval pause). */
  demoteHours: 24,
} as const;

/** Raw per-policy volume row from getInterruptVolumeByPolicy. */
export interface InterruptVolumeRow {
  policy_id: unknown;
  fired: unknown;
  first_fired_at?: unknown;
  example_decision_ids?: unknown;
}

export interface BudgetProposal {
  id: string;
  rule: typeof BUDGET_RULE;
  policy_id: string;
  policy_name: string;
  policy_type: string;
  action_type: null;
  /** True when the guard is ALREADY auto-demoting this policy to warn. False
   *  when it is over budget but `ungrantable`, so nothing was demoted and the
   *  operator's click is the only way out. */
  auto_demoted: boolean;
  ungrantable: boolean;
  title: string;
  summary: string;
  evidence: {
    window_hours: number;
    budget: number;
    fired: number;
    /** fired / budget. 35.2 means it interrupted 35× its sustainable rate. */
    over_by: number;
    example_decision_ids: string[];
  };
  patch: { active: false };
}

export function budgetProposalId(policyId: string): string {
  return (
    'lp_' +
    createHash('sha256').update(`${BUDGET_RULE}\n${policyId}`).digest('hex').slice(0, 16)
  );
}

export interface DeriveBudgetOptions {
  windowHours?: number;
  budget?: number;
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/**
 * Pure: derive interruption-budget proposals from per-policy volume and the
 * org's active policies.
 *
 * Rejection-only, like every other derive* here — it cannot widen anything, it
 * can only decline to report. A budget of 0 disables the rule entirely.
 */
export function deriveBudgetProposals(
  rows: InterruptVolumeRow[],
  policies: LooseningPolicyRow[],
  opts: DeriveBudgetOptions = {},
): BudgetProposal[] {
  const windowHours = Math.max(1, opts.windowHours ?? INTERRUPTION_BUDGET_DEFAULTS.windowHours);
  const budget = opts.budget ?? INTERRUPTION_BUDGET_DEFAULTS.perWindow;
  if (!Number.isFinite(budget) || budget <= 0) return [];

  const volumeByPolicy = new Map<string, InterruptVolumeRow>();
  for (const row of rows) {
    if (typeof row.policy_id !== 'string' || !row.policy_id) continue;
    volumeByPolicy.set(row.policy_id, row);
  }

  const out: BudgetProposal[] = [];

  for (const p of policies) {
    const policyId = typeof p.id === 'string' ? p.id : '';
    if (!policyId) continue;
    const row = volumeByPolicy.get(policyId);
    if (!row) continue;
    const fired = Number(row.fired) || 0;
    if (fired <= budget) continue;

    const rules = parseRules(p.rules);
    const ungrantable = rules.ungrantable === true;
    const policyName = typeof p.name === 'string' ? p.name : policyId;
    const policyType = typeof p.policy_type === 'string' ? p.policy_type : 'unknown';
    const exampleIds = Array.isArray(row.example_decision_ids)
      ? row.example_decision_ids.map((v) => String(v ?? '')).filter(Boolean).slice(0, 5)
      : [];
    const overBy = Math.round((fired / budget) * 10) / 10;

    out.push({
      id: budgetProposalId(policyId),
      rule: BUDGET_RULE,
      policy_id: policyId,
      policy_name: policyName,
      policy_type: policyType,
      action_type: null,
      auto_demoted: !ungrantable,
      ungrantable,
      title: `"${policyName}" is interrupting ${overBy}× faster than you can answer`,
      summary:
        `${fired} ${plural(fired, 'interruption', 'interruptions')} in the last ${windowHours}h ` +
        `against a budget of ${budget}. ` +
        (ungrantable
          ? 'This rule is marked ungrantable, so nothing was relaxed automatically — ' +
            'a rule that can be disarmed by firing it is not a rule. Deactivate it here, ' +
            'or fix what is scoring so high.'
          : `New interruptions from this rule are being downgraded to a warning for ` +
            `${INTERRUPTION_BUDGET_DEFAULTS.demoteHours}h so your agents keep moving. ` +
            'Actions still record and still show in the ledger. Deactivate it for good, or fix the rule.'),
      evidence: {
        window_hours: windowHours,
        budget,
        fired,
        over_by: overBy,
        example_decision_ids: exampleIds,
      },
      patch: { active: false },
    });
  }

  return out.sort((a, b) => b.evidence.fired - a.evidence.fired || a.id.localeCompare(b.id));
}

export interface OverBudgetShape {
  /** commandShapeKey() output, e.g. "git log". */
  key: string;
  fired: number;
}

/**
 * Pure: count interruptions per command shape and return the ones over budget.
 *
 * Shared by the guard (getOverBudgetShapeKeys, which enforces) and the
 * /policies surface (which explains). Both MUST bucket identically — a UI that
 * groups differently from the enforcement would describe relief the operator
 * is not getting, which is worse than no UI at all.
 *
 * `shapeKeyOf` is injected rather than imported so this stays pure and the
 * caller controls the normalizer version.
 */
export function deriveOverBudgetShapes(
  goals: Array<{ declared_goal?: unknown }>,
  shapeKeyOf: (goal: unknown) => string | null,
  budget: number = INTERRUPTION_BUDGET_DEFAULTS.shapePerWindow,
): OverBudgetShape[] {
  if (!Number.isFinite(budget) || budget <= 0) return [];
  const counts = new Map<string, number>();
  for (const g of goals) {
    const key = shapeKeyOf(g?.declared_goal);
    if (!key) continue; // an unreadable goal is never budgeted
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const out: OverBudgetShape[] = [];
  for (const [key, fired] of counts) {
    if (fired > budget) out.push({ key, fired });
  }
  return out.sort((a, b) => b.fired - a.fired || a.key.localeCompare(b.key));
}
