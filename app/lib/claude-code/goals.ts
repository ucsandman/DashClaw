/**
 * /goal outcome classifier and autopsy builder. Pure — no DB, no fs.
 *
 * Ported from AgentLens (`src/goals.js`). DB access stays in the route/page
 * layer (fetch messages + tool_uses from the repository); the pure assembly of
 * those rows into an autopsy lives in `buildAutopsyFromDetail` below, shared by
 * the autopsy API route and the session-detail UI so the two can never disagree
 * on the verdict.
 */

import { detectRepeatedRuns } from './repeated-runs';

export const OUTCOMES = Object.freeze({
  COMPLETED: 'completed',
  THRASHED: 'thrashed',
  FELL_BACK_TO_RULES: 'fell_back_to_rules',
  TIMED_OUT: 'timed_out',
  ABORTED: 'aborted',
});

/** A session row (loaded from the repository). Loosely typed — pure assembly only. */
export interface GoalSession {
  id?: string;
  session_uuid?: string;
  cost_usd?: number;
  message_count?: number;
  model_primary?: string;
  started_at?: string | number | Date | null;
  ended_at?: string | number | Date | null;
  [key: string]: unknown;
}

export interface StuckLoop {
  count?: number;
  confidence?: string;
  [key: string]: unknown;
}

export interface ClassifySignals {
  goalText?: string | null;
  stuckLoops?: StuckLoop[];
  toolCount?: number;
  hasFinalSummary?: boolean;
  hasAbortSignal?: boolean;
  fellBackToRules?: boolean;
  elapsedMs?: number | null;
  timeoutMs?: number | null;
}

// Classify a /goal session.
export function classifyOutcome(session: GoalSession, signals: ClassifySignals = {}): string {
  const stuckLoops = signals.stuckLoops || [];
  const stuckLoopCount = stuckLoops.length;
  const stuckLoopTotal = stuckLoops.reduce((a, l) => a + (l.count || 0), 0);
  const toolCount = signals.toolCount || 0;
  const hasFinalSummary = !!signals.hasFinalSummary;
  const hasAbort = !!signals.hasAbortSignal;
  const fellBack = !!signals.fellBackToRules;
  const elapsed = Number(signals.elapsedMs) || null;
  const timeoutMs = Number(signals.timeoutMs) || null;

  if (fellBack) return OUTCOMES.FELL_BACK_TO_RULES;
  if (hasAbort) return OUTCOMES.ABORTED;
  if (timeoutMs && elapsed && elapsed >= timeoutMs) return OUTCOMES.TIMED_OUT;

  // Thrashed: substantial portion of tool calls are inside stuck loops AND
  // there is no terminal summary. Use ≥30% of tool calls inside loops OR
  // ≥3 stuck-loop groups in one session.
  const loopShare = toolCount > 0 ? stuckLoopTotal / toolCount : 0;
  const thrashing = (stuckLoopCount >= 3) || (loopShare >= 0.3 && !hasFinalSummary);
  if (thrashing) return OUTCOMES.THRASHED;

  if (hasFinalSummary) return OUTCOMES.COMPLETED;

  // No strong signal either way — call it completed if there was tool activity
  // and the session ended without aborting, otherwise thrashed.
  return toolCount > 0 ? OUTCOMES.COMPLETED : OUTCOMES.THRASHED;
}

// Extract a one-line goal text from a JSONL-derived signal list.
// `userTurns` is an array of user-role message text_preview strings in order.
// We look for "/goal" markers OR an explicit `signals.goalField`.
export function extractGoalText(userTurns: unknown[] = [], explicitField: string | null = null): string | null {
  if (explicitField && typeof explicitField === 'string') {
    return truncateGoal(explicitField);
  }
  for (const t of userTurns) {
    if (typeof t !== 'string') continue;
    const m = t.match(/\/goal\s+(.+)/i);
    if (m) return truncateGoal(m[1] as string);
  }
  return null;
}

function truncateGoal(s: string): string {
  const cleaned = String(s).replace(/\s+/g, ' ').trim();
  if (cleaned.length <= 240) return cleaned;
  return cleaned.slice(0, 237) + '...';
}

// Categorize a list of tool names into spending buckets. Coarse on purpose —
// it should help the user reason about "where did the money go" at a glance.
export const TOOL_CATEGORY: Record<string, string> = {
  Read: 'read',
  Grep: 'read',
  Glob: 'read',
  Bash: 'shell',
  PowerShell: 'shell',
  Edit: 'edit',
  Write: 'edit',
  NotebookEdit: 'edit',
  WebSearch: 'web',
  WebFetch: 'web',
  Agent: 'subagent',
  TaskCreate: 'planning',
  TaskUpdate: 'planning',
  TaskList: 'planning',
  TaskGet: 'planning',
  TaskStop: 'planning',
  AskUserQuestion: 'human-in-loop',
};

export interface ToolEvent {
  name: string;
  requestId?: string;
  target?: string | null;
}

export interface MoneyBucket {
  bucket: string;
  share: number;
  approxCost: number;
}

export function topMoneyBuckets(session: GoalSession, toolEvents: ToolEvent[] = []): MoneyBucket[] {
  if (!toolEvents.length) {
    return [
      { bucket: 'model:' + (session.model_primary || 'unknown'), share: 1, approxCost: session.cost_usd || 0 },
    ];
  }
  const counts = new Map<string, number>();
  for (const e of toolEvents) {
    const cat = TOOL_CATEGORY[e.name] || 'other';
    counts.set(cat, (counts.get(cat) || 0) + 1);
  }
  const total = toolEvents.length;
  const entries: MoneyBucket[] = [...counts.entries()].map(([cat, n]) => ({
    bucket: 'tool:' + cat,
    share: n / total,
    approxCost: (session.cost_usd || 0) * (n / total),
  }));
  entries.sort((a, b) => b.share - a.share);
  // Always include the model bucket as the first/dominant cost driver context.
  entries.unshift({ bucket: 'model:' + (session.model_primary || 'unknown'), share: 1, approxCost: session.cost_usd || 0 });
  return entries.slice(0, 4);
}

export interface BuildAutopsyArgs {
  session: GoalSession;
  userTurns?: unknown[];
  stuckLoops?: StuckLoop[];
  toolEvents?: ToolEvent[];
  hasFinalSummary?: boolean;
  hasAbortSignal?: boolean;
  fellBackToRules?: boolean;
  timeoutMs?: number | null;
}

export interface Autopsy {
  session_id: string | undefined;
  session_uuid: string | undefined;
  goal_text: string | null;
  outcome: string;
  turns: number;
  cost_usd: number;
  elapsed_ms: number | null;
  where_money_went: MoneyBucket[];
}

// Build a full autopsy record for one session. Caller must supply the
// pre-loaded user turns, stuck loops, and tool events (the route loads these
// from the repository).
export function buildAutopsy({
  session,
  userTurns = [],
  stuckLoops = [],
  toolEvents = [],
  hasFinalSummary = false,
  hasAbortSignal = false,
  fellBackToRules = false,
  timeoutMs = null,
}: BuildAutopsyArgs): Autopsy {
  const elapsedMs = (session.started_at && session.ended_at)
    ? Math.max(0, new Date(session.ended_at as string).getTime() - new Date(session.started_at as string).getTime())
    : null;
  const outcome = classifyOutcome(session, {
    stuckLoops, toolCount: toolEvents.length, hasFinalSummary, hasAbortSignal, fellBackToRules, elapsedMs, timeoutMs,
  });
  return {
    session_id: session.id,
    session_uuid: session.session_uuid,
    goal_text: extractGoalText(userTurns),
    outcome,
    turns: session.message_count || 0,
    cost_usd: session.cost_usd || 0,
    elapsed_ms: elapsedMs,
    where_money_went: topMoneyBuckets(session, toolEvents),
  };
}

// Cue words that mark a terminal "I'm done" assistant message. Kept module-level
// so the autopsy API route and the session-detail UI hash the same definition.
const FINAL_SUMMARY_CUES = /\b(done|completed|shipped|pass(?:ed|ing)?|ready|stopping|all tests|complete)\b/i;

export interface DetailMessage {
  role?: string;
  text_preview?: string | null;
  [key: string]: unknown;
}

export interface DetailToolUse {
  name: string;
  request_id?: string;
  target?: string | null;
  [key: string]: unknown;
}

export interface BuildAutopsyFromDetailArgs {
  session: GoalSession;
  messages?: DetailMessage[];
  toolUses?: DetailToolUse[];
  timeoutMs?: number | null;
}

// Assemble an autopsy from already-loaded repository rows (a getSessionDetail
// result: { session, messages, toolUses }). Pure — no DB or fs. Both the
// autopsy API route and the session-detail page call this with the same rows,
// so the rendered verdict always matches the API.
export function buildAutopsyFromDetail({
  session,
  messages = [],
  toolUses = [],
  timeoutMs = null,
}: BuildAutopsyFromDetailArgs): Autopsy {
  const userTurns = messages.filter((m) => m.role === 'user').map((m) => m.text_preview || '');
  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
  const hasFinalSummary = !!(lastAssistant?.text_preview && FINAL_SUMMARY_CUES.test(lastAssistant.text_preview));
  const toolEvents: ToolEvent[] = toolUses.map((t) => ({ name: t.name, requestId: t.request_id, target: t.target }));
  const stuckLoops = (detectRepeatedRuns(toolEvents) as unknown as StuckLoop[]).filter((r) => r.confidence === 'high');
  return buildAutopsy({ session, userTurns, stuckLoops, toolEvents, hasFinalSummary, timeoutMs });
}
