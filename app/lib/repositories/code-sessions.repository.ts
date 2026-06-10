/**
 * Repository for the Code Sessions surface (AgentLens absorption — Phase 2+).
 *
 * Follows the existing tagged-template SQL pattern: every function takes
 * `(sql, orgId, ...)`, no `sql.begin` transactions (Neon serverless HTTP
 * path doesn't support them), and idempotency comes from `ON CONFLICT` +
 * sequential statements.
 *
 * `upsertSessionWithChildren` is intentionally non-atomic. A crash between
 * the parent upsert and the children inserts can leave a session with no
 * messages/tool_uses; re-ingesting the same JSONL (with the same
 * `source_mtime`/`parser_version`) is the recovery path. See
 * `scripts/repair-code-sessions.mjs` (Phase 9) for out-of-band repair.
 */

import crypto from 'node:crypto';
import { estimateCost } from '../billing';
import { getModelPricing } from './settings.repository';
import type { SqlTag } from '../types/db';
import type { BillingPricingEntry } from '../types/pricing-finops';

const SESSION_ID_PREFIX = 'cs_';
const PROJECT_ID_PREFIX = 'cp_';
const MANIFEST_ID_PREFIX = 'cofm_';

function sessionTextId(): string { return SESSION_ID_PREFIX + crypto.randomUUID(); }
function projectTextId(): string { return PROJECT_ID_PREFIX + crypto.randomUUID(); }
function manifestTextId(): string { return MANIFEST_ID_PREFIX + crypto.randomUUID(); }

type Row = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export async function upsertProject(
  sql: SqlTag,
  orgId: string,
  { slug, cwd, source_host }: { slug?: string; cwd?: string | null; source_host?: string | null },
): Promise<Row | undefined> {
  if (!slug) throw new Error('upsertProject: slug is required');
  const id = projectTextId();
  const rows = await sql`
    INSERT INTO code_projects (id, org_id, slug, cwd, source_host)
    VALUES (${id}, ${orgId}, ${slug}, ${cwd || null}, ${source_host || null})
    ON CONFLICT (org_id, slug) DO UPDATE
      SET cwd = COALESCE(EXCLUDED.cwd, code_projects.cwd),
          source_host = COALESCE(EXCLUDED.source_host, code_projects.source_host),
          updated_at = NOW()
    RETURNING id, org_id, slug, cwd, source_host, created_at, updated_at
  `;
  return rows[0];
}

export async function listProjects(sql: SqlTag, orgId: string): Promise<Row[]> {
  const rows = await sql`
    SELECT p.id, p.slug, p.cwd, p.source_host, p.created_at, p.updated_at,
           (SELECT COUNT(*) FROM code_sessions s WHERE s.project_id = p.id) AS session_count,
           (SELECT COALESCE(SUM(s.cost_usd), 0) FROM code_sessions s WHERE s.project_id = p.id) AS total_cost_usd,
           (SELECT MAX(s.created_at) FROM code_sessions s WHERE s.project_id = p.id) AS last_session_at
    FROM code_projects p
    WHERE p.org_id = ${orgId}
    ORDER BY last_session_at DESC NULLS LAST, p.created_at DESC
  `;
  return rows;
}

export async function getProject(sql: SqlTag, orgId: string, projectId: string): Promise<Row | null> {
  const rows = await sql`
    SELECT id, org_id, slug, cwd, source_host, created_at, updated_at
    FROM code_projects
    WHERE org_id = ${orgId} AND id = ${projectId}
    LIMIT 1
  `;
  return rows[0] || null;
}

// ---------------------------------------------------------------------------
// Deletes — all org-scoped. Session children (messages, tool_uses, signals,
// session-scoped alerts, optimal-file manifests) cascade via the 0006 FKs;
// code_sessions.project_id has NO cascade, so project deletes must remove
// sessions FIRST or Postgres raises FK 23503 (the hosted-workspace bug shape,
// commit 974854b1). code_session_handoffs.project_id is ON DELETE SET NULL —
// handoff bundles intentionally survive project deletion.
// ---------------------------------------------------------------------------

export async function deleteCodeSession(
  sql: SqlTag,
  orgId: string,
  sessionId: string,
): Promise<boolean> {
  const rows = await sql`
    DELETE FROM code_sessions
    WHERE org_id = ${orgId} AND id = ${sessionId}
    RETURNING id
  `;
  return rows.length > 0;
}

// Non-atomic on Neon HTTP (no transactions): a crash between the sessions
// DELETE and the project DELETE leaves an empty project row — benign and
// re-deletable.
export async function deleteCodeProject(
  sql: SqlTag,
  orgId: string,
  projectId: string,
): Promise<boolean> {
  await sql`
    DELETE FROM code_sessions
    WHERE org_id = ${orgId} AND project_id = ${projectId}
  `;
  const rows = await sql`
    DELETE FROM code_projects
    WHERE org_id = ${orgId} AND id = ${projectId}
    RETURNING id
  `;
  return rows.length > 0;
}

// Clear-all for one org: every code session (including any not attached to a
// project), then every project. Same sessions-first ordering and same
// non-atomicity caveat as deleteCodeProject.
export async function clearAllCodeSessions(
  sql: SqlTag,
  orgId: string,
): Promise<{ sessions_deleted: number; projects_deleted: number }> {
  const sessions = await sql`
    DELETE FROM code_sessions
    WHERE org_id = ${orgId}
    RETURNING id
  `;
  const projects = await sql`
    DELETE FROM code_projects
    WHERE org_id = ${orgId}
    RETURNING id
  `;
  return { sessions_deleted: sessions.length, projects_deleted: projects.length };
}

// ---------------------------------------------------------------------------
// Session freshness + upsert
// ---------------------------------------------------------------------------

export async function getSessionFreshness(
  sql: SqlTag,
  orgId: string,
  sessionUuid: string,
): Promise<Row | null> {
  const rows = await sql`
    SELECT id, source_mtime, parser_version
    FROM code_sessions
    WHERE org_id = ${orgId} AND session_uuid = ${sessionUuid}
    LIMIT 1
  `;
  return rows[0] || null;
}

async function _resolveOrgPricing(sql: SqlTag, orgId: string): Promise<BillingPricingEntry[] | null> {
  try {
    return (await getModelPricing(sql, orgId)) as BillingPricingEntry[] | null;
  } catch {
    return null;
  }
}

interface ParsedSession {
  sessionUuid?: string;
  parserVersion?: number | string;
  sourceMtime?: unknown;
  sourceFile?: string | null;
  startedAt?: string | null;
  endedAt?: string | null;
  messageCount?: number;
  modelPrimary?: string | null;
  modelRequests?: number;
  jsonlRecords?: number;
  duplicateFragmentsSkipped?: number;
  cache_savings_usd?: number;
  totals?: Record<string, number | undefined>;
  naiveTotals?: Record<string, number | undefined>;
  messages?: Array<Record<string, unknown>>;
  toolUses?: Array<Record<string, unknown>>;
  [k: string]: unknown;
}

interface UpsertResult {
  sessionId: string | null;
  skipped: boolean;
  reason?: string;
  insertedMessages?: number;
  insertedToolUses?: number;
}

/**
 * Upsert a parsed session and its children (messages + tool_uses).
 *
 * Skip semantics: if the stored row has the same `source_mtime` AND its
 * `parser_version >= parsed.parserVersion`, return `{ skipped: true,
 * reason: 'unchanged' }` without writing.
 *
 * Otherwise: upsert `code_sessions`, delete child rows, bulk-insert messages
 * (one INSERT ... RETURNING id per row — matches the existing repository
 * pattern), then bulk-insert tool_uses translating `parsed.toolUses[i]
 * .messageIndex` to the new message FK and stamping `action_id` from
 * `toolUseActionMap` when present.
 */
export async function upsertSessionWithChildren(
  sql: SqlTag,
  orgId: string,
  parsed: ParsedSession,
  { projectId, toolUseActionMap = {}, source }: { projectId?: string; toolUseActionMap?: Record<string, string>; source?: string } = {},
): Promise<UpsertResult> {
  if (!parsed?.sessionUuid) {
    return { sessionId: null, skipped: true, reason: 'no_session_uuid' };
  }
  if (!projectId) throw new Error('upsertSessionWithChildren: projectId is required');
  if (!source) throw new Error('upsertSessionWithChildren: source is required');

  const existing = await getSessionFreshness(sql, orgId, parsed.sessionUuid);
  const incomingParserVersion = Number(parsed.parserVersion) || 2;
  if (
    existing
    && parsed.sourceMtime
    && existing.source_mtime === parsed.sourceMtime
    && Number(existing.parser_version) >= incomingParserVersion
  ) {
    return { sessionId: existing.id as string, skipped: true, reason: 'unchanged' };
  }

  const customPricing = await _resolveOrgPricing(sql, orgId);
  const totals = parsed.totals || {};
  const naive = parsed.naiveTotals || {};
  const sessionId = (existing?.id as string | undefined) || sessionTextId();

  // Re-cost with billing.js so org-custom pricing is honoured. parsed.cost_usd
  // came from the 4-column AgentLens table; billing.js may diverge for models
  // that don't have cache columns (it will fold cache_creation contribution
  // to 0 in that case — see A10 in the goal for the reconciliation note).
  const costUsd = estimateCost(
    totals.input_tokens || 0,
    totals.output_tokens || 0,
    parsed.modelPrimary,
    customPricing,
    { cache_creation_tokens: totals.cache_creation_tokens || 0, cache_read_tokens: totals.cache_read_tokens || 0 },
  );
  const naiveCostUsd = estimateCost(
    naive.input_tokens || 0,
    naive.output_tokens || 0,
    parsed.modelPrimary,
    customPricing,
    { cache_creation_tokens: naive.cache_creation_tokens || 0, cache_read_tokens: naive.cache_read_tokens || 0 },
  );

  // Step 1: upsert the parent. ON CONFLICT preserves the original id from
  // the first ingest (sessions are keyed by org_id+session_uuid).
  const upsertRows = await sql`
    INSERT INTO code_sessions (
      id, org_id, project_id, session_uuid, source, source_file, source_mtime,
      started_at, ended_at, message_count, model_primary,
      input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
      cost_usd, cache_savings_usd, stuck_loops, model_requests, jsonl_records,
      duplicate_fragments_skipped,
      naive_input_tokens, naive_output_tokens, naive_cache_read_tokens, naive_cache_creation_tokens,
      naive_cost_usd, parser_version
    ) VALUES (
      ${sessionId}, ${orgId}, ${projectId}, ${parsed.sessionUuid}, ${source},
      ${parsed.sourceFile || null}, ${parsed.sourceMtime || null},
      ${parsed.startedAt || null}, ${parsed.endedAt || null},
      ${parsed.messageCount || 0}, ${parsed.modelPrimary || null},
      ${totals.input_tokens || 0}, ${totals.output_tokens || 0},
      ${totals.cache_read_tokens || 0}, ${totals.cache_creation_tokens || 0},
      ${costUsd}, ${parsed.cache_savings_usd || 0},
      ${0}, ${parsed.modelRequests || 0}, ${parsed.jsonlRecords || 0},
      ${parsed.duplicateFragmentsSkipped || 0},
      ${naive.input_tokens || 0}, ${naive.output_tokens || 0},
      ${naive.cache_read_tokens || 0}, ${naive.cache_creation_tokens || 0},
      ${naiveCostUsd}, ${incomingParserVersion}
    )
    ON CONFLICT (org_id, session_uuid) DO UPDATE SET
      project_id = EXCLUDED.project_id,
      source = EXCLUDED.source,
      source_file = EXCLUDED.source_file,
      source_mtime = EXCLUDED.source_mtime,
      started_at = EXCLUDED.started_at,
      ended_at = EXCLUDED.ended_at,
      message_count = EXCLUDED.message_count,
      model_primary = EXCLUDED.model_primary,
      input_tokens = EXCLUDED.input_tokens,
      output_tokens = EXCLUDED.output_tokens,
      cache_read_tokens = EXCLUDED.cache_read_tokens,
      cache_creation_tokens = EXCLUDED.cache_creation_tokens,
      cost_usd = EXCLUDED.cost_usd,
      cache_savings_usd = EXCLUDED.cache_savings_usd,
      model_requests = EXCLUDED.model_requests,
      jsonl_records = EXCLUDED.jsonl_records,
      duplicate_fragments_skipped = EXCLUDED.duplicate_fragments_skipped,
      naive_input_tokens = EXCLUDED.naive_input_tokens,
      naive_output_tokens = EXCLUDED.naive_output_tokens,
      naive_cache_read_tokens = EXCLUDED.naive_cache_read_tokens,
      naive_cache_creation_tokens = EXCLUDED.naive_cache_creation_tokens,
      naive_cost_usd = EXCLUDED.naive_cost_usd,
      parser_version = EXCLUDED.parser_version,
      updated_at = NOW()
    RETURNING id
  `;
  const persistedId = (upsertRows[0]?.id as string | undefined) || sessionId;

  // Steps 2-3: clear child rows (non-atomic; a crash here leaves no rows
  // and the next ingest will repopulate cleanly).
  await sql`DELETE FROM code_session_messages WHERE session_id = ${persistedId}`;
  await sql`DELETE FROM code_session_tool_uses WHERE session_id = ${persistedId}`;

  // Step 4: insert messages, capturing the new serial id per row.
  const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
  const messageIds: Array<unknown> = [];
  for (const m of messages) {
    const rows = await sql`
      INSERT INTO code_session_messages (
        session_id, uuid, role, model, timestamp,
        input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
        cost_usd, text_preview, request_id, message_id
      ) VALUES (
        ${persistedId}, ${m.uuid || null}, ${m.role || null}, ${m.model || null},
        ${m.timestamp || null},
        ${m.input_tokens}, ${m.output_tokens}, ${m.cache_read_tokens}, ${m.cache_creation_tokens},
        ${m.cost_usd}, ${m.text_preview || null},
        ${m.request_id || null}, ${m.message_id || null}
      ) RETURNING id
    `;
    messageIds.push(rows[0]?.id || null);
  }

  // Step 5: insert tool_uses. Map messageIndex -> the freshly-allocated
  // message_id; stamp action_id from the supplied tool_use_action_map.
  const toolUses = Array.isArray(parsed.toolUses) ? parsed.toolUses : [];
  let toolUseRows = 0;
  for (const t of toolUses) {
    const messageIndex = t.messageIndex as number | null | undefined;
    const fkMsg = (messageIndex != null && messageIndex >= 0 && messageIndex < messageIds.length)
      ? messageIds[messageIndex]
      : null;
    const actionId = (t.tool_use_id && toolUseActionMap[t.tool_use_id as string]) || null;
    await sql`
      INSERT INTO code_session_tool_uses (
        session_id, message_id, action_id, name, target, timestamp,
        duration_ms, tool_use_id, request_id, source_line
      ) VALUES (
        ${persistedId}, ${fkMsg}, ${actionId}, ${t.name},
        ${t.target || null}, ${t.timestamp || null},
        ${t.duration_ms || null}, ${t.tool_use_id || null},
        ${t.requestId || null}, ${t.line || null}
      )
    `;
    toolUseRows += 1;
  }

  // Signals + alerts wiring is stubbed here — Phase 5 fills it in.
  return {
    sessionId: persistedId,
    skipped: false,
    reason: existing ? 'updated' : 'created',
    insertedMessages: messageIds.length,
    insertedToolUses: toolUseRows,
  };
}

interface LiveTurn {
  sessionUuid?: string;
  projectId?: string;
  model?: string | null;
  usage?: Record<string, unknown>;
  toolCalls?: Array<Record<string, unknown>>;
  assistantPreview?: string | null;
  turnTimestamp?: string | null;
  [k: string]: unknown;
}

/**
 * Append a single live turn to a code session. Used by /api/code-sessions/ingest-live
 * from Hermes Agent's post_llm_call hook (and any other agent that pushes turns
 * incrementally instead of dumping a full JSONL transcript).
 *
 * Semantics vs upsertSessionWithChildren:
 *  - Parent row token counts are ADDED to (not replaced). First call inserts
 *    a row; subsequent calls sum the deltas via ON CONFLICT DO UPDATE.
 *  - Child rows are APPENDED, never wiped. One message row per call plus N
 *    tool_use rows.
 *  - parser_version is held at 2 to match the JSONL pipeline.
 */
export async function appendLiveTurn(
  sql: SqlTag,
  orgId: string,
  turn: LiveTurn = {},
): Promise<{ sessionId: unknown; turnIndex: number; insertedToolUses: number }> {
  const sessionUuid = turn.sessionUuid;
  const projectId = turn.projectId;
  if (!sessionUuid) throw new Error('appendLiveTurn: sessionUuid is required');
  if (!projectId) throw new Error('appendLiveTurn: projectId is required');

  const usage = turn.usage && typeof turn.usage === 'object' ? turn.usage : {};
  const inputDelta = Number(usage.input_tokens) || 0;
  const outputDelta = Number(usage.output_tokens) || 0;
  const cacheCreationDelta = Number(usage.cache_creation_input_tokens ?? usage.cache_creation_tokens) || 0;
  const cacheReadDelta = Number(usage.cache_read_input_tokens ?? usage.cache_read_tokens) || 0;

  const customPricing = await _resolveOrgPricing(sql, orgId);
  const costDelta = estimateCost(
    inputDelta,
    outputDelta,
    turn.model || null,
    customPricing,
    { cache_creation_tokens: cacheCreationDelta, cache_read_tokens: cacheReadDelta },
  );

  const newSessionId = sessionTextId();
  const startedAt = turn.turnTimestamp || null;

  // Step 1: upsert parent. On conflict, ADD deltas instead of replacing.
  const parentRows = await sql`
    INSERT INTO code_sessions (
      id, org_id, project_id, session_uuid, source,
      started_at, ended_at, message_count, model_primary,
      input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
      cost_usd, parser_version
    ) VALUES (
      ${newSessionId}, ${orgId}, ${projectId}, ${sessionUuid}, 'hook',
      ${startedAt}, ${startedAt}, ${1}, ${turn.model || null},
      ${inputDelta}, ${outputDelta}, ${cacheReadDelta}, ${cacheCreationDelta},
      ${costDelta}, ${2}
    )
    ON CONFLICT (org_id, session_uuid) DO UPDATE SET
      ended_at = COALESCE(EXCLUDED.ended_at, code_sessions.ended_at),
      message_count = code_sessions.message_count + 1,
      model_primary = COALESCE(EXCLUDED.model_primary, code_sessions.model_primary),
      input_tokens = code_sessions.input_tokens + EXCLUDED.input_tokens,
      output_tokens = code_sessions.output_tokens + EXCLUDED.output_tokens,
      cache_read_tokens = code_sessions.cache_read_tokens + EXCLUDED.cache_read_tokens,
      cache_creation_tokens = code_sessions.cache_creation_tokens + EXCLUDED.cache_creation_tokens,
      cost_usd = code_sessions.cost_usd + EXCLUDED.cost_usd,
      updated_at = NOW()
    RETURNING id, message_count
  `;
  const persistedId = parentRows[0]?.id;
  const turnIndex = Number(parentRows[0]?.message_count) || 1;

  // Step 2: append one assistant message row for this turn.
  const messageRows = await sql`
    INSERT INTO code_session_messages (
      session_id, role, model, timestamp,
      input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
      cost_usd, text_preview
    ) VALUES (
      ${persistedId}, 'assistant', ${turn.model || null}, ${startedAt},
      ${inputDelta}, ${outputDelta}, ${cacheReadDelta}, ${cacheCreationDelta},
      ${costDelta}, ${turn.assistantPreview || null}
    )
    RETURNING id
  `;
  const messageId = messageRows[0]?.id || null;

  // Step 3: append tool_use rows for this turn.
  const toolCalls = Array.isArray(turn.toolCalls) ? turn.toolCalls : [];
  let insertedToolUses = 0;
  for (const t of toolCalls) {
    if (!t || !t.name) continue;
    const targetText = (t.target && typeof t.target === 'object')
      ? JSON.stringify(t.target).slice(0, 300)
      : (typeof t.target === 'string' ? t.target.slice(0, 300) : null);
    await sql`
      INSERT INTO code_session_tool_uses (
        session_id, message_id, name, target, timestamp, tool_use_id
      ) VALUES (
        ${persistedId}, ${messageId}, ${t.name}, ${targetText},
        ${startedAt}, ${t.tool_use_id || null}
      )
    `;
    insertedToolUses += 1;
  }

  return { sessionId: persistedId, turnIndex, insertedToolUses };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listSessions(
  sql: SqlTag,
  orgId: string,
  projectId: string,
  { limit = 50, offset = 0 }: { limit?: number | string; offset?: number | string } = {},
): Promise<Row[]> {
  const parsedLimit = Math.min(Math.max(parseInt(limit as string, 10) || 50, 1), 200);
  const parsedOffset = Math.max(parseInt(offset as string, 10) || 0, 0);
  const rows = await sql`
    SELECT id, session_uuid, source, source_file, source_mtime,
           started_at, ended_at, message_count, model_primary,
           input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
           cost_usd, cache_savings_usd, naive_cost_usd, parser_version,
           created_at, updated_at
    FROM code_sessions
    WHERE org_id = ${orgId} AND project_id = ${projectId}
    ORDER BY (started_at IS NULL), started_at DESC, created_at DESC
    LIMIT ${parsedLimit} OFFSET ${parsedOffset}
  `;
  return rows;
}

export async function getSessionDetail(
  sql: SqlTag,
  orgId: string,
  sessionId: string,
): Promise<{ session: Row; messages: Row[]; toolUses: Row[] } | null> {
  const sessionRows = await sql`
    SELECT s.*, p.slug AS project_slug, p.cwd AS project_cwd
    FROM code_sessions s
    JOIN code_projects p ON p.id = s.project_id
    WHERE s.org_id = ${orgId} AND s.id = ${sessionId}
    LIMIT 1
  `;
  if (!sessionRows.length) return null;
  const session = sessionRows[0] as Row;
  const messages = await sql`
    SELECT id, uuid, role, model, timestamp,
           input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens,
           cost_usd, text_preview, request_id, message_id
    FROM code_session_messages
    WHERE session_id = ${sessionId}
    ORDER BY id ASC
  `;
  const toolUses = await sql`
    SELECT id, message_id, action_id, name, target, timestamp, duration_ms,
           tool_use_id, request_id, source_line
    FROM code_session_tool_uses
    WHERE session_id = ${sessionId}
    ORDER BY id ASC
  `;
  return { session, messages, toolUses };
}

export async function getSessionInsights(
  sql: SqlTag,
  orgId: string,
  sessionId: string,
): Promise<{ toolEvents: Array<{ name: unknown; requestId: unknown; target: unknown }> } | null> {
  // Phase 2 returns repeated-runs derived from tool_uses only. Phase 5 will
  // also fold in stored signals + alerts.
  const ownerRows = await sql`
    SELECT 1 FROM code_sessions WHERE org_id = ${orgId} AND id = ${sessionId} LIMIT 1
  `;
  if (!ownerRows.length) return null;
  const toolRows = await sql`
    SELECT name, request_id AS request_id, target
    FROM code_session_tool_uses
    WHERE session_id = ${sessionId}
    ORDER BY id ASC
  `;
  return {
    toolEvents: toolRows.map(r => ({ name: r.name, requestId: r.request_id, target: r.target })),
  };
}

export async function getProjectMedianCost(
  sql: SqlTag,
  orgId: string,
  projectId: string,
  excludeSessionId?: string,
): Promise<number | null> {
  const rows = await sql`
    SELECT cost_usd FROM code_sessions
    WHERE org_id = ${orgId} AND project_id = ${projectId} AND id <> ${excludeSessionId || ''} AND cost_usd > 0
    ORDER BY id DESC
    LIMIT 30
  `;
  const nums = rows.map(r => Number(r.cost_usd)).filter(n => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  if (!nums.length) return null;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? (nums[mid] as number) : ((nums[mid - 1] as number) + (nums[mid] as number)) / 2;
}

export async function getSimilarSessionCount(
  sql: SqlTag,
  orgId: string,
  projectId: string,
  session: Row | null,
): Promise<number> {
  if (!session || !projectId) return 0;
  const cur = Number(session.cost_usd) || 0;
  if (cur <= 0) return 0;
  const rows = await sql`
    SELECT id, cost_usd, model_primary
    FROM code_sessions
    WHERE org_id = ${orgId} AND project_id = ${projectId} AND id <> ${session.id || ''}
  `;
  let n = 0;
  for (const r of rows) {
    if (r.model_primary && r.model_primary === session.model_primary) {
      const rc = Number(r.cost_usd) || 0;
      if (Math.abs(rc - cur) / cur < 0.5) n += 1;
    }
  }
  return n;
}

export async function getProjectSessionsChronological(
  sql: SqlTag,
  orgId: string,
  projectId: string,
): Promise<Row[]> {
  const rows = await sql`
    SELECT id, session_uuid, started_at, model_primary, cost_usd, cache_savings_usd,
           message_count,
           input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens
    FROM code_sessions
    WHERE org_id = ${orgId} AND project_id = ${projectId}
    ORDER BY (started_at IS NULL), started_at ASC, id ASC
  `;
  return rows;
}

// ---------------------------------------------------------------------------
// Signals & alerts (Phase 5 wires the writers; reads usable from Phase 2 on)
// ---------------------------------------------------------------------------

export async function replaceSignalsForSession(
  sql: SqlTag,
  sessionId: string,
  signals: Array<Record<string, unknown>> | null | undefined,
): Promise<void> {
  await sql`DELETE FROM code_session_signals WHERE session_id = ${sessionId}`;
  for (const s of signals || []) {
    await sql`
      INSERT INTO code_session_signals (session_id, kind, confidence, savings_usd, payload)
      VALUES (${sessionId}, ${s.kind || s.ruleId}, ${s.confidence || null},
              ${s.savingsUsd ?? s.estimatedMonthlySavingsUsd ?? null},
              ${s.payload ? JSON.stringify(s.payload) : (s.evidence ? JSON.stringify(s.evidence) : null)})
    `;
  }
}

export async function listSignalsForSession(
  sql: SqlTag,
  orgId: string,
  sessionId: string,
): Promise<Row[]> {
  const ownerRows = await sql`
    SELECT 1 FROM code_sessions WHERE org_id = ${orgId} AND id = ${sessionId} LIMIT 1
  `;
  if (!ownerRows.length) return [];
  return await sql`
    SELECT id, kind, confidence, savings_usd, payload, created_at
    FROM code_session_signals
    WHERE session_id = ${sessionId}
    ORDER BY id ASC
  `;
}

export async function insertAlerts(
  sql: SqlTag,
  orgId: string,
  alerts: Array<Record<string, unknown>> | null | undefined,
  defaults: { project_id?: string | null; session_id?: string | null } = {},
): Promise<number> {
  let inserted = 0;
  for (const a of alerts || []) {
    const project_id = a.scope === 'org' || a.scope === 'user' ? null : (defaults.project_id || null);
    const session_id = a.scope === 'session' ? (defaults.session_id || null) : null;
    const rows = await sql`
      INSERT INTO code_session_alerts (org_id, project_id, session_id, kind, severity, scope, title, body)
      VALUES (${orgId}, ${project_id}, ${session_id}, ${a.kind}, ${a.severity || 'info'},
              ${a.scope || 'session'}, ${a.title}, ${a.body || null})
      ON CONFLICT (org_id, kind, (COALESCE(project_id, '')), (COALESCE(session_id, ''))) DO NOTHING
      RETURNING id
    `;
    if (rows.length) inserted += 1;
  }
  return inserted;
}

export async function listAlerts(
  sql: SqlTag,
  orgId: string,
  { onlyUnread = false, limit = 50 }: { onlyUnread?: boolean; limit?: number | string } = {},
): Promise<Row[]> {
  const parsedLimit = Math.min(Math.max(parseInt(limit as string, 10) || 50, 1), 200);
  if (onlyUnread) {
    return await sql`
      SELECT id, project_id, session_id, kind, severity, scope, title, body,
             read_at, created_at
      FROM code_session_alerts
      WHERE org_id = ${orgId} AND read_at IS NULL
      ORDER BY id DESC
      LIMIT ${parsedLimit}
    `;
  }
  return await sql`
    SELECT id, project_id, session_id, kind, severity, scope, title, body,
           read_at, created_at
    FROM code_session_alerts
    WHERE org_id = ${orgId}
    ORDER BY id DESC
    LIMIT ${parsedLimit}
  `;
}

export async function markAlertsRead(
  sql: SqlTag,
  orgId: string,
  ids: unknown[],
): Promise<number> {
  if (!Array.isArray(ids) || !ids.length) {
    const all = await sql`
      UPDATE code_session_alerts SET read_at = NOW()
      WHERE org_id = ${orgId} AND read_at IS NULL
      RETURNING id
    `;
    return all.length;
  }
  const updated = await sql`
    UPDATE code_session_alerts SET read_at = NOW()
    WHERE org_id = ${orgId} AND id = ANY(${ids}) AND read_at IS NULL
    RETURNING id
  `;
  return updated.length;
}

export async function countUnreadAlerts(sql: SqlTag, orgId: string): Promise<number> {
  const rows = await sql`
    SELECT COUNT(*)::int AS n
    FROM code_session_alerts
    WHERE org_id = ${orgId} AND read_at IS NULL
  `;
  return (rows[0]?.n as number) || 0;
}

// ---------------------------------------------------------------------------
// Memos
// ---------------------------------------------------------------------------

export async function listMemos(sql: SqlTag, orgId: string, projectId: string): Promise<Row[]> {
  return await sql`
    SELECT id, project_id, iso_week_tag, body_md, created_at
    FROM code_session_memos
    WHERE org_id = ${orgId} AND project_id = ${projectId}
    ORDER BY iso_week_tag DESC
  `;
}

export async function saveMemo(
  sql: SqlTag,
  orgId: string,
  projectId: string,
  isoWeekTag: string,
  bodyMd: string,
): Promise<Row | undefined> {
  const rows = await sql`
    INSERT INTO code_session_memos (org_id, project_id, iso_week_tag, body_md)
    VALUES (${orgId}, ${projectId}, ${isoWeekTag}, ${bodyMd})
    ON CONFLICT (org_id, project_id, iso_week_tag) DO UPDATE
      SET body_md = EXCLUDED.body_md
    RETURNING id, iso_week_tag, body_md, created_at
  `;
  return rows[0];
}

// ---------------------------------------------------------------------------
// Cross-route helpers (consumed by /api/cron/*, /api/learning/*, etc.)
// All raw SQL lives here per the route-level SQL guardrail.
// ---------------------------------------------------------------------------

export async function listProjectsWithSessions(sql: SqlTag): Promise<Row[]> {
  return await sql`
    SELECT p.id AS project_id, p.org_id, p.slug
    FROM code_projects p
    WHERE EXISTS (SELECT 1 FROM code_sessions s WHERE s.project_id = p.id)
  `;
}

export async function getProjectTokenTotalsForRange(
  sql: SqlTag,
  projectId: string,
  startedAtFrom: string,
  startedAtTo: string,
): Promise<{ input_tokens: number; cache_read_tokens: number; cache_creation_tokens: number }> {
  const rows = await sql`
    SELECT
      COALESCE(SUM(input_tokens), 0)::bigint AS input_tokens,
      COALESCE(SUM(cache_read_tokens), 0)::bigint AS cache_read_tokens,
      COALESCE(SUM(cache_creation_tokens), 0)::bigint AS cache_creation_tokens
    FROM code_sessions
    WHERE project_id = ${projectId}
      AND started_at >= ${startedAtFrom}
      AND started_at <  ${startedAtTo}
  `;
  return {
    input_tokens: Number(rows[0]?.input_tokens) || 0,
    cache_read_tokens: Number(rows[0]?.cache_read_tokens) || 0,
    cache_creation_tokens: Number(rows[0]?.cache_creation_tokens) || 0,
  };
}

export async function listSubagentToolUseAttribution(
  sql: SqlTag,
  orgId: string,
  { projectId = null }: { projectId?: string | null } = {},
): Promise<Row[]> {
  return await sql`
    SELECT tu.name,
           COALESCE(ar.cost_estimate, 0) AS cost_usd,
           COALESCE(ar.duration_ms, 0) AS duration_ms,
           CASE WHEN ar.status = 'completed' THEN true
                WHEN ar.status = 'failed'    THEN false
                ELSE NULL END AS success
    FROM code_session_tool_uses tu
    JOIN code_sessions s ON s.id = tu.session_id
    LEFT JOIN action_records ar ON ar.action_id = tu.action_id AND ar.org_id = ${orgId}
    WHERE s.org_id = ${orgId}
      AND (${projectId}::text IS NULL OR s.project_id = ${projectId})
  `;
}

export async function aggregateCodeSignalsByKind(
  sql: SqlTag,
  orgId: string,
  sinceIso: string,
): Promise<Row[]> {
  return await sql`
    SELECT
      sig.kind,
      COUNT(*)::int AS occurrence_count,
      COALESCE(SUM(sig.savings_usd), 0)::numeric AS total_savings_usd,
      COUNT(DISTINCT s.id)::int AS session_count
    FROM code_session_signals sig
    JOIN code_sessions s ON s.id = sig.session_id
    WHERE s.org_id = ${orgId}
      AND s.created_at >= ${sinceIso}
      AND sig.kind <> 'repeated_run'
    GROUP BY sig.kind
    ORDER BY total_savings_usd DESC, occurrence_count DESC
  `;
}

// ---------------------------------------------------------------------------
// FinOps Claude-Code lens — read-only spend rollup over stored cost_usd.
// Both Agent Spend and this cost already run through billing.js at ingest,
// so this is a pure aggregation of stored values (no re-pricing).
//
// Time bucketing uses the session's actual run time (started_at), NOT the
// ingest time (created_at). A backfill ingest stamps created_at "now", which
// would otherwise pile every session's spend onto the ingest date and make the
// period window meaningless. SCHEMA NOTE: started_at is TEXT (ISO-8601 string
// from the JSONL parser) while created_at is TIMESTAMPTZ — so we regex-guard
// the cast (only cast ISO-shaped values; anything else, incl. NULL, falls back
// to created_at), which also means a malformed started_at can never 500 here.
// Verified against the live DB (mocked tests can't catch text-vs-timestamptz).
// ---------------------------------------------------------------------------

const CODE_SPEND_PERIOD_DAYS: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90 };

export async function getCodeSessionSpendAggregation(
  sql: SqlTag,
  orgId: string,
  { period = '30d' }: { period?: string } = {},
): Promise<{
  period: string;
  total_cost_usd: number;
  total_cache_savings_usd: number;
  session_count: number;
  by_day: Row[];
  by_project: Row[];
}> {
  const days = CODE_SPEND_PERIOD_DAYS[period] ?? 30;
  const sinceIso = new Date(Date.now() - days * 86_400_000).toISOString();

  const [totals] = await sql`
    SELECT COALESCE(SUM(cost_usd), 0)::real AS total_cost_usd,
           COALESCE(SUM(cache_savings_usd), 0)::real AS total_cache_savings_usd,
           COUNT(*)::integer AS session_count
    FROM code_sessions
    WHERE org_id = ${orgId}
      AND COALESCE(CASE WHEN started_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' THEN started_at::timestamptz END, created_at) >= ${sinceIso}`;

  const byDay = await sql`
    SELECT DATE(COALESCE(CASE WHEN started_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' THEN started_at::timestamptz END, created_at)) AS date,
           COALESCE(SUM(cost_usd), 0)::real AS cost_usd,
           COUNT(*)::integer AS session_count
    FROM code_sessions
    WHERE org_id = ${orgId}
      AND COALESCE(CASE WHEN started_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' THEN started_at::timestamptz END, created_at) >= ${sinceIso}
    GROUP BY DATE(COALESCE(CASE WHEN started_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' THEN started_at::timestamptz END, created_at))
    ORDER BY date DESC`;

  const byProject = await sql`
    SELECT p.id AS project_id, p.slug AS project_name,
           COALESCE(SUM(s.cost_usd), 0)::real AS cost_usd,
           COUNT(*)::integer AS session_count
    FROM code_sessions s
    JOIN code_projects p ON p.id = s.project_id
    WHERE s.org_id = ${orgId}
      AND COALESCE(CASE WHEN s.started_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' THEN s.started_at::timestamptz END, s.created_at) >= ${sinceIso}
    GROUP BY p.id, p.slug
    ORDER BY cost_usd DESC`;

  return {
    period,
    // `::real` aggregates are strings from the driver — coerce with Number()
    // (an `as number` cast lies); mirrors actions.repository getCostAggregation.
    total_cost_usd: Number(totals?.total_cost_usd ?? 0),
    total_cache_savings_usd: Number(totals?.total_cache_savings_usd ?? 0),
    session_count: Number(totals?.session_count ?? 0),
    by_day: byDay,
    by_project: byProject,
  };
}

// ---------------------------------------------------------------------------
// Optimal Files manifests
// ---------------------------------------------------------------------------

export async function saveManifest(
  sql: SqlTag,
  orgId: string,
  sessionId: string,
  projectCwd: string,
  plan: unknown,
  ttlHours = 24,
): Promise<Row | undefined> {
  const id = manifestTextId();
  const rows = await sql`
    INSERT INTO code_optimal_file_manifests (id, org_id, session_id, project_cwd, plan, expires_at)
    VALUES (${id}, ${orgId}, ${sessionId}, ${projectCwd},
            ${JSON.stringify(plan)}::jsonb,
            NOW() + (${ttlHours} || ' hours')::interval)
    RETURNING id, expires_at
  `;
  return rows[0];
}

export async function getManifest(
  sql: SqlTag,
  orgId: string,
  manifestId: string,
): Promise<Row | null> {
  const rows = await sql`
    SELECT id, session_id, project_cwd, plan, expires_at, created_at
    FROM code_optimal_file_manifests
    WHERE org_id = ${orgId} AND id = ${manifestId} AND expires_at > NOW()
    LIMIT 1
  `;
  return rows[0] || null;
}
