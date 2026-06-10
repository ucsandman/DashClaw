export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 20;

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db';
import { getOrgId } from '../../../lib/org';
import { detectRepeatedRuns } from '../../../lib/claude-code/repeated-runs';
import { runOptimizer } from '../../../lib/claude-code/optimizer';
import { detectForSession } from '../../../lib/claude-code/alerts';
import {
  upsertProject,
  appendLiveTurn,
  getSessionFreshness,
  getSessionDetail,
  getProjectSessionsChronological,
  replaceSignalsForSession,
  insertAlerts,
  listProjects,
} from '../../../lib/repositories/code-sessions.repository';

// Per-turn payload is small (a few KB). Cap structural inputs to bound abuse.
const MAX_BODY_BYTES = 64 * 1024;
const MAX_TOOL_CALLS = 64;

function deriveSlugFromCwd(cwd: unknown): string {
  if (!cwd) return 'unknown';
  const segs = String(cwd).split(/[\\/]/).filter(Boolean);
  const last = segs[segs.length - 1] || 'unknown';
  return last.replace(/[^A-Za-z0-9_.-]+/g, '-').slice(0, 80) || 'unknown';
}

async function runFinalize(sql: any, orgId: string, sessionUuid: string, projectId: any) {
  const fresh = (await getSessionFreshness(sql, orgId, sessionUuid)) as { id: string } | null;
  if (!fresh) return { found: false };
  const detail = await getSessionDetail(sql, orgId, fresh.id);
  if (!detail) return { found: false };

  // getSessionDetail returns { session, messages, toolUses }. Read the session
  // row off detail.session (every sibling route destructures the same way).
  // Reading detail.* directly left cost/tokens/uuid undefined, so the optimizer
  // and alert rules silently ran on zeroed data for hook-ingested sessions.
  const { session, toolUses } = detail;

  const toolEvents = (toolUses || []).map((t: any) => ({
    name: t.name,
    requestId: t.request_id || t.requestId,
    target: t.target,
  }));
  const repeatedRuns = detectRepeatedRuns(toolEvents);
  const stuckLoops = repeatedRuns.filter((r: any) => r.confidence === 'high');

  const sessionForRules = {
    id: session.id,
    session_uuid: session.session_uuid,
    model_primary: session.model_primary,
    cost_usd: Number(session.cost_usd) || 0,
    input_tokens: session.input_tokens || 0,
    output_tokens: session.output_tokens || 0,
    cache_read_tokens: session.cache_read_tokens || 0,
    cache_creation_tokens: session.cache_creation_tokens || 0,
    message_count: session.message_count || 0,
  };

  const projectSessions = await getProjectSessionsChronological(sql, orgId, projectId);
  const priorSessions = projectSessions.filter((s: any) => s.id !== fresh.id);

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
  // Signal objects (optimizer findings + repeated-run signals) are stored
  // generically; the repo takes Record<string, unknown>[].
  await replaceSignalsForSession(sql, fresh.id, allSignals as Record<string, unknown>[]);

  const allProjects = await listProjects(sql, orgId);
  const projectsWithRecentSessions = allProjects.filter((p: any) => Number(p.session_count) > 0).length;
  const alerts = detectForSession({
    session: { session_uuid: session.session_uuid as string, cost_usd: sessionForRules.cost_usd },
    priorSessions: priorSessions as never[],
    stuckLoopCount: stuckLoops.length,
    projectSessionCount: projectsWithRecentSessions,
  });
  // detectForSession returns Alert[]; insertAlerts persists them generically.
  const alertsInserted = await insertAlerts(sql, orgId, alerts as unknown as Record<string, unknown>[], {
    project_id: projectId,
    session_id: fresh.id,
  });

  return {
    found: true,
    sessionId: fresh.id,
    signalsInserted: allSignals.length,
    alertsInserted,
    stuckLoops: stuckLoops.length,
  };
}

/**
 * POST /api/code-sessions/ingest-live
 *
 * Per-turn incremental ingest for agents that don't dump a JSONL transcript
 * (currently Hermes Agent via post_llm_call shell hook). Each call either:
 *   - Appends one assistant message + N tool_uses to the session (the
 *     default; token deltas are added to running totals), OR
 *   - Runs the optimizer + alerts pass on the now-complete session
 *     (when `finalize: true`).
 *
 * Body shape (all token fields optional — Hermes hook does not expose them):
 * {
 *   session_uuid: string,            // required — keys into code_sessions
 *   agent_id?: string,               // metadata only
 *   finalize?: boolean,              // if true, skip append and run optimizer
 *   project: {
 *     slug?: string,
 *     cwd?: string,
 *     source_host?: 'hook'|'jsonl'   // defaults to 'hook'
 *   },
 *   model?: string,
 *   usage?: { input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens },
 *   tool_calls?: [{ name, tool_use_id?, target? }],
 *   assistant_text_preview?: string,
 *   turn_timestamp?: string,
 *   ended_at?: string,               // finalize-only
 *   completed?: boolean,             // finalize-only
 *   interrupted?: boolean            // finalize-only
 * }
 */
export async function POST(request: Request) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  if (Array.isArray(body.tool_calls) && body.tool_calls.length > MAX_TOOL_CALLS) {
    return NextResponse.json(
      { error: 'too_many_tool_calls', max: MAX_TOOL_CALLS },
      { status: 413 },
    );
  }
  const preview = typeof body.assistant_text_preview === 'string'
    ? body.assistant_text_preview.slice(0, 500)
    : null;
  if (preview && preview.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'preview_too_large' }, { status: 413 });
  }

  const sessionUuid = typeof body.session_uuid === 'string' ? body.session_uuid.trim() : '';
  if (!sessionUuid) {
    return NextResponse.json({ error: 'missing_session_uuid' }, { status: 400 });
  }

  const project = body.project && typeof body.project === 'object' ? body.project : {};
  const sourceHost = project.source_host || 'hook';
  if (sourceHost !== 'hook' && sourceHost !== 'jsonl') {
    return NextResponse.json(
      { error: 'invalid_source_host', reason: 'must be "hook" or "jsonl"' },
      { status: 400 },
    );
  }

  const slug = (typeof project.slug === 'string' && project.slug.trim())
    ? project.slug.trim()
    : deriveSlugFromCwd(project.cwd);

  const sql = getSql();
  const orgId = getOrgId(request);

  const projectRow = (await upsertProject(sql, orgId, {
    slug,
    cwd: project.cwd || null,
    source_host: sourceHost,
  })) as { id: string; slug: string };

  // Finalize path: skip append, run optimizer/alerts on the existing session.
  if (body.finalize === true) {
    let finalizeResult: any;
    try {
      finalizeResult = await runFinalize(sql, orgId, sessionUuid, projectRow.id);
    } catch (err) {
      // Finalize is opportunistic — log and return ok so the hook never
      // gets stuck retrying. Signals can be re-derived from a later
      // backfill if needed.
      console.warn('[code-sessions/ingest-live] finalize failed:', (err as Error).message);
      finalizeResult = { found: false, error: (err as Error).message };
    }
    return NextResponse.json({
      project: { id: projectRow.id, slug: projectRow.slug },
      session: {
        session_uuid: sessionUuid,
        finalized: true,
        found: finalizeResult.found,
        signals_inserted: finalizeResult.signalsInserted || 0,
        alerts_inserted: finalizeResult.alertsInserted || 0,
        stuck_loops: finalizeResult.stuckLoops || 0,
      },
      agent_id: typeof body.agent_id === 'string' ? body.agent_id : null,
    });
  }

  const result = await appendLiveTurn(sql, orgId, {
    sessionUuid,
    projectId: projectRow.id,
    model: typeof body.model === 'string' ? body.model : null,
    usage: body.usage && typeof body.usage === 'object' ? body.usage : null,
    toolCalls: Array.isArray(body.tool_calls) ? body.tool_calls : [],
    assistantPreview: preview,
    turnTimestamp: typeof body.turn_timestamp === 'string' ? body.turn_timestamp : null,
  });

  return NextResponse.json({
    project: { id: projectRow.id, slug: projectRow.slug },
    session: {
      id: result.sessionId,
      session_uuid: sessionUuid,
      turn_index: result.turnIndex,
      inserted_tool_uses: result.insertedToolUses,
    },
    agent_id: typeof body.agent_id === 'string' ? body.agent_id : null,
  });
}
