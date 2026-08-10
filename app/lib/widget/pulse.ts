/**
 * DashClaw Pulse — pure view-model composition for `/widget`.
 *
 * Every visual decision on the Pulse surface is a pure function of the
 * fetched snapshot plus client freshness inputs. No DB, no network, no DOM,
 * no geometry — the spec's honesty rules (docs/decisions/2026-08-09-widget-pulse.md
 * §4 posture precedence, §8 honesty rules) are all enforced here so every one
 * of them is unit-testable.
 */

// ── Snapshot (what GET /api/widget/pulse returns) ──────────────────────────

export interface PulsePendingRow {
  actionId: string | null;
  actionType: string | null;
  agentName: string | null;
  riskScore: number;
  timestampStart: string | null;
  declaredGoal: string | null;
}

export type PresenceVerdict = 'live' | 'stale' | 'inactive' | 'never-started' | 'unknown';

export interface PulseSnapshot {
  asOf: string;
  windowMinutes: number;
  pending: { count: number; rows: PulsePendingRow[] };
  signals: {
    red: number;
    amber: number;
    top: { severity: 'red' | 'amber'; kind: string; label: string } | null;
  };
  agents: { activeCount: number; lastActiveAt: string | null };
  lastActionAt: string | null;
  recentActionCount: number;
  queriesDegraded: string[];
  presence: { verdict: PresenceVerdict; frameAgeSeconds: number | null };
}

// ── Client freshness inputs ────────────────────────────────────────────────

export interface PulseClientState {
  data: PulseSnapshot | null;
  /** Epoch ms of the last SUCCESSFUL snapshot fetch. */
  lastDataAt: number | null;
  /** Epoch ms of the last SSE heartbeat or governed event. */
  lastTransportAt: number | null;
  /** True after an EventSource error until the stream reopens. */
  sseUnhealthy?: boolean;
}

// ── View model ─────────────────────────────────────────────────────────────

export type PulsePosture =
  | 'stale'
  | 'degraded'
  | 'owed-approval'
  | 'owed-signal'
  | 'unconfirmed'
  | 'active'
  | 'calm';

export type GlyphKind = 'dash-solid' | 'dash-hollow' | 'dash-hatched' | 'count' | 'count-signal';

export interface PulseView {
  posture: PulsePosture;
  /** Ring border color as a CSS var name (no hex anywhere). */
  ring: { colorVar: string; opacity: number; dashed: boolean; breathe: boolean };
  glyph: { kind: GlyphKind; text: string; colorVar: string; opacity: number };
  caption: string;
  captionSecondary: boolean;
  /** Left-edge rail for the displaced obligation (rule R2/R3). */
  rail: { severity: 'red' | 'amber'; count: number | null } | null;
  presence: {
    notch: 'none' | 'warning-filled' | 'outline' | 'outline-dashed';
    line: string | null;
    aria: string;
  };
  overdue: boolean;
  /** Diagonal hatch over the field (STALE only). */
  hatch: boolean;
  title: string;
  faviconTone: 'neutral' | 'brand' | 'error' | 'dim';
  reveal: {
    summary: string;
    rows: Array<{
      actionId: string | null;
      actionType: string;
      agentName: string;
      riskScore: number;
      riskHigh: boolean;
      age: string;
    }>;
    signalLine: string | null;
    presenceLine: string | null;
  };
}

// ── Constants (spec §4/§8 — thresholds are constants, no settings UI) ──────

export const FRESH_MS = 35_000;
export const STALE_MS = 90_000;
/** H4: cached data older than this can never repaint a non-stale posture. */
export const DATA_STALE_MS = 120_000;
export const ACTIVE_WINDOW_MS = 15 * 60 * 1000;
export const GOAL_MAX_CHARS = 64;
export const QUEUE_CAPTION_AT = 5;

/** Risk-scaled patience budget (dwell escalation, spec §4). */
export function budgetMsForRisk(riskScore: number): number {
  if (riskScore >= 70) return 5 * 60 * 1000;
  if (riskScore >= 40) return 20 * 60 * 1000;
  return 60 * 60 * 1000;
}

export function dwellRatio(row: PulsePendingRow, now: number): number {
  const start = row.timestampStart ? new Date(row.timestampStart).getTime() : NaN;
  if (!Number.isFinite(start)) return 0;
  const held = Math.max(0, now - start);
  return held / budgetMsForRisk(num(row.riskScore));
}

// ── Small helpers ──────────────────────────────────────────────────────────

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Word-boundary truncation with an explicit ellipsis (spec §5.3). */
export function truncateWords(value: unknown, max: number): string {
  const s = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > max * 0.5 ? cut.slice(0, lastSpace) : cut).trimEnd() + '…';
}

function ageMs(iso: string | null | undefined, now: number): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, now - t);
}

export function formatAge(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h`;
}

/** H6: window-derived claims are clamped — past the window, render `Nm+`. */
function formatAgeClamped(ms: number, windowMinutes: number): string {
  const windowMs = windowMinutes * 60 * 1000;
  if (ms > windowMs) return `${windowMinutes}m+`;
  return formatAge(ms);
}

function wallClock(epochMs: number): string {
  const d = new Date(epochMs);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

// ── Freshness (H3/H4) ──────────────────────────────────────────────────────

export type Freshness = 'fresh' | 'drifting' | 'stale';

export function computeFreshness(state: PulseClientState, now: number): Freshness {
  const lastData = state.lastDataAt ?? 0;
  const lastTransport = state.lastTransportAt ?? 0;
  const evidence = Math.max(lastData, lastTransport);
  if (state.sseUnhealthy && now - lastData > FRESH_MS) return 'stale';
  // H4: a live transport cannot resurrect old data — the snapshot itself must
  // be recent to leave STALE, or the widget would flash a stale calm.
  if (now - lastData > DATA_STALE_MS) return 'stale';
  if (evidence === 0 || now - evidence > STALE_MS) return 'stale';
  if (now - evidence > FRESH_MS) return 'drifting';
  return 'fresh';
}

// ── Presence (spec §7) ─────────────────────────────────────────────────────

const PRESENCE_VIEW: Record<PresenceVerdict, { notch: PulseView['presence']['notch']; line: string | null }> = {
  live: { notch: 'none', line: null },
  stale: { notch: 'warning-filled', line: 'desktop presence stale' },
  inactive: { notch: 'outline', line: 'desktop presence inactive' },
  'never-started': { notch: 'outline', line: 'desktop presence off' },
  unknown: { notch: 'outline-dashed', line: 'desktop presence unknown' },
};

function composePresence(snapshot: PulseSnapshot | null): PulseView['presence'] {
  // P1: absence of a verdict is never rendered as live.
  const verdict: PresenceVerdict = snapshot?.presence?.verdict ?? 'unknown';
  const meta = PRESENCE_VIEW[verdict] ?? PRESENCE_VIEW.unknown;
  const frameAge = snapshot?.presence?.frameAgeSeconds;
  const line =
    verdict === 'stale' && frameAge != null
      ? `desktop presence stale · frame ${Math.round(frameAge)}s`
      : meta.line;
  return { notch: meta.notch, line, aria: line ?? 'desktop presence live' };
}

// ── Signal rail (rules R2/R3) ──────────────────────────────────────────────

function composeRail(posture: PulsePosture, snapshot: PulseSnapshot | null): PulseView['rail'] {
  if (!snapshot) return null;
  // Degraded/stale/unconfirmed are dim takeovers — no chromatic annotations.
  if (posture === 'stale' || posture === 'degraded' || posture === 'unconfirmed') return null;
  // R2: no double-encoding — when signals own the glyph the rail is not drawn.
  if (posture === 'owed-signal') return null;
  if (snapshot.signals.red > 0) return { severity: 'red', count: snapshot.signals.red };
  if (snapshot.signals.amber > 0) return { severity: 'amber', count: null };
  return null;
}

// ── Degraded-query naming (H5) ─────────────────────────────────────────────

const QUERY_PHRASES: Record<string, string> = {
  pending: 'approval queue',
  signals: 'signals',
  agents: 'agents',
  recent: 'activity',
  presence: 'desktop presence',
};

function degradedPhrase(names: string[]): string {
  const phrases = names.map((n) => QUERY_PHRASES[n] ?? n);
  return `can't confirm ${phrases.join(', ')}`;
}

// ── The composition ────────────────────────────────────────────────────────

const DIM = 'var(--color-text-disabled)';

export function composePulse(state: PulseClientState, now: number): PulseView {
  const snapshot = state.data;
  const freshness = computeFreshness(state, now);
  const presence = composePresence(snapshot);

  // H7: loading (no snapshot ever fetched) is the resting mark at 30% opacity.
  if (!snapshot) {
    return {
      posture: 'unconfirmed',
      ring: { colorVar: DIM, opacity: 0.55, dashed: true, breathe: false },
      glyph: { kind: 'dash-hollow', text: '—', colorVar: DIM, opacity: 0.3 },
      caption: '',
      captionSecondary: false,
      rail: null,
      presence,
      overdue: false,
      hatch: false,
      title: '? DashClaw',
      faviconTone: 'dim',
      reveal: { summary: '', rows: [], signalLine: null, presenceLine: presence.line },
    };
  }

  const windowMinutes = snapshot.windowMinutes || 60;
  const pendingCount = num(snapshot.pending.count);
  const red = num(snapshot.signals.red);
  const amber = num(snapshot.signals.amber);

  // Pending rows sorted by dwell ratio — the hungriest ask owns the caption.
  const rows = [...(snapshot.pending.rows || [])].sort((a, b) => dwellRatio(b, now) - dwellRatio(a, now));
  const winner = rows[0] ?? null;
  const maxDwell = winner ? dwellRatio(winner, now) : 0;
  const overdue = pendingCount > 0 && maxDwell >= 1;

  // H1: calm requires positive heartbeat evidence inside the window. A held
  // agent emits nothing by design (H2) — pending>0 short-circuits above this.
  const lastActionAge = ageMs(snapshot.lastActionAt, now);
  const lastAgentAge = ageMs(snapshot.agents.lastActiveAt, now);
  const windowMs = windowMinutes * 60 * 1000;
  const heartbeatEvidence =
    (lastActionAge != null && lastActionAge <= windowMs) ||
    (lastAgentAge != null && lastAgentAge <= windowMs);

  // Posture ladder (spec §4) — first match owns ring, glyph, caption.
  let posture: PulsePosture;
  if (freshness === 'stale') posture = 'stale';
  else if (snapshot.queriesDegraded.length > 0) posture = 'degraded';
  else if (pendingCount > 0) posture = 'owed-approval';
  else if (red > 0) posture = 'owed-signal';
  else if (!heartbeatEvidence) posture = 'unconfirmed';
  else if (lastActionAge != null && lastActionAge <= ACTIVE_WINDOW_MS) posture = 'active';
  else posture = 'calm';

  // ── Ring ──
  let ring: PulseView['ring'];
  switch (posture) {
    case 'owed-approval':
      ring = overdue
        ? { colorVar: 'var(--color-error)', opacity: 1, dashed: false, breathe: true }
        : { colorVar: 'var(--color-brand)', opacity: 1, dashed: false, breathe: false };
      break;
    case 'owed-signal':
      ring = { colorVar: 'var(--color-error)', opacity: 1, dashed: false, breathe: true };
      break;
    case 'active':
      ring = { colorVar: 'var(--color-border-hover)', opacity: 1, dashed: false, breathe: false };
      break;
    case 'calm':
      ring = { colorVar: 'var(--color-border)', opacity: 1, dashed: false, breathe: false };
      break;
    case 'unconfirmed':
      ring = { colorVar: DIM, opacity: 0.55, dashed: true, breathe: false };
      break;
    default: // stale, degraded
      ring = { colorVar: DIM, opacity: 0.4, dashed: true, breathe: false };
  }

  // ── Glyph ──
  let glyph: PulseView['glyph'];
  if (posture === 'owed-approval') {
    glyph = {
      kind: 'count',
      text: String(pendingCount),
      colorVar: overdue ? 'var(--color-error)' : 'var(--color-brand)',
      opacity: 1,
    };
  } else if (posture === 'owed-signal') {
    glyph = { kind: 'count-signal', text: String(red), colorVar: 'var(--color-error)', opacity: 1 };
  } else if (posture === 'stale' || posture === 'degraded') {
    glyph = { kind: 'dash-hatched', text: '—', colorVar: DIM, opacity: 0.55 };
  } else if (posture === 'unconfirmed') {
    glyph = { kind: 'dash-hollow', text: '—', colorVar: DIM, opacity: 0.7 };
  } else {
    glyph = { kind: 'dash-solid', text: '—', colorVar: DIM, opacity: 1 };
  }

  // ── Caption ──
  const activeCount = num(snapshot.agents.activeCount);
  const agentsPhrase = `${activeCount} agent${activeCount === 1 ? '' : 's'} live`;
  let caption: string;
  if (posture === 'stale') {
    const evidence = Math.max(state.lastDataAt ?? 0, state.lastTransportAt ?? 0);
    caption =
      evidence > 0
        ? `link lost ${formatAge(now - evidence)} · last confirmed ${wallClock(evidence)}`
        : 'link lost · never confirmed';
  } else if (posture === 'degraded') {
    caption = degradedPhrase(snapshot.queriesDegraded);
  } else if (posture === 'owed-approval') {
    if (pendingCount >= QUEUE_CAPTION_AT) {
      const oldest = rows.reduce((acc, r) => Math.max(acc, ageMs(r.timestampStart, now) ?? 0), 0);
      caption = `${pendingCount} waiting · oldest ${formatAge(oldest)}`;
    } else if (winner) {
      const held = ageMs(winner.timestampStart, now) ?? 0;
      const base = `${winner.actionType ?? 'action'} · ${winner.agentName ?? 'agent'} · held ${formatAge(held)}`;
      caption = overdue
        ? `overdue ${formatAge(Math.max(0, held - budgetMsForRisk(num(winner.riskScore))))} · ${base}`
        : base;
    } else {
      caption = `${pendingCount} waiting`;
    }
  } else if (posture === 'owed-signal') {
    const kind = snapshot.signals.top?.kind ?? 'red signal';
    caption = red === 1 ? kind : `${red} red signals · ${kind}`;
  } else if (posture === 'unconfirmed') {
    const newest = Math.min(lastActionAge ?? Infinity, lastAgentAge ?? Infinity);
    caption = Number.isFinite(newest)
      ? `no agent check-in · ${formatAgeClamped(newest, windowMinutes)}`
      : 'waiting for first governed action';
  } else if (posture === 'active') {
    caption = `nothing owed · ${agentsPhrase}`;
  } else {
    caption = `all clear · last action ${formatAgeClamped(lastActionAge ?? windowMs + 1, windowMinutes)}`;
  }

  // H3: a drifting feed annotates the caption; posture and glyph are unchanged.
  if (freshness === 'drifting' && posture !== 'stale') {
    const evidence = Math.max(state.lastDataAt ?? 0, state.lastTransportAt ?? 0);
    caption = `${caption} · unconfirmed ${formatAge(now - evidence)}`;
  }

  // ── Title + favicon ──
  let title: string;
  let faviconTone: PulseView['faviconTone'];
  if (posture === 'owed-approval' && !overdue) {
    title = `${pendingCount} · DashClaw`;
    faviconTone = 'brand';
  } else if (posture === 'owed-signal' || overdue) {
    title = '! DashClaw';
    faviconTone = 'error';
  } else if (posture === 'active' || posture === 'calm') {
    title = '— DashClaw';
    faviconTone = 'neutral';
  } else {
    title = '? DashClaw';
    faviconTone = 'dim';
  }

  // ── Reveal layer ──
  const revealRows = rows.map((r) => ({
    actionId: r.actionId,
    actionType: truncateWords(r.actionType ?? 'action', 32),
    agentName: truncateWords(r.agentName ?? 'agent', 24),
    riskScore: num(r.riskScore),
    riskHigh: num(r.riskScore) >= 80,
    age: formatAge(ageMs(r.timestampStart, now) ?? 0),
  }));
  const oldest = rows.reduce((acc, r) => Math.max(acc, ageMs(r.timestampStart, now) ?? 0), 0);
  const summary = pendingCount > 0 ? `${pendingCount} waiting · oldest ${formatAge(oldest)}` : 'nothing waiting';
  let signalLine: string | null = null;
  if (red > 0) {
    signalLine = `! ${red} red signal${red === 1 ? '' : 's'} unreviewed`;
    if (snapshot.signals.top?.severity === 'red') {
      signalLine += ` · ${truncateWords(snapshot.signals.top.label, 80)}`;
    }
  } else if (amber > 0) {
    signalLine = `${amber} amber signal${amber === 1 ? '' : 's'} open`;
  }

  return {
    posture,
    ring,
    glyph,
    caption,
    captionSecondary: posture === 'owed-approval' || posture === 'owed-signal',
    rail: composeRail(posture, snapshot),
    presence,
    overdue,
    hatch: posture === 'stale',
    title,
    faviconTone,
    reveal: { summary, rows: revealRows, signalLine, presenceLine: presence.line },
  };
}

// ── Baseline strip (spec §5.4 — activity, never urgency) ───────────────────

export type BaselineKind = 'success' | 'brand' | 'error' | 'warning' | 'info';

export function baselineKindForEvent(event: string, payload: unknown): BaselineKind | null {
  const p = (payload ?? {}) as Record<string, unknown>;
  switch (event) {
    case 'action.updated':
      if (p.outcome_status === 'failure' || p.status === 'failed') return 'error';
      if (p.status === 'completed') return 'success';
      return 'info';
    case 'action.created':
      return p.status === 'pending_approval' ? 'brand' : 'info';
    case 'guard.decision.created':
      return p.decision === 'block' || p.decision === 'require_approval' ? 'brand' : 'info';
    case 'signal.detected':
      return 'warning';
    case 'decision.created':
      return 'info';
    default:
      return null;
  }
}
