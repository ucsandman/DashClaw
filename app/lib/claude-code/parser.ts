/**
 * Claude Code JSONL session parser (v2 dedup).
 *
 * Ported from AgentLens (`src/parser.js`) with the addendum #2 refactor:
 * the per-line body is extracted into an internal `_processLine(state, line,
 * lineNo)` helper so we can expose two wrappers that share one source of
 * truth:
 *
 *   - `parseSessionFile(filePath, { mtime })` — streams from disk via
 *     `readline.createInterface` (matches the original AgentLens behavior).
 *   - `parseSessionLines(lines, { mtime, sourceFile })` — consumes an
 *     in-memory array of raw JSON-Lines; the ingest endpoint calls this so the
 *     server never touches the user's filesystem.
 *
 * Both wrappers return the same `session` object shape with v2 dedup
 * (`requestId → message.id → row uuid`) and redacted `safeTarget`.
 *
 * `toolUses[i].messageIndex` is an INDEX into `session.messages`, not a DB id.
 * The repository translates indices to FKs after batch insert.
 */

import fs from 'node:fs';
import readline from 'node:readline';
import { costForUsage, cacheSavingsForUsage } from './pricing';

export const PARSER_VERSION = 2;

interface UsageBlock {
  input_tokens?: number | string;
  output_tokens?: number | string;
  cache_creation_input_tokens?: number | string;
  cache_read_input_tokens?: number | string;
}

interface ContentBlock {
  type?: string;
  text?: string;
  name?: string;
  id?: string;
  input?: Record<string, unknown>;
}

interface JsonlMessage {
  id?: string;
  requestId?: string;
  usage?: UsageBlock | null;
  model?: string | null;
  content?: string | ContentBlock[];
}

interface JsonlRecord {
  type?: string;
  sessionId?: string;
  cwd?: string;
  timestamp?: string;
  uuid?: string;
  requestId?: string;
  message?: JsonlMessage;
  __line?: number;
}

interface ToolUse {
  name: string;
  tool_use_id: string | null;
  input_keys: string[];
  target: string | null;
}

interface TokenTotals {
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
}

interface RequestRecord {
  key: string;
  requestId: string | null;
  messageId: string | null;
  model: string | null;
  timestamp: string | null;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  cost_usd: number;
  cache_savings_usd: number;
  line_first: number;
  line_last: number;
  lines: number[];
  fragment_types: Set<string> | string[];
  text_preview: string;
}

interface SessionMessage {
  uuid: string | null;
  role: string;
  model: string | null;
  timestamp: string | null;
  request_id: string | null;
  message_id: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  cache_creation_tokens: number | null;
  cost_usd: number | null;
  text_preview: string;
}

interface SessionToolUse {
  messageIndex: number;
  name: string;
  tool_use_id: string | null;
  input_keys: string[];
  target: string | null;
  requestId: string | null;
  messageId: string | null;
  line: number;
  timestamp: string | null;
}

interface Session {
  sourceFile: string | null;
  sourceMtime: number | null;
  sessionUuid: string | null;
  projectSlug: string | null;
  cwd: string | null;
  startedAt: string | null;
  endedAt: string | null;
  modelPrimary: string | null;
  parserVersion: number;
  jsonlRecords: number;
  assistantRecords: number;
  userRecords: number;
  fragmentsWithUsage: number;
  duplicateFragmentsSkipped: number;
  modelRequests: number;
  messageCount: number;
  totals: TokenTotals;
  naiveTotals: TokenTotals;
  naiveCostUsd: number;
  cost_usd: number;
  cache_savings_usd: number;
  requests: RequestRecord[];
  requestIndexByKey: Map<string, number>;
  messages: SessionMessage[];
  toolUses: SessionToolUse[];
  skippedLines: number;
}

interface ParseState {
  session: Session;
  modelCounts: Map<string, number>;
}

interface UsageKey {
  key: string;
  requestId: string | null;
  messageId: string | null;
}

function safeParse(line: string): JsonlRecord | null {
  try { return JSON.parse(line); } catch { return null; }
}

function previewText(content: string | ContentBlock[] | undefined): string {
  if (typeof content === 'string') return content.slice(0, 200);
  if (!Array.isArray(content)) return '';
  for (const c of content) {
    if (c?.type === 'text' && typeof c.text === 'string') return c.text.slice(0, 200);
  }
  return '';
}

function extractToolUses(content: string | ContentBlock[] | undefined): ToolUse[] {
  if (!Array.isArray(content)) return [];
  return content
    .filter(c => c && c.type === 'tool_use' && c.name)
    .map(c => ({
      name: c.name as string,
      tool_use_id: c.id || null,
      input_keys: c.input && typeof c.input === 'object' ? Object.keys(c.input).slice(0, 12) : [],
      target: safeTarget(c),
    }));
}

// Return a short, non-secret identifier describing the tool target. Specific to
// well-known tools we recognise — generic fallback is null so we never leak.
function safeTarget(c: ContentBlock): string | null {
  const name = c.name;
  const input = c.input || {};
  try {
    if (name === 'Read' || name === 'Edit' || name === 'Write' || name === 'NotebookEdit') {
      return typeof input.file_path === 'string' ? input.file_path : null;
    }
    if (name === 'Grep' || name === 'Glob') {
      const t = input.path || input.glob || input.pattern;
      return typeof t === 'string' ? t.slice(0, 160) : null;
    }
    if (name === 'Bash' || name === 'PowerShell') {
      const cmd = typeof input.command === 'string' ? input.command : '';
      // Keep first token only — never echo full command lines (could carry secrets).
      const head = cmd.trim().split(/\s+/)[0] || '';
      return head ? head.slice(0, 60) : null;
    }
    if (name === 'TaskCreate' || name === 'TaskUpdate' || name === 'TaskGet' || name === 'TaskStop') {
      if (typeof input.subject === 'string') return input.subject.slice(0, 80);
      if (typeof input.taskId === 'string') return `#${input.taskId}`;
      return null;
    }
    if (name === 'WebFetch' || name === 'WebSearch') {
      if (typeof input.url === 'string') return safeHost(input.url);
      if (typeof input.query === 'string') return input.query.slice(0, 60);
      return null;
    }
    if (name === 'Agent') {
      if (typeof input.subagent_type === 'string') return input.subagent_type;
      if (typeof input.description === 'string') return input.description.slice(0, 60);
      return null;
    }
  } catch { /* fall through */ }
  return null;
}

function safeHost(u: string): string | null {
  try { return new URL(u).host; } catch { return null; }
}

// Stable key for deduplicating model-request usage across multiple JSONL rows.
function usageKeyOf(rec: JsonlRecord): UsageKey {
  const requestId = rec.requestId || (rec.message && rec.message.requestId) || null;
  const messageId = (rec.message && rec.message.id) || null;
  if (requestId) return { key: `req:${requestId}`, requestId, messageId };
  if (messageId) return { key: `msg:${messageId}`, requestId: null, messageId };
  return { key: `row:${rec.uuid || rec.__line || Math.random()}`, requestId: null, messageId: null };
}

function _initState(sourceFile: string | null, mtime: number | null | undefined): ParseState {
  const session: Session = {
    sourceFile: sourceFile || null,
    sourceMtime: mtime || null,
    sessionUuid: null,
    projectSlug: null,
    cwd: null,
    startedAt: null,
    endedAt: null,
    modelPrimary: null,
    parserVersion: PARSER_VERSION,
    // counters split by concept
    jsonlRecords: 0,            // total parsed JSONL lines
    assistantRecords: 0,        // assistant rows
    userRecords: 0,             // user rows
    fragmentsWithUsage: 0,      // assistant rows with usage block
    duplicateFragmentsSkipped: 0,
    modelRequests: 0,           // unique usage keys
    messageCount: 0,            // unique model requests + user messages (UI display)
    totals: { input_tokens: 0, output_tokens: 0, cache_creation_tokens: 0, cache_read_tokens: 0 },
    naiveTotals: { input_tokens: 0, output_tokens: 0, cache_creation_tokens: 0, cache_read_tokens: 0 },
    naiveCostUsd: 0,
    cost_usd: 0,
    cache_savings_usd: 0,
    requests: [],              // [{requestId, messageId, model, usage, cost, lines:[], fragmentTypes:Set, ...}]
    requestIndexByKey: new Map(),
    messages: [],              // canonical messages (one per unique model request + each user msg)
    toolUses: [],              // {messageIndex, name, tool_use_id, requestId, messageId, line, target}
    skippedLines: 0,
  };
  return { session, modelCounts: new Map() };
}

function _processLine(state: ParseState, line: string, lineNo: number): void {
  const { session, modelCounts } = state;
  if (!line.trim()) return;
  const rec = safeParse(line);
  if (!rec) { session.skippedLines++; return; }
  rec.__line = lineNo;
  session.jsonlRecords += 1;

  if (!session.sessionUuid && rec.sessionId) session.sessionUuid = rec.sessionId;
  if (!session.cwd && typeof rec.cwd === 'string') session.cwd = rec.cwd;

  if (rec.timestamp) {
    if (!session.startedAt || rec.timestamp < session.startedAt) session.startedAt = rec.timestamp;
    if (!session.endedAt   || rec.timestamp > session.endedAt)   session.endedAt   = rec.timestamp;
  }

  if (rec.type !== 'user' && rec.type !== 'assistant') return;

  const msg = rec.message || {};
  const usage = msg.usage || null;
  const model = msg.model || null;

  if (rec.type === 'assistant') session.assistantRecords += 1;
  else session.userRecords += 1;

  if (model) {
    modelCounts.set(model, (modelCounts.get(model) || 0) + 1);
  }

  // Naive totals — what a row-summing parser would produce. Stored for audit.
  if (usage) {
    session.naiveTotals.input_tokens += Number(usage.input_tokens) || 0;
    session.naiveTotals.output_tokens += Number(usage.output_tokens) || 0;
    session.naiveTotals.cache_creation_tokens += Number(usage.cache_creation_input_tokens) || 0;
    session.naiveTotals.cache_read_tokens += Number(usage.cache_read_input_tokens) || 0;
    session.naiveCostUsd += costForUsage(model, usage);
    session.fragmentsWithUsage += 1;
  }

  // Deduplicated accounting — only assistant rows with usage participate.
  if (rec.type === 'assistant' && usage) {
    const { key, requestId, messageId } = usageKeyOf(rec);
    let reqIdx = session.requestIndexByKey.get(key);
    if (reqIdx === undefined) {
      // First sighting of this request — count its usage once.
      const cost = costForUsage(model, usage);
      const save = cacheSavingsForUsage(model, usage);
      const reqRecord: RequestRecord = {
        key,
        requestId,
        messageId,
        model,
        timestamp: rec.timestamp || null,
        input_tokens: Number(usage.input_tokens) || 0,
        output_tokens: Number(usage.output_tokens) || 0,
        cache_read_tokens: Number(usage.cache_read_input_tokens) || 0,
        cache_creation_tokens: Number(usage.cache_creation_input_tokens) || 0,
        cost_usd: cost,
        cache_savings_usd: save,
        line_first: lineNo,
        line_last: lineNo,
        lines: [lineNo],
        fragment_types: new Set<string>(),
        text_preview: previewText(msg.content),
      };
      reqIdx = session.requests.length;
      session.requests.push(reqRecord);
      session.requestIndexByKey.set(key, reqIdx);
      session.modelRequests += 1;

      // canonical message row (one per unique request)
      session.messages.push({
        uuid: rec.uuid || null,
        role: 'assistant',
        model,
        timestamp: rec.timestamp || null,
        request_id: requestId,
        message_id: messageId,
        input_tokens: reqRecord.input_tokens,
        output_tokens: reqRecord.output_tokens,
        cache_read_tokens: reqRecord.cache_read_tokens,
        cache_creation_tokens: reqRecord.cache_creation_tokens,
        cost_usd: cost,
        text_preview: reqRecord.text_preview,
      });
      session.messageCount += 1;

      // aggregate deduped totals
      session.totals.input_tokens += reqRecord.input_tokens;
      session.totals.output_tokens += reqRecord.output_tokens;
      session.totals.cache_read_tokens += reqRecord.cache_read_tokens;
      session.totals.cache_creation_tokens += reqRecord.cache_creation_tokens;
      session.cost_usd += cost;
      session.cache_savings_usd += save;
    } else {
      // Duplicate fragment for an already-counted request — track provenance
      // but do not double-count usage.
      const req = session.requests[reqIdx];
      if (req) {
        req.lines.push(lineNo);
        req.line_last = lineNo;
        if (!req.text_preview) req.text_preview = previewText(msg.content);
      }
      session.duplicateFragmentsSkipped += 1;
    }

    // Always extract tool_use fragments regardless of dedup.
    const tools = extractToolUses(msg.content);
    const messageIndex = reqIdx; // index aligns with session.messages
    const reqForFragments = session.requests[reqIdx];
    for (const tu of tools) {
      (reqForFragments?.fragment_types as Set<string>)?.add('tool_use');
      session.toolUses.push({
        messageIndex,
        name: tu.name,
        tool_use_id: tu.tool_use_id,
        input_keys: tu.input_keys,
        target: tu.target,
        requestId,
        messageId,
        line: lineNo,
        timestamp: rec.timestamp || null,
      });
    }
    // Record other fragment types for the audit view
    if (Array.isArray(msg.content)) {
      for (const c of msg.content) {
        if (c && c.type) (reqForFragments?.fragment_types as Set<string>)?.add(c.type);
      }
    }
  } else if (rec.type === 'user') {
    // User rows are kept verbatim — one canonical message each. No usage.
    session.messages.push({
      uuid: rec.uuid || null,
      role: 'user',
      model: null,
      timestamp: rec.timestamp || null,
      request_id: null,
      message_id: null,
      input_tokens: null,
      output_tokens: null,
      cache_read_tokens: null,
      cache_creation_tokens: null,
      cost_usd: null,
      text_preview: previewText(msg.content),
    });
    session.messageCount += 1;
  }
}

function _finalize(state: ParseState): Session {
  const { session, modelCounts } = state;
  if (modelCounts.size) {
    let best: [string, number] | null = null;
    for (const [m, n] of modelCounts) {
      if (!best || n > best[1]) best = [m, n];
    }
    session.modelPrimary = best ? best[0] : null;
  }

  // Convert Set → Array for downstream JSON.
  for (const r of session.requests) {
    r.fragment_types = Array.from(r.fragment_types);
  }

  return session;
}

export async function parseSessionFile(filePath: string, { mtime }: { mtime?: number } = {}): Promise<Session> {
  const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  const state = _initState(filePath, mtime);
  let lineNo = 0;
  for await (const line of rl) {
    lineNo += 1;
    _processLine(state, line, lineNo);
  }
  return _finalize(state);
}

export function parseSessionLines(
  lines: string[],
  { mtime, sourceFile }: { mtime?: number; sourceFile?: string | null } = {},
): Session {
  const state = _initState(sourceFile || null, mtime);
  if (!Array.isArray(lines)) return _finalize(state);
  for (let i = 0; i < lines.length; i++) {
    _processLine(state, lines[i] as string, i + 1);
  }
  return _finalize(state);
}

// Internal helpers exposed for tests only — do not import from production code.
export const _internals = {
  safeParse,
  extractToolUses,
  previewText,
  usageKeyOf,
  safeTarget,
};
