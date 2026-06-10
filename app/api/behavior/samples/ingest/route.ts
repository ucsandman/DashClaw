export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getOrgId } from '../../../../lib/org';
import { getSql } from '../../../../lib/db';
import { getSettings } from '../../../../lib/repositories/settings.repository';
import {
  upsertBehaviorSamples,
  pruneBehaviorSamples,
} from '../../../../lib/repositories/behavior.repository';
import type { SanitizedBehaviorSample } from '../../../../lib/repositories/behavior.repository';
import { redactString } from '../../../../lib/behavior/redaction';
import { PROTECTED_PATH_GROUPS } from '../../../../lib/behavior/path-match';

const MAX_BATCH = 500; // samples per request
const MAX_BODY_BYTES = 1_000_000; // ~1MB payload ceiling
const MAX_PATHS = 50; // per path list
const MAX_GROUPS = 10;
const KNOWN_GROUPS = new Set(Object.keys(PROTECTED_PATH_GROUPS));

/** Short identifier/label: control chars stripped, trimmed, bounded. */
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

/** Free-text field: label-cleaned AND secret-scrubbed server-side. */
function cleanText(v: unknown, max: number): string | null {
  const s = cleanLabel(v, max);
  if (s == null) return null;
  const scrubbed = String(redactString(s)).slice(0, max);
  return scrubbed || null;
}

/** ISO-ish timestamp, normalized; null when unparseable. */
function cleanTs(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = Date.parse(v.trim().slice(0, 40));
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function clampInt(v: unknown, min: number, max: number): number | null {
  if (v == null || v === '') return null;
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return null;
  return Math.max(min, Math.min(max, n));
}

// Upload-shape path entries MUST be the client's salted hash tokens — the
// server enforces the format (security-review hardening) so a misbehaving
// client cannot persist raw paths under the hash columns. Raw-path uploads
// are silently dropped; the local sample store remains the place for paths.
const PATH_HASH_RE = /^ph_[0-9a-f]{12}$/;
const SESSION_HASH_RE = /^sh_[0-9a-f]{12}$/;

/** Path-hash list: accepts read_paths/read_path_hashes naming; hash-enforced. */
function cleanPathList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const p of v.slice(0, MAX_PATHS)) {
    if (typeof p === 'string' && PATH_HASH_RE.test(p)) out.push(p);
  }
  return out;
}

/** write_path_groups restricted to the canonical protected-group labels. */
function cleanGroups(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const g of v.slice(0, MAX_GROUPS)) {
    if (typeof g === 'string' && KNOWN_GROUPS.has(g)) out.push(g);
  }
  return out;
}

/**
 * Rebuild ONE sample row field-by-field from an explicit allowlist (the same
 * discipline as the insights sanitize()): unknown fields can never reach the
 * DB, every string is re-redacted server-side, every number is clamped.
 * Returns null when the row lacks the required identity (event_id, agent_id,
 * parseable ts).
 */
function sanitizeSample(raw: unknown): SanitizedBehaviorSample | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  const event_id = cleanLabel(s.event_id, 64);
  const agent_id = cleanLabel(s.agent_id, 128);
  const ts = cleanTs(s.ts);
  if (!event_id || !agent_id || !ts) return null;

  const outcome_status = cleanLabel(s.outcome_status, 32);
  return {
    event_id,
    ts,
    agent_id,
    session_hash: typeof s.session_hash === 'string' && SESSION_HASH_RE.test(s.session_hash) ? s.session_hash : null,
    source: cleanLabel(s.source, 64),
    tool: cleanLabel(s.tool, 64),
    tool_category: cleanLabel(s.tool_category, 64),
    action_type: cleanLabel(s.action_type, 64),
    command_shape: cleanText(s.command_shape, 400),
    bash_intent: cleanLabel(s.bash_intent, 32),
    risk_score: clampInt(s.risk_score, 0, 100),
    guard_decision: cleanLabel(s.guard_decision, 32),
    reversible: s.reversible === true || s.reversible === 1 ? 1 : 0,
    model: cleanLabel(s.model, 128),
    read_path_hashes: cleanPathList(s.read_paths ?? s.read_path_hashes),
    write_path_hashes: cleanPathList(s.write_paths ?? s.write_path_hashes),
    write_path_groups: cleanGroups(s.write_path_groups),
    sensitive_path: s.sensitive_path === true || s.sensitive_path === 1 ? 1 : 0,
    outcome_status,
    error_type: cleanText(s.error_type, 200),
    duration_ms: clampInt(s.duration_ms, 0, 86_400_000),
    matched_policy_count: clampInt(s.matched_policy_count, 0, 10_000),
    // Mirrors pickFinalSample: anything past "running" is final.
    finalized: outcome_status && outcome_status !== 'running' ? 1 : 0,
  };
}

function toMap(rows: Array<{ key: string; value: unknown }> | null | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const r of rows || []) out[r.key] = r.value;
  return out;
}

/**
 * POST /api/behavior/samples/ingest — opt-in ANONYMIZED behavior-sample upload.
 * Authenticated by API key (org resolved from the key). Refuses unless the org
 * has explicitly enabled BEHAVIOR_UPLOAD_ENABLED, so the server enforces the
 * opt-in rather than trusting the client. Body: { samples: [...] }, max 500
 * per batch, ~1MB per payload. Every row is rebuilt field-by-field from an
 * allowlist and re-redacted server-side — input is treated as hostile; unknown
 * fields, raw paths, goals, and project names can never reach the DB.
 * Retention is pruned opportunistically. Returns { ingested, pruned }. @beta
 */
export async function POST(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);

    const text = await request.text().catch(() => '');
    if (text.length > MAX_BODY_BYTES) {
      return NextResponse.json({ error: `Payload too large (max ${MAX_BODY_BYTES} bytes)` }, { status: 413 });
    }
    let body: unknown = null;
    try {
      body = JSON.parse(text);
    } catch {
      return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
    }
    if (!body || typeof body !== 'object' || !Array.isArray((body as Record<string, unknown>).samples)) {
      return NextResponse.json({ error: 'Body must be { samples: [...] }' }, { status: 400 });
    }
    const rawSamples = (body as { samples: unknown[] }).samples;
    if (rawSamples.length === 0) {
      return NextResponse.json({ error: 'samples is empty' }, { status: 400 });
    }
    if (rawSamples.length > MAX_BATCH) {
      return NextResponse.json({ error: `Too many samples (max ${MAX_BATCH} per batch)` }, { status: 400 });
    }

    // Server-side opt-in gate: upload must be explicitly enabled for the org.
    const map = toMap(await getSettings(sql, orgId, { key: 'BEHAVIOR_UPLOAD_ENABLED' }) as Array<{ key: string; value: unknown }>);
    if (String(map.BEHAVIOR_UPLOAD_ENABLED || '').toLowerCase() !== 'true') {
      return NextResponse.json({ error: 'Behavior sample upload is not enabled for this org' }, { status: 403 });
    }

    const sanitized = rawSamples
      .map(sanitizeSample)
      .filter((s): s is SanitizedBehaviorSample => s !== null);
    if (sanitized.length === 0) {
      return NextResponse.json({ error: 'No valid samples in batch' }, { status: 400 });
    }

    const ingested = await upsertBehaviorSamples(sql, orgId, sanitized);
    const pruned = await pruneBehaviorSamples(sql, orgId);
    return NextResponse.json({ ingested, pruned });
  } catch (err) {
    console.error('[behavior/samples/ingest] POST error:', (err as Error).message);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
