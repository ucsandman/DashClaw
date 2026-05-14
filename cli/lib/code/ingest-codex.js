// cli/lib/code/ingest-codex.js
//
// Codex JSONL backfill. Walks `codexSessionsDir` (default ~/.codex/sessions),
// parses each rollout file via app/lib/codex/parser.js, and either:
//
//   (a) writes the normalized session JSON to an --out directory (default
//       ~/.dashclaw/codex-sessions/) for later server upload, or
//   (b) POSTs it to --endpoint <url> directly.
//
// Phase 3 ships option (a) — local-only. Option (b) becomes useful once
// the server-side ingest route accepts source_host='codex-jsonl' (deferred
// until the AgentLens absorption lands, to avoid editing files already
// being modified by another agent).
//
// Output JSON shape is the raw parseCodexSessionFile return value. The
// server, when it grows codex ingestion, will deserialize it and persist.
//
// Logs per file: { file, status, reason?, session_uuid?, turns?, tokens? }.
// NEVER logs raw message text — could leak user transcripts.

import fs from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';

import { parseCodexSessionFile } from '../../../app/lib/codex/parser.js';

const MAX_FILE_BYTES = 100 * 1024 * 1024; // codex rollouts can grow large

export function defaultCodexSessionsDir(env = process.env) {
  if (env.CODEX_SESSIONS_DIR) return env.CODEX_SESSIONS_DIR;
  const root = process.platform === 'win32'
    ? (env.USERPROFILE || homedir())
    : (env.HOME || homedir());
  // Codex defaults to <codex_home>/sessions; codex_home defaults to ~/.codex.
  return path.join(env.CODEX_HOME || path.join(root, '.codex'), 'sessions');
}

export function defaultCodexOutDir(env = process.env) {
  if (env.DASHCLAW_CODEX_OUT_DIR) return env.DASHCLAW_CODEX_OUT_DIR;
  const root = process.platform === 'win32'
    ? (env.USERPROFILE || homedir())
    : (env.HOME || homedir());
  return path.join(root, '.dashclaw', 'codex-sessions');
}

function listJsonlFiles(rootDir) {
  const out = [];
  let entries;
  try { entries = fs.readdirSync(rootDir, { withFileTypes: true }); }
  catch { return out; }
  for (const e of entries) {
    const p = path.join(rootDir, e.name);
    if (e.isDirectory()) {
      // Recurse one level — codex doesn't currently nest, but archived
      // sessions sometimes land in `<sessions>/archived/`.
      let inner;
      try { inner = fs.readdirSync(p, { withFileTypes: true }); }
      catch { continue; }
      for (const f of inner) {
        if (f.isFile() && f.name.endsWith('.jsonl')) {
          out.push(path.join(p, f.name));
        }
      }
    } else if (e.isFile() && e.name.endsWith('.jsonl')) {
      out.push(p);
    }
  }
  return out;
}

function bytesOf(filePath) {
  try { return fs.statSync(filePath).size; }
  catch { return 0; }
}

/**
 * Build the per-session output JSON. Stable shape that the server can
 * consume once codex ingestion lands.
 */
function buildOutputPayload(session) {
  return {
    parser_version: session.parserVersion,
    agent_kind: session.agentKind,
    session_uuid: session.sessionUuid,
    cwd: session.cwd,
    cli_version: session.cliVersion,
    originator: session.originator,
    model_provider: session.modelProvider,
    model_primary: session.modelPrimary,
    started_at: session.startedAt,
    ended_at: session.endedAt,
    git_branch: session.gitBranch,
    git_commit: session.gitCommit,
    git_repo_url: session.gitRepoUrl,
    jsonl_records: session.jsonlRecords,
    skipped_lines: session.skippedLines,
    response_items: session.responseItems,
    event_messages: session.eventMessages,
    compacted_items: session.compactedItems,
    tool_call_count: session.toolCallCount,
    turn_count: session.turnCount,
    totals: session.totals,
    turns: session.turns,
    // Messages and tool uses are large — keep them in the payload so the
    // server can persist them when ready. CLI does not log them.
    messages: session.messages,
    tool_uses: session.toolUses,
    source: {
      host: 'codex-jsonl',
      file: session.sourceFile,
      mtime: session.sourceMtime,
    },
  };
}

async function writeLocalOut({ outDir, payload }) {
  fs.mkdirSync(outDir, { recursive: true });
  const id = payload.session_uuid || `unknown-${Date.now()}`;
  const target = path.join(outDir, `${id}.json`);
  fs.writeFileSync(target, JSON.stringify(payload, null, 2) + '\n');
  return target;
}

async function postPayload({ endpoint, apiKey, payload, timeoutMs = 10000 }) {
  const url = new URL(endpoint);
  const body = JSON.stringify(payload);
  const headers = {
    'content-type': 'application/json',
    'x-api-key': apiKey,
  };

  const { request: httpReq } = await import('node:http');
  const { request: httpsReq } = await import('node:https');
  const lib = url.protocol === 'https:' ? httpsReq : httpReq;

  return new Promise((resolve) => {
    const req = lib({
      method: 'POST',
      host: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      headers: { ...headers, 'content-length': Buffer.byteLength(body).toString() },
    }, (res) => {
      let chunks = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { chunks += c; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ status: 'ingested', http: res.statusCode });
        } else {
          resolve({ status: 'error', reason: `http_${res.statusCode}`, detail: chunks.slice(0, 200) });
        }
      });
    });
    req.on('error', (err) => resolve({ status: 'error', reason: 'network', detail: err.message }));
    req.setTimeout(timeoutMs, () => { req.destroy(); resolve({ status: 'error', reason: 'timeout' }); });
    req.write(body);
    req.end();
  });
}

/**
 * Top-level orchestration. Returns an array of result objects, one per
 * jsonl file found in `sessionsDir`.
 */
export async function runCodexIngest({
  sessionsDir = defaultCodexSessionsDir(),
  outDir = defaultCodexOutDir(),
  endpoint = null,    // when set, POST instead of write-local
  apiKey = null,
  dryRun = false,
  logger = console,
} = {}) {
  if (!fs.existsSync(sessionsDir)) {
    logger.warn?.(`codex ingest: sessions dir does not exist: ${sessionsDir}`);
    return [];
  }
  const files = listJsonlFiles(sessionsDir);
  if (files.length === 0) {
    logger.info?.(`codex ingest: no .jsonl files in ${sessionsDir}`);
    return [];
  }

  const results = [];
  for (const file of files) {
    const size = bytesOf(file);
    if (size === 0) {
      results.push({ file, status: 'skipped', reason: 'empty' });
      continue;
    }
    if (size > MAX_FILE_BYTES) {
      results.push({ file, status: 'skipped', reason: 'too_large', bytes: size });
      continue;
    }

    let session;
    try {
      session = await parseCodexSessionFile(file);
    } catch (err) {
      results.push({ file, status: 'error', reason: 'parse', detail: err.message });
      continue;
    }
    const payload = buildOutputPayload(session);

    if (dryRun) {
      results.push({
        file,
        status: 'dry_run',
        session_uuid: session.sessionUuid,
        turns: session.turnCount,
        tokens: session.totals,
      });
      continue;
    }

    if (endpoint) {
      const httpResult = await postPayload({ endpoint, apiKey, payload });
      results.push({
        file,
        ...httpResult,
        session_uuid: session.sessionUuid,
        turns: session.turnCount,
      });
    } else {
      try {
        const target = await writeLocalOut({ outDir, payload });
        results.push({
          file,
          status: 'written_local',
          session_uuid: session.sessionUuid,
          out: target,
          turns: session.turnCount,
          tokens: session.totals,
        });
      } catch (err) {
        results.push({ file, status: 'error', reason: 'write', detail: err.message });
      }
    }
  }

  return results;
}
