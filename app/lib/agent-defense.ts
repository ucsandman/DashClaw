/**
 * Agent's-advocate rollup (owner roadmap item 4).
 *
 * Pure shaping — no IO. Given an action row, its FK-linked guard decision
 * (action_records.guard_decision_id → guard_decisions.id, may be null), and
 * the action's assumptions, produce the `agent_defense` object returned on
 * GET /api/actions/{actionId}: what the agent declared, what it assumed
 * (the alibi), what governance decided, and which shields stood between it
 * and weaponization.
 *
 * Honesty rule: absence of evidence renders as 'not_recorded' / linked:false
 * — this surface never asserts protection it cannot point to in a persisted
 * row. Malformed JSON degrades to the same, never throws.
 */

type Row = Record<string, unknown>;

export interface AgentDefense {
  declared: {
    goal: string | null;
    reasoning: string | null;
    authorization_scope: string | null;
    trigger: string | null;
  };
  assumed: { total: number; validated: number; invalidated: number; open: number };
  decision:
    | {
        linked: true;
        id: string;
        decision: string | null;
        reason: string | null;
        matched_policies: string[];
        risk_score: number | null;
        risk_breakdown: unknown | null;
      }
    | { linked: false };
  shields: {
    prompt_injection: { status: 'clean' | 'warned' | 'blocked' | 'disabled' | 'not_recorded' };
    non_fabrication:
      | { evaluated: true; verdict: 'pass' | 'block'; violations: number; receipt: boolean }
      | { evaluated: false };
    spend:
      | { evaluated: true; outcome: 'within_limits' | 'required_approval' | 'blocked' }
      | { evaluated: false };
  };
}

function parseJson(value: unknown): unknown {
  if (value == null) return null;
  if (typeof value === 'object') return value; // driver may already parse jsonb
  if (typeof value !== 'string') return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function isFlagSet(value: unknown): boolean {
  return value === 1 || value === true || value === '1';
}

const INJECTION_STATUSES = new Set(['clean', 'warned', 'blocked', 'disabled']);

function shieldStatus(context: unknown): AgentDefense['shields']['prompt_injection']['status'] {
  const shields = (context as Row | null)?._shields as Row | undefined;
  const status = shields?.prompt_injection;
  return typeof status === 'string' && INJECTION_STATUSES.has(status)
    ? (status as AgentDefense['shields']['prompt_injection']['status'])
    : 'not_recorded';
}

function nonFabRollup(evidence: unknown): AgentDefense['shields']['non_fabrication'] {
  const entries = parseJson(evidence);
  if (!Array.isArray(entries) || entries.length === 0) return { evaluated: false };
  let violations = 0;
  let blocked = false;
  let receipt = false;
  for (const entry of entries as Row[]) {
    if (!entry || typeof entry !== 'object') continue;
    if (entry.verdict === 'block') blocked = true;
    if (Array.isArray(entry.violations)) violations += entry.violations.length;
    if (entry.receipt) receipt = true;
  }
  return { evaluated: true, verdict: blocked ? 'block' : 'pass', violations, receipt };
}

export function buildAgentDefense(
  action: Row,
  guardDecision: Row | null,
  assumptions: Row[],
): AgentDefense {
  const total = assumptions.length;
  let validated = 0;
  let invalidated = 0;
  for (const a of assumptions) {
    if (isFlagSet(a.invalidated)) invalidated += 1;
    else if (isFlagSet(a.validated)) validated += 1;
  }

  const linkedId = asString(guardDecision?.id);
  let decision: AgentDefense['decision'] = { linked: false };
  let shields: AgentDefense['shields'] = {
    prompt_injection: { status: 'not_recorded' },
    non_fabrication: { evaluated: false },
    spend: { evaluated: false },
  };

  if (guardDecision && linkedId) {
    const context = parseJson(guardDecision.context);
    const matched = parseJson(guardDecision.matched_policies);
    const riskScore = Number(guardDecision.risk_score);
    decision = {
      linked: true,
      id: linkedId,
      decision: asString(guardDecision.decision),
      reason: asString(guardDecision.reason),
      matched_policies: Array.isArray(matched) ? matched.filter((p): p is string => typeof p === 'string') : [],
      risk_score: Number.isFinite(riskScore) ? riskScore : null,
      risk_breakdown: (context as Row | null)?._risk_breakdown ?? null,
    };

    // The x402 evaluator runs on every x402_purchase guard call; the linked
    // decision therefore IS the spend verdict for those actions. Deliberately
    // narrow (claims-audit B2): no generic-spend claim for other action types.
    const isX402 = action.action_type === 'x402_purchase' || guardDecision.action_type === 'x402_purchase';
    const spendOutcome =
      guardDecision.decision === 'block'
        ? 'blocked'
        : guardDecision.decision === 'require_approval'
          ? 'required_approval'
          : 'within_limits';

    shields = {
      prompt_injection: { status: shieldStatus(context) },
      non_fabrication: nonFabRollup(guardDecision.evidence),
      spend: isX402 ? { evaluated: true, outcome: spendOutcome } : { evaluated: false },
    };
  }

  return {
    declared: {
      goal: asString(action.declared_goal),
      reasoning: asString(action.reasoning),
      authorization_scope: asString(action.authorization_scope),
      trigger: asString(action.trigger),
    },
    assumed: { total, validated, invalidated, open: total - validated - invalidated },
    decision,
    shields,
  };
}
