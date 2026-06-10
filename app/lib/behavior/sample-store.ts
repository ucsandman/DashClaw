/**
 * Local behavior-sample store. Reads the redacted JSONL the Python recorder
 * (or any source that follows the documented contract) writes under
 * `.dashclaw/behavior-samples/`. This is the ONLY place the analyzer's input
 * comes from — samples never leave the machine and are never persisted to the
 * database. Defensively re-redacts every sample on read.
 *
 * Server-only (uses node:fs). Import from route handlers / CLI, never from a
 * 'use client' component.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { redactSample } from './redaction';
import { isHostedMode } from '../hosted/flag';

// Behavior samples are parsed from JSONL on disk; their shape follows the
// recorder contract but is treated as untrusted external data here.
type Sample = Record<string, any>;
type Dismissal = Record<string, any>;

const MAX_SAMPLES = 20000; // hard ceiling so a runaway log can't OOM the analyzer
const DISMISSALS_FILE = '.dismissals.json';

/** Resolve the samples directory. Override with DASHCLAW_BEHAVIOR_SAMPLES_DIR. */
export function resolveSamplesDir(): string {
  const override = process.env.DASHCLAW_BEHAVIOR_SAMPLES_DIR;
  if (override && override.trim()) return path.resolve(override.trim());
  return path.resolve(process.cwd(), '.dashclaw', 'behavior-samples');
}

/** Whether the recorder is switched on in this environment. */
export function recorderEnabled(): boolean {
  const v = (process.env.DASHCLAW_BEHAVIOR_SAMPLES_ENABLED || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

/**
 * True when this DashClaw server can NOT read the agents' behavior samples
 * because it is a hosted/serverless deployment (the app's hosted flag, or any
 * Vercel runtime). Samples are written to the LOCAL filesystem of the machine
 * the agents run on and never leave it, so a remote dashboard always reads an
 * empty directory — the Policy Coach must say so instead of claiming "nothing
 * captured yet". Analysis only works when DashClaw runs on that same machine.
 */
export function isRemoteInstance(): boolean {
  return isHostedMode() || Boolean(process.env.VERCEL);
}

async function listSampleFiles(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }
  // YYYY-MM-DD.jsonl files; newest filename last when sorted lexically.
  return entries
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f))
    .sort()
    .map((f) => path.join(dir, f));
}

function parseLines(text: string): Sample[] {
  const out: Sample[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const obj = JSON.parse(trimmed);
      if (obj && obj.event_id && obj.agent_id) out.push(redactSample(obj));
    } catch {
      // Skip malformed lines — a partially-written tail line must not break
      // the whole read.
    }
  }
  return out;
}

/**
 * Pick the surviving record when two share an event_id. The recorder writes a
 * "running" record at PreToolUse and a finalized one (completed/failed/
 * interrupted) with the SAME event_id later — so a finalized record supersedes a
 * "running" one; among same-tier records the latest ts wins.
 */
function pickFinalSample(a: Sample, b: Sample): Sample {
  const aRunning = a.outcome_status === 'running';
  const bRunning = b.outcome_status === 'running';
  if (aRunning !== bRunning) return aRunning ? b : a;
  return (Date.parse(b.ts) || 0) >= (Date.parse(a.ts) || 0) ? b : a;
}

/**
 * Collapse records that share an event_id into one (last-write-wins, finalized
 * over running). This keeps counts + analysis correct even when PostToolUse
 * misses: a pre+post pair becomes one finalized record; a pre-only event stays a
 * single "running"/"interrupted" record.
 */
function mergeByEventId(samples: Sample[]): Sample[] {
  const byId = new Map<string, Sample>();
  for (const s of samples) {
    const id = String(s.event_id);
    const existing = byId.get(id);
    byId.set(id, existing ? pickFinalSample(existing, s) : s);
  }
  return [...byId.values()];
}

/**
 * Read samples, newest-first across day files, MERGED by event_id. Optionally
 * limit by recency (days) and count.
 */
export async function readSamples({
  days = null,
  limit = MAX_SAMPLES,
}: { days?: number | null; limit?: number } = {}): Promise<Sample[]> {
  const dir = resolveSamplesDir();
  const files = (await listSampleFiles(dir)).reverse(); // newest day first
  const cutoff = days ? Date.now() - days * 86400_000 : null;
  const cap = Math.min(Number(limit) || MAX_SAMPLES, MAX_SAMPLES);
  const all: Sample[] = [];
  for (const file of files) {
    // Collect up to the hard ceiling (NOT the caller's cap) so merge-on-read
    // sees every record for an event before the count is trimmed.
    if (all.length >= MAX_SAMPLES) break;
    let text;
    try {
      text = await fs.readFile(file, 'utf-8');
    } catch {
      continue;
    }
    for (const s of parseLines(text)) {
      if (cutoff && Date.parse(s.ts) && Date.parse(s.ts) < cutoff) continue;
      all.push(s);
    }
  }
  // Merge duplicate event_ids, sort newest-first, then cap.
  const merged = mergeByEventId(all);
  merged.sort((a, b) => (Date.parse(b.ts) || 0) - (Date.parse(a.ts) || 0));
  return merged.slice(0, cap);
}

/** A redacted, UI-safe projection of a recent sample for the Policy Coach browser. */
export interface RecentSample {
  event_id: string;
  ts: string;
  agent_id: string;
  agent_name: string | null;
  tool: string | null;
  action_type: string | null;
  command_shape: string | null;
  read_paths: string[];
  write_paths: string[];
  risk_score: number | string | null;
  guard_decision: string | null;
  outcome_status: string | null;
}

/**
 * Recent merged samples projected to a redacted, UI-safe field set for the
 * "Recent samples" panel. Every record is already secret-scrubbed by
 * readSamples (which redacts on parse); this only narrows the surface.
 */
export async function recentSamples(limit = 25): Promise<RecentSample[]> {
  const samples = await readSamples({ limit });
  return samples.map((s) => ({
    event_id: String(s.event_id),
    ts: s.ts,
    agent_id: s.agent_id,
    agent_name: s.agent_name ?? null,
    tool: s.tool ?? null,
    action_type: s.action_type ?? null,
    command_shape: s.command_shape ?? null,
    read_paths: Array.isArray(s.read_paths) ? s.read_paths : [],
    write_paths: Array.isArray(s.write_paths) ? s.write_paths : [],
    risk_score: s.risk_score ?? null,
    guard_decision: s.guard_decision ?? null,
    outcome_status: s.outcome_status ?? null,
  }));
}

/** Lightweight status for the Policy Coach "sample status" panel. */
export async function sampleStatus() {
  const dir = resolveSamplesDir();
  const samples = await readSamples({ limit: MAX_SAMPLES });
  const agents = new Map<string, number>();
  const byDay: Record<string, number> = {};
  let oldest: string | null = null;
  let newest: string | null = null;
  for (const s of samples) {
    agents.set(s.agent_id, (agents.get(s.agent_id) || 0) + 1);
    const day = (s.ts || '').slice(0, 10);
    if (day) byDay[day] = (byDay[day] || 0) + 1;
    if (!oldest || s.ts < oldest) oldest = s.ts;
    if (!newest || s.ts > newest) newest = s.ts;
  }
  return {
    recorder_enabled: recorderEnabled(),
    remote: isRemoteInstance(),
    dir,
    sample_count: samples.length,
    agent_count: agents.size,
    agents: [...agents.entries()].map(([agent_id, count]) => ({ agent_id, count })).sort((a, b) => b.count - a.count),
    oldest_ts: oldest,
    newest_ts: newest,
    by_day: byDay,
  };
}

// ── Dismissals / accepted advisories (local, alongside the samples) ──────────

export async function readDismissals(): Promise<Dismissal[]> {
  const file = path.join(resolveSamplesDir(), DISMISSALS_FILE);
  try {
    const text = await fs.readFile(file, 'utf-8');
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Append (or replace by signature) a dismissal / accepted-advisory record.
 * `record` should carry { signature, agent_id, type, target, reason, status,
 * suppress_similar, ts }. Returns the full list. Best-effort; the directory is
 * created if missing.
 */
export async function writeDismissal(record: Dismissal): Promise<Dismissal[]> {
  const dir = resolveSamplesDir();
  const file = path.join(dir, DISMISSALS_FILE);
  const existing = await readDismissals();
  const next = existing.filter((d) => d.signature !== record.signature);
  next.push(record);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(file, JSON.stringify(next, null, 2), 'utf-8');
  return next;
}
