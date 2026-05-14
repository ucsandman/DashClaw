export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 20;

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db.js';
import { getOrgId } from '../../../lib/org.js';
import { detectRepeatedRuns } from '../../../lib/claude-code/repeated-runs.js';
import { runOptimizer } from '../../../lib/claude-code/optimizer.js';
import { detectForSession } from '../../../lib/claude-code/alerts.js';
import {
  upsertProject,
  appendLiveTurn,
  getSessionFreshness,
  getSessionDetail,
  getProjectSessionsChronological,
  replaceSignalsForSession,
  insertAlerts,
  listProjects,
} from '../../../lib/repositories/code-sessions.repository.js';

// Per-turn payload is small (a few KB). Cap structural inputs to bound abuse.
const MAX_BODY_BYTES = 64 * 1024;
const MAX_TOOL_CALLS = 64;

function deriveSlugFromCwd(cwd) {
  if (!cwd) return 'unknown';
  const segs = String(cwd).split(/[\\/]/).filter(Boolean);
  const last = segs[segs.length - 1] || 'unknown';
  return last.replace(/[^A-Za-z0-9_.-]+/g, '-').slice(0, 80) || 'unknown';
}

async function runFinalize(sql, orgId, sessionUuid, projectId) {
  const fresh = await getSessionFreshness(sql, orgId, sessionUuid);
  if (!fresh) return { found: false };
  const detail = await getSessionDetail(sql, orgId, fresh.id);
  if (!detail) return { found: false };

  const toolEvents = (detail.tool_uses || detail.toolUses || []).map(t => ({
    name: t.name,
    requestId: t.request_id || t.requestId,
    target: t.target,
  }));
  const repeatedRuns = detectRepeatedRuns(toolEvents);
  const stuckLoops = repeatedRuns.filter(r => r.confidence === 'high');

  const sessionForRules = {
    id: detail.id,
    session_uuid: detail.session_uuid,
    model_primary: detail.model_primary,
    cost_usd: Number(detail.cost_usd) || 0,
    input_tokens: detail.input_tokens || 0,
    output_tokens: detail.output_tokens || 0,
    cache_read_tokens: detail.cache_read_tokens || 0,
    cache_creation_tokens: detail.cache_creation_tokens || 0,
    message_count: detail.message_count || 0,
  };

  const projectSessions = await getProjectSessionsChronological(sql, orgId, projectId);
  const priorSessions = projectSessions.filter(s => s.id !== fresh.id);

  const findings = runOptimizer({
    session: sessionForRules,
    stuckLoops,
    repeatedRuns,
    toolCount: toolEvents.length,
    toolEvents,
    subagentInvocations: [],
    projectSessions,
  });

  const repeatedRunSignals = repeatedRuns.map(r => ({
    kind: 'repeated_run',
    confidence: r.confidence,
    savingsUsd: null,
    payload: { name: r.name, count: r.count, evidence: r.evidence, targets: r.targets },
  }));
  const allSignals = [...findings, ...repeatedRunSignals];
  await replaceSignalsForSession(sql, fresh.id, allSignals);

  const allProjects = await listProjects(sql, orgId);
  const projectsWithRecentSessions = allProjects.filter(p => Number(p.session_count) > 0).length;
  const alerts = detectForSession({
    session: { session_uuid: detail.session_uuid, cost_usd: sessionForRules.cost_usd },
    priorSessions,
    stuckLoopCount: stuckLoops.length,
    projectSessionCount: projectsWithRecentSessions,
  });
  const alertsInserted = await insertAlerts(sql, orgId, alerts, {
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
export async function POST(request) {
  let body;
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

  const projectRow = await upsertProject(sql, orgId, {
    slug,
    cwd: project.cwd || null,
    source_host: sourceHost,
  });

  // Finalize path: skip append, run optimizer/alerts on the existing session.
  if (body.finalize === true) {
    let finalizeResult;
    try {
      finalizeResult = await runFinalize(sql, orgId, sessionUuid, projectRow.id);
    } catch (err) {
      // Finalize is opportunistic — log and return ok so the hook never
      // gets stuck retrying. Signals can be re-derived from a later
      // backfill if needed.
      console.warn('[code-sessions/ingest-live] finalize failed:', err.message);
      finalizeResult = { found: false, error: err.message };
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
