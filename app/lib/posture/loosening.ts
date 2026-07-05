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

export const RELAX_RULE = 'relax_policy_scope';
export const DEACTIVATE_RULE = 'deactivate_policy';
export type LooseningRule = typeof RELAX_RULE | typeof DEACTIVATE_RULE;

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
    if (TUNING_OWNED_POLICY_TYPES.has(policyType)) continue;
    const grains = grainsByPolicy.get(policyId);
    if (!grains || grains.length === 0) continue;

    const policyName = typeof p.name === 'string' ? p.name : policyId;
    const rules = parseRules(p.rules);
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
