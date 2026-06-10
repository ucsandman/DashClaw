/**
 * Opportunistic drift tick — makes the drift engine self-feeding on the free
 * tier (no cron). Fired from GET /api/drift/stats (the drift page + dashboard
 * DriftCard both load it), NEVER from the guard/pretool hot path.
 *
 * Discipline (these are acceptance criteria, not suggestions):
 *  - DEBOUNCE: at most one run per org per 24h, tracked by a settings marker
 *    that is claimed BEFORE the run (concurrent page loads cannot stampede).
 *  - TIME BUDGET: stops picking up the next agent once the budget is spent —
 *    Vercel keeps the function alive only until the response, so the tick is
 *    awaited (bounded), not detached.
 *  - AGENT CAP: at most N most-recently-active agents per tick; a large fleet
 *    is covered across successive daily ticks rather than in one burst.
 */
import { getSql } from './db';
import { getOrgId } from './org';
import { computeBaselines, detectDrift, recordSnapshots } from './drift';
import { upsertSetting } from './repositories/settings.repository';

export const DRIFT_TICK_MIN_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const DRIFT_TICK_TIME_BUDGET_MS = 4000;
export const DRIFT_TICK_MAX_AGENTS = 10;
export const DRIFT_TICK_MARKER_KEY = 'DRIFT_TICK_LAST_RUN_AT';

export interface DriftTickResult {
  ran: boolean;
  reason?: string;
  last_run_at: string | null;
  agents_processed?: number;
  agents_considered?: number;
  elapsed_ms?: number;
}

interface TickOptions {
  now?: () => number;
  minIntervalMs?: number;
  budgetMs?: number;
  maxAgents?: number;
}

export async function maybeRunDriftTick(request: Request, opts: TickOptions = {}): Promise<DriftTickResult> {
  const now = opts.now ?? Date.now;
  const minIntervalMs = opts.minIntervalMs ?? DRIFT_TICK_MIN_INTERVAL_MS;
  const budgetMs = opts.budgetMs ?? DRIFT_TICK_TIME_BUDGET_MS;
  const maxAgents = opts.maxAgents ?? DRIFT_TICK_MAX_AGENTS;
  const sql = getSql();
  const orgId = getOrgId(request);

  // Debounce — one cheap single-row read.
  let lastRunAt: number | null = null;
  try {
    const rows = await sql`
      SELECT value FROM settings
      WHERE org_id = ${orgId} AND key = ${DRIFT_TICK_MARKER_KEY} AND agent_id IS NULL
      LIMIT 1
    `;
    const t = Date.parse(String((rows?.[0] as { value?: string } | undefined)?.value ?? ''));
    if (Number.isFinite(t)) lastRunAt = t;
  } catch { /* settings table optional — treat as never-ran */ }

  if (lastRunAt !== null && now() - lastRunAt < minIntervalMs) {
    return { ran: false, reason: 'debounced', last_run_at: new Date(lastRunAt).toISOString() };
  }

  // Claim the marker BEFORE running. If the claim fails we do NOT run — a tick
  // without a working debounce would amplify load on every stats request.
  const startedIso = new Date(now()).toISOString();
  try {
    await upsertSetting(sql, orgId, { key: DRIFT_TICK_MARKER_KEY, value: startedIso, category: 'system' });
  } catch (err) {
    console.warn('[drift-tick] marker claim failed — skipping run:', (err as Error)?.message);
    return { ran: false, reason: 'marker_write_failed', last_run_at: lastRunAt ? new Date(lastRunAt).toISOString() : null };
  }

  const started = now();

  // Most recently active agents first; the cap bounds per-tick work.
  let agents: Array<{ agent_id: string }> = [];
  try {
    agents = (await sql`
      SELECT agent_name AS agent_id FROM action_records
      WHERE org_id = ${orgId} AND agent_name IS NOT NULL AND agent_name != ''
      GROUP BY agent_name ORDER BY MAX(created_at) DESC LIMIT ${maxAgents}
    `) as unknown as Array<{ agent_id: string }>;
  } catch (err) {
    console.warn('[drift-tick] agent listing failed:', (err as Error)?.message);
    return { ran: true, reason: 'agent_list_failed', last_run_at: startedIso, agents_processed: 0, agents_considered: 0, elapsed_ms: now() - started };
  }

  let processed = 0;
  for (const row of agents) {
    if (now() - started >= budgetMs) break; // hard time budget between agents
    try {
      await computeBaselines(request, { agent_id: row.agent_id });
      await detectDrift(request, { agent_id: row.agent_id });
      await recordSnapshots(request, { agent_id: row.agent_id });
      processed++;
    } catch (err) {
      console.warn(`[drift-tick] agent ${row.agent_id} failed:`, (err as Error)?.message);
    }
  }

  return {
    ran: true,
    last_run_at: startedIso,
    agents_processed: processed,
    agents_considered: agents.length,
    elapsed_ms: now() - started,
  };
}
