export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getOrgId } from '../../../lib/org';
import { getSql } from '../../../lib/db';
import { getSettings, upsertSetting } from '../../../lib/repositories/settings.repository';

const SNAPSHOT_KEY = 'BEHAVIOR_INSIGHTS_SNAPSHOT';
const MAX_AGENTS = 25;
const VALUE_CAP = 9500; // stay under the settings repo's 10000-char value limit

/**
 * The SAFE aggregate the hosted Policy Coach renders to show DashClaw is alive
 * and learning. This is the ONLY behavior data that ever reaches the server:
 * counts, per-agent tallies, signal totals, and timestamps. It deliberately
 * carries NO command shapes, paths, goals, or any other raw behavioral detail —
 * those stay on the machine the agents run on. The POST handler rebuilds the
 * snapshot field-by-field from this allowlist so a malformed or over-sharing
 * client payload cannot smuggle anything else into storage.
 */
interface AgentTally {
  agent_id: string;
  count: number;
  destructive: number;
  protected_writes: number;
  failed: number;
  tools: number;
}
interface Snapshot {
  schema_version: number;
  pushed_at: string;
  host_label: string | null;
  window_days: number;
  sample_count: number;
  agent_count: number;
  oldest_ts: string | null;
  newest_ts: string | null;
  signals: {
    destructive_commands: number;
    protected_path_writes: number;
    failed_actions: number;
    high_risk_actions: number;
    blocked: number;
    approvals: number;
  };
  agents: AgentTally[];
}

function clampInt(v: unknown, min: number, max: number): number {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

/** Accept a short ISO-ish timestamp string; reject anything else. */
function cleanTs(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim().slice(0, 40);
  return Number.isFinite(Date.parse(s)) ? s : null;
}

/**
 * Keep identifiers/labels short and free of control characters. Filters by
 * code point (drops anything below 0x20 and DEL) so printable id characters
 * like '-' and '/' in "claude-code/workflow-subagent" survive intact.
 */
function cleanLabel(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  let s = '';
  for (const ch of v) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 0x20 && code !== 0x7f) s += ch;
  }
  s = s.trim().slice(0, max);
  return s || null;
}

function toMap(rows: Array<{ key: string; value: unknown }> | null | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const r of rows || []) out[r.key] = r.value;
  return out;
}

/** Rebuild a safe snapshot from untrusted client JSON. Returns null if unusable. */
function sanitize(body: Record<string, unknown>): Snapshot | null {
  if (!body || typeof body !== 'object') return null;
  const rawAgents = Array.isArray(body.agents) ? body.agents : [];
  const agents: AgentTally[] = rawAgents
    .slice(0, MAX_AGENTS)
    .map((a) => {
      const agent = (a && typeof a === 'object' ? a : {}) as Record<string, unknown>;
      const agent_id = cleanLabel(agent.agent_id, 128);
      if (!agent_id) return null;
      return {
        agent_id,
        count: clampInt(agent.count, 0, 1e9),
        destructive: clampInt(agent.destructive, 0, 1e9),
        protected_writes: clampInt(agent.protected_writes, 0, 1e9),
        failed: clampInt(agent.failed, 0, 1e9),
        tools: clampInt(agent.tools, 0, 10000),
      };
    })
    .filter((a): a is AgentTally => a !== null);

  const sig = (body.signals && typeof body.signals === 'object' ? body.signals : {}) as Record<string, unknown>;
  const sampleCount = clampInt(body.sample_count, 0, 1e12);
  // Reject an empty payload — nothing meaningful to show, and storing it would
  // overwrite a good prior snapshot with zeros.
  if (sampleCount <= 0 && agents.length === 0) return null;

  return {
    schema_version: 1,
    pushed_at: new Date().toISOString(),
    host_label: cleanLabel(body.host_label, 64),
    window_days: clampInt(body.window_days, 1, 365),
    sample_count: sampleCount,
    agent_count: clampInt(body.agent_count, 0, 1e9) || agents.length,
    oldest_ts: cleanTs(body.oldest_ts),
    newest_ts: cleanTs(body.newest_ts),
    signals: {
      destructive_commands: clampInt(sig.destructive_commands, 0, 1e12),
      protected_path_writes: clampInt(sig.protected_path_writes, 0, 1e12),
      failed_actions: clampInt(sig.failed_actions, 0, 1e12),
      high_risk_actions: clampInt(sig.high_risk_actions, 0, 1e12),
      blocked: clampInt(sig.blocked, 0, 1e12),
      approvals: clampInt(sig.approvals, 0, 1e12),
    },
    agents,
  };
}

/** Serialize, trimming the agents list if needed to fit the storage cap. */
function serializeWithinCap(snapshot: Snapshot): string {
  let json = JSON.stringify(snapshot);
  while (json.length > VALUE_CAP && snapshot.agents.length > 0) {
    snapshot.agents.pop();
    json = JSON.stringify(snapshot);
  }
  return json;
}

/**
 * GET /api/behavior/insights — the latest aggregate snapshot for this org, or
 * { snapshot: null } if none has been pushed. Read by the hosted Policy Coach
 * to render the "learning in the background" panel. @beta
 */
export async function GET(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const map = toMap(await getSettings(sql, orgId, { key: SNAPSHOT_KEY }) as Array<{ key: string; value: unknown }>);
    const raw = map[SNAPSHOT_KEY];
    if (typeof raw !== 'string' || !raw) return NextResponse.json({ snapshot: null });
    try {
      return NextResponse.json({ snapshot: JSON.parse(raw) });
    } catch {
      return NextResponse.json({ snapshot: null });
    }
  } catch (err) {
    console.error('[behavior/insights] GET error:', (err as Error).message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/behavior/insights — the agent's machine pushes a SAFE aggregate
 * snapshot (see Snapshot above). Authenticated by API key (org resolved from
 * the key). The handler rebuilds the snapshot from an allowlist, so only the
 * known aggregate fields are ever stored — raw behavior cannot leak through.
 */
export async function POST(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
    }
    const snapshot = sanitize(body as Record<string, unknown>);
    if (!snapshot) {
      return NextResponse.json({ error: 'Empty or invalid snapshot' }, { status: 400 });
    }
    // Monotonic guard: with multiple machines pushing for one org, a host with
    // an OLDER sample window must not clobber a newer snapshot (last-writer-
    // wins otherwise). Compare the data timestamps (newest_ts); skip the write
    // when the incoming snapshot is provably older.
    const stored = toMap(await getSettings(sql, orgId, { key: SNAPSHOT_KEY }) as Array<{ key: string; value: unknown }>)[SNAPSHOT_KEY];
    if (typeof stored === 'string' && stored) {
      try {
        const prev = JSON.parse(stored) as { newest_ts?: string; pushed_at?: string };
        const prevTs = Date.parse(prev?.newest_ts || prev?.pushed_at || '');
        const nextTs = Date.parse(snapshot.newest_ts || '');
        if (Number.isFinite(prevTs) && Number.isFinite(nextTs) && nextTs < prevTs) {
          return NextResponse.json({ skipped: true, reason: 'stale' });
        }
      } catch { /* corrupt stored snapshot — let the new one replace it */ }
    }
    await upsertSetting(sql, orgId, {
      key: SNAPSHOT_KEY,
      value: serializeWithinCap(snapshot),
      category: 'general',
    });
    return NextResponse.json({ ok: true, pushed_at: snapshot.pushed_at });
  } catch (err) {
    console.error('[behavior/insights] POST error:', (err as Error).message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
