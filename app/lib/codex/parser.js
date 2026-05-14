// app/lib/codex/parser.js
//
// Codex CLI session JSONL parser.
//
// Codex writes session rollouts to `~/.codex/sessions/rollout-<ts>-<uuid>.jsonl`.
// Each line has the shape:
//
//   { "timestamp": "...", "type": "session_meta"|"response_item"|...,
//     "payload": { ... } }
//
// We normalize the rollout into a session object that's intentionally
// parallel to the Claude Code parser output (app/lib/claude-code/parser.js)
// so downstream insights, alerts, and rules engines can be reused with
// minimal branching. The shape differs only where Codex's data model
// fundamentally diverges from Claude's (token semantics, reasoning tokens).
//
// Token mapping (Codex → normalized):
//   input_tokens            → input_tokens
//   output_tokens           → output_tokens (excludes reasoning)
//   cached_input_tokens     → cache_read_tokens
//   reasoning_output_tokens → reasoning_tokens (Codex-only field)
//   total_tokens            → recomputed at the request level for safety
//
// There is no Codex equivalent to Claude's `cache_creation_tokens`. We emit
// 0 for that field on Codex sessions to keep the schema compatible.
//
// This parser is deliberately tolerant: malformed lines are counted in
// `skippedLines` and never throw. It returns a partial session even when
// the rollout was truncated mid-write.

import fs from 'node:fs';
import readline from 'node:readline';

export const CODEX_PARSER_VERSION = 1;

function safeParse(line) {
  try { return JSON.parse(line); } catch { return null; }
}

function previewText(value, max = 200) {
  if (typeof value !== 'string') return '';
  return value.slice(0, max);
}

// Best-effort agent-kind tag for downstream branching. Always 'codex' here.
export const CODEX_AGENT_KIND = 'codex';

function _initState({ sourceFile, sourceMtime }) {
  return {
    session: {
      agentKind: CODEX_AGENT_KIND,
      sourceFile: sourceFile || null,
      sourceMtime: sourceMtime || null,
      sessionUuid: null,
      projectSlug: null,
      cwd: null,
      gitBranch: null,
      gitCommit: null,
      gitRepoUrl: null,
      cliVersion: null,
      originator: null,
      modelProvider: null,
      modelPrimary: null,
      startedAt: null,
      endedAt: null,
      parserVersion: CODEX_PARSER_VERSION,
      // counters
      jsonlRecords: 0,
      responseItems: 0,
      eventMessages: 0,
      compactedItems: 0,
      skippedLines: 0,
      turnCount: 0,
      toolCallCount: 0,
      // token totals
      totals: {
        input_tokens: 0,
        output_tokens: 0,
        cache_read_tokens: 0,
        cache_creation_tokens: 0, // always 0 for Codex; kept for schema parity
        reasoning_tokens: 0,
      },
      // per-turn token snapshots, in arrival order
      turns: [], // { turnId, inputTokens, outputTokens, cachedInputTokens, reasoningTokens, total, at }
      // canonical message timeline (user + assistant + reasoning + tool_call + tool_result)
      messages: [],
      // tool uses across the session
      toolUses: [],
    },
    seenTurnIds: new Set(),
  };
}

function _handleSessionMeta(state, payload, ts) {
  const s = state.session;
  if (!s.sessionUuid && payload?.id) s.sessionUuid = payload.id;
  if (!s.cwd && payload?.cwd) s.cwd = payload.cwd;
  if (!s.cliVersion && payload?.cli_version) s.cliVersion = payload.cli_version;
  if (!s.originator && payload?.originator) s.originator = payload.originator;
  if (!s.modelProvider && payload?.model_provider) s.modelProvider = payload.model_provider;
  if (!s.startedAt) s.startedAt = ts || payload?.timestamp || null;
  if (payload?.git && typeof payload.git === 'object') {
    if (!s.gitBranch && payload.git.branch) s.gitBranch = payload.git.branch;
    if (!s.gitCommit && payload.git.commit_hash) s.gitCommit = payload.git.commit_hash;
    if (!s.gitRepoUrl && payload.git.repository_url) s.gitRepoUrl = payload.git.repository_url;
  }
}

function _handleResponseItem(state, payload, ts) {
  const s = state.session;
  s.responseItems += 1;

  if (!payload || typeof payload !== 'object') return;
  const role = payload.role;

  // Response items can be of several shapes:
  //   - { role: 'user'|'assistant'|'system', content: [...] }
  //   - { type: 'function_call', name, arguments, call_id }
  //   - { type: 'function_call_output', call_id, output }
  //   - { type: 'reasoning', summary: [...] }

  if (payload.type === 'function_call' || (payload.name && payload.call_id)) {
    s.toolCallCount += 1;
    s.toolUses.push({
      name: payload.name || 'unknown',
      tool_use_id: payload.call_id || payload.id || null,
      arguments_preview: previewText(payload.arguments, 240),
      target: safeToolTarget(payload),
      at: ts,
    });
    s.messages.push({
      role: 'tool_call',
      name: payload.name,
      tool_use_id: payload.call_id || null,
      preview: previewText(payload.arguments, 240),
      at: ts,
    });
    return;
  }

  if (payload.type === 'function_call_output') {
    s.messages.push({
      role: 'tool_result',
      tool_use_id: payload.call_id || null,
      preview: previewText(
        typeof payload.output === 'string' ? payload.output : JSON.stringify(payload.output ?? ''),
        240,
      ),
      at: ts,
    });
    return;
  }

  if (payload.type === 'reasoning') {
    // Reasoning items are first-class in Codex — we keep a stub on the
    // timeline so downstream tools can correlate cost with thinking.
    s.messages.push({ role: 'reasoning', preview: '(reasoning)', at: ts });
    return;
  }

  if (role && Array.isArray(payload.content)) {
    s.messages.push({
      role,
      preview: extractTextPreview(payload.content),
      at: ts,
    });
  }
}

function extractTextPreview(content) {
  for (const c of content) {
    if (!c) continue;
    if (typeof c === 'string') return previewText(c);
    if (c.type === 'input_text' && typeof c.text === 'string') return previewText(c.text);
    if (c.type === 'output_text' && typeof c.text === 'string') return previewText(c.text);
    if (c.type === 'text' && typeof c.text === 'string') return previewText(c.text);
  }
  return '';
}

function safeToolTarget(p) {
  // Codex tools include `local_shell` (command exec) and a generic `apply_patch`
  // among many MCP tools. We try to extract a SHORT non-secret identifier.
  try {
    const args = typeof p.arguments === 'string'
      ? JSON.parse(p.arguments)
      : p.arguments;
    if (!args || typeof args !== 'object') return null;
    if (p.name === 'local_shell' || p.name === 'shell') {
      const cmd = typeof args.command === 'string'
        ? args.command
        : Array.isArray(args.command) ? args.command.join(' ') : '';
      const head = cmd.trim().split(/\s+/)[0] || '';
      return head ? head.slice(0, 60) : null;
    }
    if (typeof args.file_path === 'string') return args.file_path.slice(0, 160);
    if (typeof args.path === 'string') return args.path.slice(0, 160);
    if (typeof args.url === 'string') {
      try { return new URL(args.url).host; } catch { return null; }
    }
  } catch { /* fall through */ }
  return null;
}

function _handleEventMsg(state, payload, ts) {
  const s = state.session;
  s.eventMessages += 1;

  if (!payload || typeof payload !== 'object') return;
  const type = payload.type;

  if (type === 'token_count') {
    // Payload shape: { type: 'token_count', info: { total_token_usage, last_token_usage, model_context_window } }
    const last = payload.info?.last_token_usage;
    if (last) {
      const input = Number(last.input_tokens) || 0;
      const output = Number(last.output_tokens) || 0;
      const cachedInput = Number(last.cached_input_tokens) || 0;
      const reasoning = Number(last.reasoning_output_tokens) || 0;
      const total = Number(last.total_tokens) || (input + output + cachedInput + reasoning);

      s.totals.input_tokens += input;
      s.totals.output_tokens += output;
      s.totals.cache_read_tokens += cachedInput;
      s.totals.reasoning_tokens += reasoning;

      // Turn snapshot — Codex emits one token_count per model turn. We use
      // the event ordinal as a synthetic turn id since the payload doesn't
      // carry one. The token-count event always corresponds to one turn.
      const turnId = `t${s.turns.length + 1}`;
      s.turns.push({
        turnId,
        inputTokens: input,
        outputTokens: output,
        cachedInputTokens: cachedInput,
        reasoningTokens: reasoning,
        total,
        at: ts,
      });
      s.turnCount = s.turns.length;
    }
    return;
  }

  if (type === 'session_configured') {
    if (!s.modelPrimary && payload.model) s.modelPrimary = payload.model;
    return;
  }

  if (type === 'agent_message') {
    if (typeof payload.message === 'string') {
      s.messages.push({ role: 'assistant', preview: previewText(payload.message), at: ts });
    }
    return;
  }

  if (type === 'user_message') {
    if (typeof payload.message === 'string') {
      s.messages.push({ role: 'user', preview: previewText(payload.message), at: ts });
    }
    return;
  }
}

function _handleCompacted(state, payload, ts) {
  const s = state.session;
  s.compactedItems += 1;
  s.messages.push({
    role: 'system',
    preview: '(compacted) ' + previewText(payload?.message || '', 180),
    at: ts,
  });
}

function _processLine(state, line, lineNo) {
  if (!line || !line.trim()) return;
  const rec = safeParse(line);
  const s = state.session;
  if (!rec || typeof rec !== 'object') {
    s.skippedLines += 1;
    return;
  }
  s.jsonlRecords += 1;

  const ts = typeof rec.timestamp === 'string' ? rec.timestamp : null;
  if (ts) {
    if (!s.startedAt || ts < s.startedAt) s.startedAt = ts;
    if (!s.endedAt || ts > s.endedAt) s.endedAt = ts;
  }

  // RolloutLine flattens `type` to the top level (serde flatten).
  const type = rec.type;
  const payload = rec.payload;

  switch (type) {
    case 'session_meta':
      _handleSessionMeta(state, payload, ts);
      break;
    case 'response_item':
      _handleResponseItem(state, payload, ts);
      break;
    case 'event_msg':
      _handleEventMsg(state, payload, ts);
      break;
    case 'compacted':
      _handleCompacted(state, payload, ts);
      break;
    case 'turn_context':
      // No-op for now; turn_context carries the per-turn model + tool list
      // but we don't yet use it for normalization.
      break;
    default:
      // Unknown line type — counted in jsonlRecords but no further action.
      break;
  }
}

/**
 * Parse an array of raw JSONL lines (in-memory). Returns the normalized
 * session object. The server uses this so it never touches the filesystem.
 */
export function parseCodexSessionLines(lines, { sourceFile = null, sourceMtime = null } = {}) {
  if (!Array.isArray(lines)) {
    throw new TypeError('parseCodexSessionLines: lines must be an array of strings');
  }
  const state = _initState({ sourceFile, sourceMtime });
  for (let i = 0; i < lines.length; i++) {
    _processLine(state, lines[i], i + 1);
  }
  return state.session;
}

/**
 * Stream-parse a Codex JSONL file from disk. Used by the CLI ingest path.
 */
export async function parseCodexSessionFile(filePath, { mtime } = {}) {
  const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let actualMtime = mtime;
  if (!actualMtime) {
    try { actualMtime = fs.statSync(filePath).mtime.toISOString(); } catch { /* keep null */ }
  }
  const state = _initState({ sourceFile: filePath, sourceMtime: actualMtime });
  let lineNo = 0;
  for await (const line of rl) {
    _processLine(state, line, ++lineNo);
  }
  return state.session;
}
