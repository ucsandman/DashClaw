/**
 * Pure normalization logic for the desktop status widget (`/widget`).
 *
 * No DB / network imports — this module is the testable seam. The route
 * (app/api/widget/summary/route.ts) does the I/O (calls repositories) and
 * hands the raw results to buildWidgetSummary here. Keeping posture,
 * sanitization, and signal selection pure makes them unit-testable and keeps
 * privacy guarantees (the action whitelist) in one auditable place.
 */

export type WidgetPostureStatus = 'calm' | 'active' | 'approval' | 'elevated';

export interface WidgetPostureInput {
  redSignals?: number | string | null;
  amberSignals?: number | string | null;
  pendingApprovals?: number | string | null;
  runningActions?: number | string | null;
  blockedActions?: number | string | null;
  highRiskActions?: number | string | null;
}

/** Coerce a possibly-string DB value (Neon returns numeric/bigint as strings) to a finite number, else 0. */
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Operational posture for the header pill.
 *
 * `offline` is a client-only concept (connection state) and is deliberately
 * NOT produced here. Precedence (highest first): elevated > approval > active
 * > calm. "Elevated" = realized critical risk: a red signal, a blocked action,
 * or a high-risk action. The route feeds `redSignals` (computeSignals already
 * emits failures / high-risk / blocks as red); `blockedActions` /
 * `highRiskActions` are supported so the contract is explicit and testable.
 */
export function computeWidgetPosture(input: WidgetPostureInput = {}): WidgetPostureStatus {
  const red = num(input.redSignals);
  const amber = num(input.amberSignals);
  const pending = num(input.pendingApprovals);
  const running = num(input.runningActions);
  const blocked = num(input.blockedActions);
  const highRisk = num(input.highRiskActions);

  if (red > 0 || blocked > 0 || highRisk > 0) return 'elevated';
  if (pending > 0) return 'approval';
  if (running > 0 || amber > 0) return 'active';
  return 'calm';
}

const collapseWhitespace = (s: string): string => s.replace(/\s+/g, ' ').trim();

/** Collapse whitespace then hard-cap length; the ellipsis counts toward `max` so output is always <= max chars. */
export function truncate(value: unknown, max: number): string {
  const s = collapseWhitespace(String(value ?? ''));
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 1)).trimEnd() + '…';
}

const str = (v: unknown): string | null => (v == null ? null : String(v));

/** Loose shape of a raw action row from the repository. Only whitelisted keys ever reach the client. */
export type RawAction = Record<string, unknown>;

export interface WidgetAction {
  actionId: string | null;
  agentName: string | null;
  actionType: string | null;
  summary: string;
  status: string | null;
  riskScore: number | null;
  outcomeStatus: string | null;
  ts: string | null;
}

/**
 * Whitelist-map a raw action row to the minimal, safe widget shape.
 *
 * NEVER spreads the raw row. reasoning / authorization_scope / artifacts_created
 * / side_effects / model / cost_estimate / raw error_message are intentionally
 * excluded — the widget must not leak prompts, reasoning, or artifact bodies.
 */
export function sanitizeRecentAction(action: RawAction = {}): WidgetAction {
  const riskRaw = action.risk_score;
  const hasRisk = riskRaw != null && riskRaw !== '' && Number.isFinite(Number(riskRaw));
  return {
    actionId: str(action.action_id),
    agentName: str(action.agent_name ?? action.agent_id),
    actionType: str(action.action_type),
    summary: truncate(action.output_summary || action.declared_goal || '', 80),
    status: str(action.status),
    riskScore: hasRisk ? Number(riskRaw) : null,
    outcomeStatus: str(action.outcome_status),
    ts: str(action.timestamp_start ?? action.created_at),
  };
}

export interface RawSignal {
  type?: string;
  severity?: string | null;
  label?: string | null;
  detail?: string | null;
  agent_id?: string | null;
  detected_at?: string | null;
}

export interface WidgetSignal {
  severity: 'red' | 'amber';
  label: string | null;
  detail: string;
  agentId: string | null;
  ts: string | null;
}

const severityRank = (sev: unknown): number => (sev === 'red' ? 0 : sev === 'amber' ? 1 : 2);

/** Top N signals, red before amber, detail truncated. Safe-by-construction (no raw fields passed through). */
export function pickTopSignals(signals: readonly RawSignal[] = [], n = 2): WidgetSignal[] {
  return [...signals]
    .sort((a, b) => severityRank(a.severity) - severityRank(b.severity))
    .slice(0, Math.max(0, n))
    .map((s) => ({
      severity: s.severity === 'red' ? 'red' : 'amber',
      label: str(s.label),
      detail: truncate(s.detail ?? '', 100),
      agentId: str(s.agent_id),
      ts: str(s.detected_at),
    }));
}

export function countSignals(signals: readonly RawSignal[] = []): { red: number; amber: number; total: number } {
  let red = 0;
  let amber = 0;
  for (const s of signals) {
    if (s.severity === 'red') red += 1;
    else if (s.severity === 'amber') amber += 1;
  }
  return { red, amber, total: signals.length };
}

/** An agent counts as "active" if it acted within this window. */
export const ACTIVE_AGENT_WINDOW_MS = 15 * 60 * 1000;

export function countActiveAgents(
  agents: ReadonlyArray<{ last_active?: string | null }> = [],
  now: number,
  windowMs: number = ACTIVE_AGENT_WINDOW_MS,
): number {
  let count = 0;
  for (const a of agents) {
    if (!a || !a.last_active) continue;
    const t = new Date(a.last_active).getTime();
    if (Number.isFinite(t) && now - t <= windowMs && t - now <= windowMs) count += 1;
  }
  return count;
}

export interface BuildWidgetSummaryInput {
  recent: { actions?: unknown; stats?: Record<string, unknown> | null } | null;
  pendingApprovals: number | string | null;
  pendingActions?: unknown;
  signals: readonly RawSignal[];
  spendUsd: number | null;
  agents: ReadonlyArray<{ last_active?: string | null }>;
  now: number;
}

export interface WidgetSummary {
  status: WidgetPostureStatus;
  generatedAt: string;
  metrics: {
    activeAgents: number;
    pendingApprovals: number;
    elevated: number;
    spend: number | null;
  };
  signals: { red: number; amber: number; total: number };
  pendingApprovals: WidgetAction[];
  recentActions: WidgetAction[];
  topSignals: WidgetSignal[];
}

/**
 * Compose the full widget payload from already-fetched, individually-resilient
 * sources. Pure: `now` is injected so generatedAt is deterministic in tests.
 */
export function buildWidgetSummary(input: BuildWidgetSummaryInput): WidgetSummary {
  const recent = input.recent ?? { actions: [], stats: {} };
  const actions: RawAction[] = Array.isArray(recent.actions) ? (recent.actions as RawAction[]) : [];
  const stats = (recent.stats ?? {}) as Record<string, unknown>;
  const signals = Array.isArray(input.signals) ? input.signals : [];
  const counts = countSignals(signals);

  const status = computeWidgetPosture({
    redSignals: counts.red,
    amberSignals: counts.amber,
    pendingApprovals: input.pendingApprovals,
    runningActions: num(stats.running),
  });

  const spend = input.spendUsd == null || !Number.isFinite(Number(input.spendUsd)) ? null : Number(input.spendUsd);
  const pendingActions: RawAction[] = Array.isArray(input.pendingActions) ? (input.pendingActions as RawAction[]) : [];

  return {
    status,
    generatedAt: new Date(input.now).toISOString(),
    metrics: {
      activeAgents: countActiveAgents(input.agents, input.now),
      pendingApprovals: num(input.pendingApprovals),
      elevated: counts.total,
      spend,
    },
    signals: counts,
    pendingApprovals: pendingActions.slice(0, 8).map((a) => sanitizeRecentAction(a)),
    recentActions: actions.slice(0, 10).map((a) => sanitizeRecentAction(a)),
    topSignals: pickTopSignals(signals, 2),
  };
}
