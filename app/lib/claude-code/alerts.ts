/**
 * Alert detection — pure functions only.
 *
 * Ported from AgentLens (`src/alerts.js`). Renames:
 *   PLAN_FIT → MULTI_PROJECT_USAGE — DashClaw doesn't have a free-tier-upsell
 *   concept; the underlying signal ("this org has activity in N projects
 *   this month") is still useful as an informational note, so we keep the
 *   detection logic but drop the upsell framing.
 *
 * Drops (these live in the repository in Phase 2):
 *   - SCHEMA constant
 *   - ensureSchema / persistAlerts / suppressPlanFitForPaidUsers
 *   - listAlerts / markAllRead
 */

import { cacheHitRate, formatUSD } from './pricing';

export const KINDS = Object.freeze({
  COST_ANOMALY: 'cost_anomaly',
  CACHE_CRATER: 'cache_crater',
  STUCK_LOOP_STREAK: 'stuck_loop_streak',
  MULTI_PROJECT_USAGE: 'multi_project_usage',
});

export const COST_ANOMALY_MULTIPLE = 3.0;
export const CACHE_CRATER_PP_DROP = 20;
export const STUCK_LOOP_STREAK_PER_SESSION = 2;   // >2 loops in one session triggers
export const MULTI_PROJECT_THRESHOLD = 3;          // org with sessions in 3+ projects triggers

export interface SessionLike {
  session_uuid?: string;
  cost_usd?: number;
}

export interface Alert {
  kind: string;
  severity: string;
  title: string;
  body?: string;
  scope?: string;
}

export interface DetectForSessionInput {
  session: SessionLike;
  priorSessions?: SessionLike[];
  stuckLoopCount?: number;
  projectSessionCount?: number;
}

export interface CacheTotals {
  input_tokens?: number;
  cache_creation_tokens?: number;
  cache_read_tokens?: number;
}

// Detect anomalies for a single newly-ingested session, against prior data in
// the same project. Returns Alert[] (not yet inserted into the DB).
export function detectForSession({ session, priorSessions = [], stuckLoopCount = 0, projectSessionCount = 0 }: DetectForSessionInput): Alert[] {
  const alerts: Alert[] = [];

  // COST_ANOMALY — using the project median where available.
  if (priorSessions.length >= 5) {
    const costs = priorSessions.map(s => s.cost_usd || 0).sort((a, b) => a - b);
    const median = costs[Math.floor(costs.length / 2)] as number;
    if (median > 0) {
      const ratio = (session.cost_usd || 0) / median;
      if (ratio >= COST_ANOMALY_MULTIPLE) {
        alerts.push({
          kind: KINDS.COST_ANOMALY,
          severity: 'warn',
          title: `Session ${(session.session_uuid || '').slice(0,8)} cost ${ratio.toFixed(1)}× the project median`,
          body: `This session was ${formatUSD(session.cost_usd || 0)}. Median across the prior ${priorSessions.length} sessions: ${formatUSD(median)}.`,
        });
      }
    }
  }

  // STUCK_LOOP_STREAK — >2 repeated-run signals within this session.
  if (stuckLoopCount > STUCK_LOOP_STREAK_PER_SESSION) {
    alerts.push({
      kind: KINDS.STUCK_LOOP_STREAK,
      severity: 'warn',
      title: `${stuckLoopCount} repeated-run signals in one session`,
      body: `Session ${(session.session_uuid || '').slice(0,8)} fired ${stuckLoopCount} repeated-run detections. Open the session and check the confidence labels before treating any as a loop.`,
    });
  }

  // MULTI_PROJECT_USAGE — org with sessions in 3+ projects.
  // Note: scope='org' so the repository dedupes on (org, kind) — exactly one
  // row per org regardless of how many sessions get ingested.
  if (projectSessionCount >= MULTI_PROJECT_THRESHOLD) {
    alerts.push({
      kind: KINDS.MULTI_PROJECT_USAGE,
      severity: 'info',
      scope: 'org',
      title: `You have Claude Code sessions across ${projectSessionCount} projects`,
      body: `Code Sessions is tracking activity in multiple projects this period. Use the project switcher to compare cost trends across them.`,
    });
  }

  // Cost-anomaly + stuck-loop are session-scoped by default. Tag explicitly
  // so the repository knows what tuple to dedup on.
  for (const a of alerts) {
    if (!a.scope) a.scope = 'session';
  }

  return alerts;
}

export interface DetectCacheCraterInput {
  thisWeek: CacheTotals;
  priorWeek: (CacheTotals & { input_tokens: number; cache_read_tokens: number; cache_creation_tokens: number }) | null | undefined;
  project: { slug?: string };
}

// Compare two weeks of cache hit rate per project; emit a CACHE_CRATER alert
// if the drop is > CACHE_CRATER_PP_DROP percentage points.
export function detectCacheCrater({ thisWeek, priorWeek, project }: DetectCacheCraterInput): Alert | null {
  if (!priorWeek || (priorWeek.input_tokens + priorWeek.cache_read_tokens + priorWeek.cache_creation_tokens) === 0) return null;
  const a = cacheHitRate(priorWeek);
  const b = cacheHitRate(thisWeek);
  const deltaPP = (a - b) * 100;
  if (deltaPP < CACHE_CRATER_PP_DROP) return null;
  return {
    kind: KINDS.CACHE_CRATER,
    severity: 'warn',
    title: `Cache hit rate dropped ${deltaPP.toFixed(1)}pp in ${project.slug}`,
    body: `Prior week: ${(a * 100).toFixed(1)}% → this week: ${(b * 100).toFixed(1)}%.`,
  };
}

export interface ScopeDefaults {
  project_id?: string | null;
  session_id?: string | null;
}

// Apply an alert's `scope` to derive the (project_id, session_id) tuple used
// for dedup and storage. Scope='session' uses both; 'project' clears
// session_id; 'org' clears both so there's exactly one row per (org, kind).
export function resolveScope(
  alert: { scope?: string },
  defaults: ScopeDefaults,
): { project_id: string | null; session_id: string | null } {
  const scope = alert.scope || 'session';
  if (scope === 'org' || scope === 'user') return { project_id: null, session_id: null };
  if (scope === 'project') return { project_id: defaults.project_id ?? null, session_id: null };
  return { project_id: defaults.project_id ?? null, session_id: defaults.session_id ?? null };
}

export function digestMarkdown(alerts: Array<{ kind: string; title: string; body?: string }>): string {
  if (!alerts.length) return '# Code Sessions daily digest\n\nNo alerts in the last 24h. \n';
  const lines = ['# Code Sessions daily digest', ''];
  for (const kind of Object.values(KINDS)) {
    const slice = alerts.filter(a => a.kind === kind);
    if (!slice.length) continue;
    lines.push(`## ${humanKind(kind)}`);
    for (const a of slice) {
      lines.push(`- **${a.title}**`);
      if (a.body) lines.push(`  ${a.body}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

export function humanKind(k: string): string {
  return ({
    [KINDS.COST_ANOMALY]: 'Cost anomalies',
    [KINDS.CACHE_CRATER]: 'Cache craters',
    [KINDS.STUCK_LOOP_STREAK]: 'Repeated-run streaks',
    [KINDS.MULTI_PROJECT_USAGE]: 'Multi-project usage',
  } as Record<string, string>)[k] || k;
}
