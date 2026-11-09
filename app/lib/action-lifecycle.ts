// Action approval + execution lifecycle (action_records.status) as an explicit
// state machine. This module is the one source of truth for the states, the
// legal edges, who may drive each edge, the terminal set, the operator labels,
// the approve/deny -> status mapping and the refusal body. It is DB-free and
// imports nothing (no next/server), so client pages can import it too.
//
// The literal SQL gates in the repositories (setActionOutcome, the outcome
// sweeps, the approval expiry writers, recordApproval, cancelAction, the PATCH
// close gate) keep their text because tests pin it; the parity tests in
// __tests__/unit/action-lifecycle.test.ts hold every one of them to this table.
// No stored value changes: these are the strings already in the column.

export const ACTION_STATES = [
  'pending_approval',
  'running',
  'pending',
  'blocked',
  'completed',
  'failed',
  'cancelled',
  'expired',
  'unknown',
] as const;
export type ActionState = (typeof ACTION_STATES)[number];

/**
 * Who drives an edge. user = an operator (dashboard, API admin); webhook = a
 * chat approval (Discord, Telegram); agent = the governed client (SDK, MCP,
 * hooks); cron = the outcome sweeps; system = server-side writers (approval
 * expiry, capability invoke).
 */
export const ACTION_ACTORS = ['user', 'agent', 'cron', 'webhook', 'system'] as const;
export type ActionActor = (typeof ACTION_ACTORS)[number];

/** The statuses a create may carry (app/lib/validate.js ACTION_STATUSES, same order). */
export const ACTION_CREATE_STATES = [
  'running',
  'completed',
  'failed',
  'cancelled',
  'pending',
  'pending_approval',
  'blocked',
] as const satisfies readonly ActionState[];

export const ACTION_TRANSITIONS: Readonly<Record<ActionState, readonly ActionState[]>> = {
  pending_approval: ['running', 'failed', 'expired'],
  running: ['running', 'completed', 'failed', 'cancelled', 'unknown'],
  pending: ['completed', 'failed', 'unknown'],
  blocked: [],
  completed: [],
  failed: [],
  cancelled: [],
  expired: [],
  unknown: [],
};

export type ActionEdge = `${ActionState}>${ActionState}`;

/** One key per edge of ACTION_TRANSITIONS: the actors allowed to drive it. */
export const ACTION_EDGE_ACTORS: Readonly<Partial<Record<ActionEdge, readonly ActionActor[]>>> = {
  'pending_approval>running': ['user', 'webhook'],
  'pending_approval>failed': ['user', 'webhook'],
  'pending_approval>expired': ['system'],
  'running>running': ['agent'],
  'running>completed': ['agent', 'system', 'cron'],
  'running>failed': ['agent', 'system', 'cron'],
  'running>cancelled': ['agent', 'user'],
  'running>unknown': ['cron'],
  'pending>completed': ['agent', 'cron'],
  'pending>failed': ['agent', 'cron'],
  'pending>unknown': ['cron'],
};

/** States with no outgoing edge. */
export const ACTION_TERMINAL_STATES: readonly ActionState[] = ACTION_STATES.filter(
  (state) => ACTION_TRANSITIONS[state].length === 0,
);

/**
 * Lifecycle states for which an agent-reported execution outcome is refused
 * (POST /api/actions/:id/outcome): never dispatched (blocked, awaiting
 * approval, cancelled, approval expired) or already concluded as denied/failed.
 */
export const ACTION_STATES_REFUSING_OUTCOME = [
  'blocked',
  'pending_approval',
  'cancelled',
  'failed',
  'expired',
] as const satisfies readonly ActionState[];

export const ACTION_STATE_LABELS: Readonly<Record<ActionState, string>> = {
  pending_approval: 'Awaiting approval',
  running: 'Running',
  pending: 'Pending',
  blocked: 'Blocked by policy',
  completed: 'Completed',
  failed: 'Failed or denied',
  cancelled: 'Cancelled (not executed)',
  expired: 'Approval expired',
  unknown: 'Outcome unknown',
};

export function isActionState(value: unknown): value is ActionState {
  return typeof value === 'string' && (ACTION_STATES as readonly string[]).includes(value);
}

function edgeAllows(from: ActionState, to: ActionState, actor?: ActionActor): boolean {
  if (!ACTION_TRANSITIONS[from].includes(to)) return false;
  if (!actor) return true;
  return (ACTION_EDGE_ACTORS[`${from}>${to}`] ?? []).includes(actor);
}

/**
 * True when `requested` may follow `current` (for `actor`, when given). An
 * identity request (requested equals a known current state) is a no-op
 * success. False for unknown or NULL values.
 */
export function canTransition(
  current: string | null | undefined,
  requested: string,
  actor?: ActionActor,
): boolean {
  if (!isActionState(current) || !isActionState(requested)) return false;
  if (current === requested) return true;
  return edgeAllows(current, requested, actor);
}

/** The table's next states from `current` ([] for terminal or unknown values). Identity is not listed. */
export function nextStates(current: string | null | undefined, actor?: ActionActor): readonly ActionState[] {
  if (!isActionState(current)) return [];
  return ACTION_TRANSITIONS[current].filter((to) => edgeAllows(current, to, actor));
}

/** The states from which the table reaches `requested` (for `actor`, when given). */
export function allowedFrom(requested: string, actor?: ActionActor): readonly ActionState[] {
  if (!isActionState(requested)) return [];
  return ACTION_STATES.filter((from) => edgeAllows(from, requested, actor));
}

/** An operator/chat approval decision mapped to the status it writes. */
export function statusForDecision(decision: 'allow' | 'deny'): 'running' | 'failed' {
  return decision === 'allow' ? 'running' : 'failed';
}

function stateName(value: string | null | undefined): string {
  if (value == null) return 'no recorded status';
  return isActionState(value) ? `${ACTION_STATE_LABELS[value]} (${value})` : `unrecognized status '${value}'`;
}

function describeIllegalTransition(
  current: string | null | undefined,
  requested: string,
  allowed: readonly ActionState[],
): string {
  const head = `Cannot move this action from ${stateName(current)} to ${stateName(requested)}.`;
  if (allowed.length > 0) {
    return `${head} Allowed next: ${allowed.map((state) => stateName(state)).join(', ')}.`;
  }
  if (isActionState(current) && ACTION_TERMINAL_STATES.includes(current)) {
    return `${head} ${ACTION_STATE_LABELS[current]} is final; no further status change is allowed.`;
  }
  return `${head} No status change from here is open to this caller.`;
}

export class IllegalTransitionError extends Error {
  readonly code = 'illegal_transition';
  readonly current: string | null;
  readonly requested: string;
  readonly allowed: readonly ActionState[];
  constructor(current: string | null | undefined, requested: string, actor?: ActionActor) {
    const allowed = nextStates(current, actor);
    super(describeIllegalTransition(current, requested, allowed));
    this.name = 'IllegalTransitionError';
    this.current = current ?? null;
    this.requested = requested;
    this.allowed = allowed;
  }
}

/** Throws IllegalTransitionError unless canTransition(current, requested, actor). */
export function assertTransition(
  current: string | null | undefined,
  requested: string,
  actor?: ActionActor,
): void {
  if (!canTransition(current, requested, actor)) {
    throw new IllegalTransitionError(current, requested, actor);
  }
}

export interface IllegalTransitionBody {
  error: 'illegal_transition';
  message: string;
  current: string | null;
  requested: string;
  allowed: readonly ActionState[];
}

/** The refusal contract body (HTTP 409 by default). */
export function illegalTransitionBody(
  current: string | null | undefined,
  requested: string,
  actor?: ActionActor,
): IllegalTransitionBody {
  const allowed = nextStates(current, actor);
  return {
    error: 'illegal_transition',
    message: describeIllegalTransition(current, requested, allowed),
    current: current ?? null,
    requested,
    allowed,
  };
}
