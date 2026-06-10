export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 60;

import zlib from 'node:zlib';
import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db';
import { getOrgId } from '../../../lib/org';
import { parseSessionLines } from '../../../lib/claude-code/parser';
import { detectRepeatedRuns } from '../../../lib/claude-code/repeated-runs';
import { runOptimizer } from '../../../lib/claude-code/optimizer';
import { detectForSession } from '../../../lib/claude-code/alerts';
import {
  upsertProject,
  upsertSessionWithChildren,
  getProjectSessionsChronological,
  replaceSignalsForSession,
  insertAlerts,
  listProjects,
} from '../../../lib/repositories/code-sessions.repository';

const MAX_LINES = 200_000;
// Cap decompressed payload at 50 MB. Vercel's per-IP body limit is 4.5 MB on
// Hobby; clients gzip large JSONL to fit. A 50 MB decompressed ceiling bounds
// the zip-bomb risk while still covering every JSONL we've seen in the wild
// (largest observed: 19 MB raw → ~3.3 MB gzipped).
const MAX_DECOMPRESSED_BYTES = 50 * 1024 * 1024;

/**
 * Read the request body, transparently inflating a compressed body.
 *
 * The wire transport for large JSONL is a compressed JSON envelope, flagged by
 * the custom `x-dashclaw-encoding` header: `br` (brotli, current CLI) or `gzip`
 * (older CLIs). We deliberately do NOT use the standard `Content-Encoding` —
 * proxies/CDNs (incl. Vercel's edge) may try to auto-decode or re-encode it,
 * which is exactly the ambiguity we want to avoid. A custom header is opaque to
 * every intermediary, so the bytes Vercel counts against its 4.5 MB request-body
 * cap are the compressed bytes. Brotli matters: our largest real sessions
 * (~14 MB raw JSONL) gzip to ~4.34 MB — over the cap — but brotli q9 brings the
 * same envelope to ~3.5 MB, comfortably under.
 *
 * Back-compat: plain JSON (`jsonl_lines`), base64 (`compressed_jsonl`), and the
 * older `gzip` wire encoding all still work unchanged.
 */
async function readRequestBody(request: Request): Promise<any> {
  const enc = (request.headers.get('x-dashclaw-encoding') || '').toLowerCase();
  if (enc !== 'gzip' && enc !== 'br') {
    return request.json();
  }
  const compressed = Buffer.from(await request.arrayBuffer());
  let inflated;
  try {
    inflated = enc === 'br'
      ? zlib.brotliDecompressSync(compressed, { maxOutputLength: MAX_DECOMPRESSED_BYTES })
      : zlib.gunzipSync(compressed, { maxOutputLength: MAX_DECOMPRESSED_BYTES });
  } catch (err) {
    // Both gunzipSync and brotliDecompressSync throw ERR_BUFFER_TOO_LARGE once
    // output would exceed maxOutputLength — surface it as the same 413 contract
    // as the base64 path's size guard.
    const errMessage = (err as Error).message;
    const errCode = (err as { code?: string }).code;
    const wrapped = new Error(enc + ' body inflate failed: ' + errMessage) as Error & { code?: string };
    if (errCode === 'ERR_BUFFER_TOO_LARGE' || /maxOutputLength|too large/i.test(errMessage)) {
      wrapped.code = 'GZIP_TOO_LARGE';
    } else {
      wrapped.code = 'GZIP_DECODE_FAILED';
    }
    throw wrapped;
  }
  return JSON.parse(inflated.toString('utf8'));
}

function deriveSlugFromCwd(cwd: unknown): string {
  if (!cwd) return 'unknown';
  const segs = String(cwd).split(/[\\/]/).filter(Boolean);
  const last = segs[segs.length - 1] || 'unknown';
  return last.replace(/[^A-Za-z0-9_.-]+/g, '-').slice(0, 80) || 'unknown';
}

export async function POST(request: Request) {
  let body: any;
  try {
    body = await readRequestBody(request);
  } catch (err) {
    const errCode = (err as { code?: string }).code;
    const errMessage = (err as Error).message;
    if (errCode === 'GZIP_TOO_LARGE') {
      return NextResponse.json(
        { error: 'gzip_body_too_large_after_decode', max_bytes: MAX_DECOMPRESSED_BYTES },
        { status: 413 },
      );
    }
    if (errCode === 'GZIP_DECODE_FAILED') {
      return NextResponse.json({ error: 'gzip_body_decode_failed', reason: errMessage }, { status: 400 });
    }
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const project = body?.project || {};
  const sourceHost = project.source_host || 'jsonl';
  if (sourceHost !== 'hook' && sourceHost !== 'jsonl') {
    return NextResponse.json({ error: 'invalid_source_host', reason: 'must be "hook" or "jsonl"' }, { status: 400 });
  }

  let lines = Array.isArray(body?.jsonl_lines) ? body.jsonl_lines : null;
  const compressed = typeof body?.compressed_jsonl === 'string' ? body.compressed_jsonl : null;

  if (!lines && !compressed) {
    return NextResponse.json({ error: 'missing_jsonl_lines' }, { status: 400 });
  }

  if (!lines && compressed) {
    let decompressed;
    try {
      decompressed = zlib.gunzipSync(Buffer.from(compressed, 'base64'));
    } catch (err) {
      return NextResponse.json(
        { error: 'compressed_jsonl_decode_failed', reason: (err as Error).message },
        { status: 400 },
      );
    }
    if (decompressed.length > MAX_DECOMPRESSED_BYTES) {
      return NextResponse.json(
        { error: 'compressed_jsonl_too_large_after_decode', max_bytes: MAX_DECOMPRESSED_BYTES },
        { status: 413 },
      );
    }
    lines = decompressed.toString('utf8').split('\n').filter((l: string) => l.length > 0);
  }

  if (lines.length > MAX_LINES) {
    return NextResponse.json({ error: 'jsonl_lines_too_large', max: MAX_LINES }, { status: 413 });
  }

  const slug = (typeof project.slug === 'string' && project.slug.trim())
    ? project.slug.trim()
    : deriveSlugFromCwd(project.cwd);

  const parsed = parseSessionLines(lines, {
    mtime: body?.source_mtime || null,
    sourceFile: body?.source_file || null,
  });

  if (!parsed.sessionUuid) {
    return NextResponse.json({
      error: 'no_session_uuid_in_jsonl',
      reason: 'No assistant record with a sessionId was found in jsonl_lines',
      parsed_skipped_lines: parsed.skippedLines,
      jsonl_records: parsed.jsonlRecords,
    }, { status: 400 });
  }

  if (body?.session_uuid && body.session_uuid !== parsed.sessionUuid) {
    return NextResponse.json({
      error: 'mismatched_session_uuid',
      client_session_uuid: body.session_uuid,
      parser_session_uuid: parsed.sessionUuid,
    }, { status: 400 });
  }

  const sql = getSql();
  const orgId = getOrgId(request);

  // The CLI backfill sends cwd:null (it only knows the encoded dir slug), but
  // the parser recovers the real working directory from the JSONL records —
  // fall back to it so projects display a copy-pasteable path, not a slug.
  const projectRow = (await upsertProject(sql, orgId, {
    slug,
    cwd: project.cwd || (parsed as { cwd?: string | null }).cwd || null,
    source_host: sourceHost,
  })) as { id: string; slug: string };

  const upsert = await upsertSessionWithChildren(sql, orgId, parsed as unknown as Parameters<typeof upsertSessionWithChildren>[2], {
    projectId: projectRow.id,
    toolUseActionMap: body?.tool_use_action_map && typeof body.tool_use_action_map === 'object'
      ? body.tool_use_action_map
      : {},
    source: sourceHost,
  });

  // Signals + alerts pass. Skipped re-ingests don't recompute — the stored
  // signals are still valid for unchanged input.
  let signalsInserted = 0;
  let alertsInserted = 0;
  if (!upsert.skipped && upsert.sessionId) {
    try {
      const projectSessions = await getProjectSessionsChronological(sql, orgId, projectRow.id);
      const priorSessions = projectSessions.filter((s: any) => s.id !== upsert.sessionId);
      const toolEvents = (parsed.toolUses || []).map((t: any) => ({
        name: t.name, requestId: t.requestId, target: t.target,
      }));
      const repeatedRuns = detectRepeatedRuns(toolEvents);
      const stuckLoops = repeatedRuns.filter((r: any) => r.confidence === 'high');
      const sessionForRules = {
        ...projectSessions.find((s: any) => s.id === upsert.sessionId),
        model_primary: parsed.modelPrimary,
        cost_usd: Number(parsed.cost_usd) || 0,
        input_tokens: parsed.totals?.input_tokens || 0,
        output_tokens: parsed.totals?.output_tokens || 0,
        cache_read_tokens: parsed.totals?.cache_read_tokens || 0,
        cache_creation_tokens: parsed.totals?.cache_creation_tokens || 0,
        message_count: parsed.messageCount || 0,
      };
      const findings = runOptimizer({
        session: sessionForRules,
        stuckLoops,
        repeatedRuns,
        toolCount: toolEvents.length,
        toolEvents,
        subagentInvocations: [],
        projectSessions,
      });
      const repeatedRunSignals = repeatedRuns.map((r: any) => ({
        kind: 'repeated_run',
        confidence: r.confidence,
        savingsUsd: null,
        payload: { name: r.name, count: r.count, evidence: r.evidence, targets: r.targets },
      }));
      const allSignals = [...findings, ...repeatedRunSignals];
      await replaceSignalsForSession(sql, upsert.sessionId, allSignals as unknown as Array<Record<string, unknown>>);
      signalsInserted = allSignals.length;

      const allProjects = await listProjects(sql, orgId);
      const projectsWithRecentSessions = allProjects.filter((p: any) => Number(p.session_count) > 0).length;
      const alerts = detectForSession({
        session: { session_uuid: parsed.sessionUuid, cost_usd: sessionForRules.cost_usd },
        priorSessions: priorSessions as never[],
        stuckLoopCount: stuckLoops.length,
        projectSessionCount: projectsWithRecentSessions,
      });
      alertsInserted = await insertAlerts(sql, orgId, alerts as unknown as Array<Record<string, unknown>>, {
        project_id: projectRow.id,
        session_id: upsert.sessionId,
      });
    } catch (err) {
      console.warn('[code-sessions/ingest] signals/alerts step failed:', (err as Error).message);
    }
  }

  return NextResponse.json({
    project: { id: projectRow.id, slug: projectRow.slug },
    session: {
      id: upsert.sessionId,
      session_uuid: parsed.sessionUuid,
      source_mtime: parsed.sourceMtime,
      parser_version: parsed.parserVersion,
      skipped: upsert.skipped,
      reason: upsert.reason,
      inserted_messages: upsert.insertedMessages || 0,
      inserted_tool_uses: upsert.insertedToolUses || 0,
      signals_inserted: signalsInserted,
      alerts_inserted: alertsInserted,
    },
    parser: {
      jsonl_records: parsed.jsonlRecords,
      model_requests: parsed.modelRequests,
      duplicate_fragments_skipped: parsed.duplicateFragmentsSkipped,
      parser_skipped: parsed.skippedLines,
      model_primary: parsed.modelPrimary,
    },
  });
}
