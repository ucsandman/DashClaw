export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db';
import { listActions } from '../../../lib/repositories/actions.repository';
import { listAgentsForOrg } from '../../../lib/repositories/agents.repository';
import { computeSignals } from '../../../lib/signals';
import { readDesktopPresence } from '../../../lib/widget/presence';
import { truncateWords, GOAL_MAX_CHARS, type PulseSnapshot, type PulsePendingRow } from '../../../lib/widget/pulse';
import { apiErrorResponse } from '../../../lib/apiErrors';

const WINDOW_MINUTES = 60;
const RECENT_LIMIT = 25;
const PENDING_ROWS_LIMIT = 5;

type Row = Record<string, unknown>;

const str = (v: unknown): string | null => (v == null ? null : String(v));

/**
 * Whitelist-map a pending action row. NEVER spreads the raw row —
 * output_summary / reasoning / side_effects / model / cost never reach the
 * widget; declared_goal is word-boundary capped (spec §5.3, non-goal #6).
 */
function toPendingRow(row: Row): PulsePendingRow {
  return {
    actionId: str(row.action_id),
    actionType: str(row.action_type),
    agentName: str(row.agent_name ?? row.agent_id),
    riskScore: Number(row.risk_score) || 0,
    timestampStart: str(row.timestamp_start ?? row.created_at),
    declaredGoal: row.declared_goal ? truncateWords(row.declared_goal, GOAL_MAX_CHARS) : null,
  };
}

/**
 * GET /api/widget/pulse — the Pulse snapshot: one composed, whitelisted,
 * partial-failure-tolerant payload for the /widget surface. Composed entirely
 * from existing repositories/libs (no direct SQL — route-sql guardrail).
 *
 * Honesty rule H5 (docs/decisions/2026-08-09-widget-pulse.md §8): a failed
 * sub-query never renders as zero — it appends its name to `queriesDegraded`
 * and the client renders the DEGRADED posture, not a false calm.
 */
export async function GET(request: Request) {
  // Defensive auth: middleware injects x-org-id for authenticated requests.
  // No header means no authenticated context — never fall back to a default org.
  const orgId = request.headers.get('x-org-id');
  if (!orgId) {
    return NextResponse.json({ error: 'Missing organization context' }, { status: 401 });
  }

  try {
    const sql = getSql();
    const now = Date.now();
    const queriesDegraded: string[] = [];
    const degrade = <T>(name: string, fallback: T) => (): T => {
      queriesDegraded.push(name);
      return fallback;
    };

    const [recent, pending, signals, agents] = await Promise.all([
      listActions(sql, orgId, { limit: RECENT_LIMIT }).catch(
        degrade('recent', { actions: [] as Row[], total: 0, stats: {} as Row }),
      ),
      listActions(sql, orgId, { status: 'pending_approval', limit: PENDING_ROWS_LIMIT }).catch(
        degrade('pending', { actions: [] as Row[], total: 0, stats: {} as Row }),
      ),
      computeSignals(orgId, null, sql).catch(degrade('signals', [])),
      listAgentsForOrg(sql, orgId).catch(degrade('agents', [])),
    ]);

    // Presence is machine-local best-effort; a read failure is `unknown`,
    // never a degraded posture (rule R4 — presence never drives the ring).
    let presence: PulseSnapshot['presence'];
    try {
      presence = readDesktopPresence(now);
    } catch {
      presence = { verdict: 'unknown', frameAgeSeconds: null };
    }

    let red = 0;
    let amber = 0;
    let top: PulseSnapshot['signals']['top'] = null;
    for (const s of signals) {
      if (s.severity === 'red') red += 1;
      else if (s.severity === 'amber') amber += 1;
      if (!top || (top.severity === 'amber' && s.severity === 'red')) {
        top = { severity: s.severity, kind: s.type, label: truncateWords(s.label, 80) };
      }
    }

    const windowMs = WINDOW_MINUTES * 60 * 1000;
    let activeCount = 0;
    let lastActiveAt: string | null = null;
    for (const a of agents) {
      const t = a.last_active ? new Date(a.last_active).getTime() : NaN;
      if (!Number.isFinite(t)) continue;
      if (now - t <= 15 * 60 * 1000) activeCount += 1;
      if (!lastActiveAt || t > new Date(lastActiveAt).getTime()) lastActiveAt = str(a.last_active);
    }

    const recentActions = Array.isArray(recent.actions) ? (recent.actions as Row[]) : [];
    const lastActionAt = str(recentActions[0]?.timestamp_start ?? recentActions[0]?.created_at);
    const recentActionCount = recentActions.filter((r) => {
      const t = new Date(String(r.timestamp_start ?? r.created_at ?? '')).getTime();
      return Number.isFinite(t) && now - t <= windowMs;
    }).length;

    const body: PulseSnapshot = {
      asOf: new Date(now).toISOString(),
      windowMinutes: WINDOW_MINUTES,
      pending: {
        count: Number(pending.total) || 0,
        rows: (Array.isArray(pending.actions) ? (pending.actions as Row[]) : []).map(toPendingRow),
      },
      signals: { red, amber, top },
      agents: { activeCount, lastActiveAt },
      lastActionAt,
      recentActionCount,
      queriesDegraded,
      presence,
    };

    return NextResponse.json(body);
  } catch (error) {
    return apiErrorResponse(error, 'WIDGET_PULSE');
  }
}
