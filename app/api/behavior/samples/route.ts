export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db';
import { getOrgId } from '../../../lib/org';
import { sampleStatus, recentSamples } from '../../../lib/behavior/sample-store';
import { listBehaviorSamples } from '../../../lib/repositories/behavior.repository';
import { DEFAULT_OPTIONS } from '../../../lib/behavior/analyzer';

/** Project a DB-backed sample into the RecentSample-shaped UI record. */
function projectDbSample(s: Record<string, unknown>) {
  return {
    event_id: String(s.event_id),
    ts: s.ts,
    agent_id: s.agent_id,
    agent_name: null,
    tool: s.tool ?? null,
    action_type: s.action_type ?? null,
    command_shape: s.command_shape ?? null,
    read_paths: Array.isArray(s.read_paths) ? s.read_paths : [],
    write_paths: Array.isArray(s.write_paths) ? s.write_paths : [],
    risk_score: (s.risk_score ?? null) as number | string | null,
    guard_decision: (s.guard_decision ?? null) as string | null,
    outcome_status: (s.outcome_status ?? null) as string | null,
  };
}

/** Build the status payload from DB-backed samples (uploaded source). */
function statusFromDbSamples(samples: Record<string, unknown>[]) {
  const agents = new Map<string, number>();
  const byDay: Record<string, number> = {};
  let oldest: string | null = null;
  let newest: string | null = null;
  for (const s of samples) {
    const agentId = String(s.agent_id || '');
    agents.set(agentId, (agents.get(agentId) || 0) + 1);
    const ts = String(s.ts || '');
    const day = ts.slice(0, 10);
    if (day) byDay[day] = (byDay[day] || 0) + 1;
    if (ts && (!oldest || ts < oldest)) oldest = ts;
    if (ts && (!newest || ts > newest)) newest = ts;
  }
  return {
    sample_count: samples.length,
    agent_count: agents.size,
    agents: [...agents.entries()].map(([agent_id, count]) => ({ agent_id, count })).sort((a, b) => b.count - a.count),
    oldest_ts: oldest,
    newest_ts: newest,
    by_day: byDay,
  };
}

/**
 * GET /api/behavior/samples — status of the behavior samples the Policy Coach
 * analyzes. Prefers the LOCAL sample log when it holds any samples (the local
 * files are machine-global by nature — the filesystem has no org axis), else
 * falls back to this org's UPLOADED anonymized samples; `sample_source`
 * reports which one was used. Reports recorder enablement, counts, observed
 * agents, and the captured window.
 *
 * With `?list=N`, instead returns the N most recent REDACTED sample records
 * (event_id, ts, tool, action_type, command_shape, paths — hashes when
 * uploaded — risk, guard_decision, outcome) for the "Recent samples" browser.
 * @beta
 */
export async function GET(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const listParam = new URL(request.url).searchParams.get('list');
    if (listParam !== null) {
      const n = Math.min(Math.max(parseInt(listParam, 10) || 25, 1), 200);
      const local = await recentSamples(n);
      if (local.length > 0) {
        return NextResponse.json({ samples: local, count: local.length, sample_source: 'local' });
      }
      const uploaded = (await listBehaviorSamples(sql, orgId, { limit: n })).map(projectDbSample);
      return NextResponse.json({ samples: uploaded, count: uploaded.length, sample_source: 'uploaded' });
    }
    const status = await sampleStatus();
    const minSamples = DEFAULT_OPTIONS.minSamples;
    if (status.sample_count > 0) {
      const ready = status.agents.some((a: { count: number }) => a.count >= minSamples);
      return NextResponse.json({ ...status, ready, min_samples: minSamples, sample_source: 'local' });
    }
    // No local samples — fall back to the org-scoped uploaded store.
    const dbSamples = await listBehaviorSamples(sql, orgId, {});
    const dbStatus = statusFromDbSamples(dbSamples);
    const ready = dbStatus.agents.some((a) => a.count >= minSamples);
    return NextResponse.json({
      recorder_enabled: status.recorder_enabled,
      remote: status.remote,
      dir: status.dir,
      ...dbStatus,
      ready,
      min_samples: minSamples,
      sample_source: 'uploaded',
    });
  } catch (err) {
    console.error('[behavior/samples] GET error:', (err as Error).message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
