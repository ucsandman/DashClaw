// Path B JSONL ingest. Walks `claudeProjectsDir`, posts each .jsonl file to
// /api/code-sessions/ingest-jsonl with source_host='jsonl'. Per A6 in the
// goal, the CLI does NOT parse — the server runs the canonical parser.
//
// Stream-reads files line-by-line so a large transcript doesn't have to fit
// in memory all at once. The body always carries raw `jsonl_lines`; when the
// serialized request exceeds WIRE_COMPRESS_THRESHOLD, postIngest brotli-compresses
// the whole envelope on the wire (via the `x-dashclaw-encoding: br` header) to fit
// Vercel's 4.5 MB per-request body limit. Files above MAX_FILE_BYTES are still
// skipped — compression can't rescue arbitrarily large inputs.
//
// Logs per file: { file, posted_lines, status, reason }. NEVER logs raw line
// content — that would leak the user's transcripts through CI logs.

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import zlib from 'node:zlib';
import { homedir } from 'node:os';

// Absolute ceiling. Vercel Hobby's 4.5 MB body limit is the binding constraint,
// applied to the *compressed* wire body. Brotli q9 compresses our JSONL ~4×, so
// typical-density sessions fit in one request up to ~15-17 MB raw (measured: a
// 13.3 MB raw session → ~3.5 MB brotli). Density varies, so a file between that
// and MAX_FILE_BYTES can still exceed the cap and 413; line-chunked POST is the
// documented future path for those. Files above MAX_FILE_BYTES are skipped
// outright with `too_large` — no compression rescues them.
const MAX_FILE_BYTES = 40 * 1024 * 1024;
// Serialized-JSON byte size above which postIngest brotli-compresses the request
// body (custom `x-dashclaw-encoding: br` transport). Below this the plain JSON
// body fits comfortably and we skip the compress CPU cost for the hot path of
// small per-session deltas. Set well under Vercel's 4.5 MB cap so the *plain*
// path is only ever used for bodies that are already safe.
const WIRE_COMPRESS_THRESHOLD = 3 * 1024 * 1024;
// Brotli quality for the wire body. q9 is the knee of the size/time curve for
// our payloads (measured on a 14 MB envelope): ~0.8 s at q9 → 3.57 MB, vs q11's
// ~13 s for only ~0.1 MB less. q10+ cliffs in time for negligible gain; q9
// still clears Vercel's 4.5 MB cap with ~0.6 MB headroom.
const BROTLI_QUALITY = 9;

export function defaultClaudeProjectsDir(env = process.env) {
  if (env.CLAUDE_PROJECTS_DIR) return env.CLAUDE_PROJECTS_DIR;
  if (process.platform === 'win32') {
    return path.join(env.USERPROFILE || homedir(), '.claude', 'projects');
  }
  return path.join(env.HOME || homedir(), '.claude', 'projects');
}

function listJsonlFiles(rootDir) {
  const out = [];
  let entries;
  try { entries = fs.readdirSync(rootDir, { withFileTypes: true }); }
  catch { return out; }
  for (const e of entries) {
    const p = path.join(rootDir, e.name);
    if (e.isDirectory()) {
      let inner;
      try { inner = fs.readdirSync(p, { withFileTypes: true }); }
      catch { continue; }
      for (const f of inner) {
        if (f.isFile() && f.name.endsWith('.jsonl')) out.push(path.join(p, f.name));
      }
    } else if (e.isFile() && e.name.endsWith('.jsonl')) {
      out.push(p);
    }
  }
  return out;
}

async function readLines(filePath) {
  const lines = [];
  const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    if (line) lines.push(line);
  }
  return lines;
}

// Recover the project's real working directory from the transcript itself.
// Claude Code stamps a `cwd` field on JSONL records; the encoded directory
// slug (c--projects-dashclaw) is NOT reversible, so this is the only
// client-side source of a copy-pasteable path. Bounded scan; null when absent.
export function deriveCwdFromLines(lines, maxScan = 50) {
  for (const line of lines.slice(0, maxScan)) {
    try {
      const rec = JSON.parse(line);
      if (rec && typeof rec.cwd === 'string' && rec.cwd.trim()) return rec.cwd;
    } catch {
      // Non-JSON line — keep scanning; the parser tolerates these too.
    }
  }
  return null;
}

export async function buildIngestPayload(filePath, { cwdOverride = null } = {}) {
  const stat = fs.statSync(filePath);
  if (stat.size > MAX_FILE_BYTES) {
    return { tooLarge: true, sizeBytes: stat.size };
  }
  const parent = path.dirname(filePath);
  const slug = path.basename(parent);
  const lines = await readLines(filePath);

  // Always build the logical body with raw `jsonl_lines`. Wire compression is
  // decided in postIngest (gzip the whole envelope when it's large) rather than
  // here — keeping payload construction independent of transport means the same
  // body serializes identically whether or not it ends up gzipped.
  const body = {
    project: {
      slug,
      cwd: cwdOverride || deriveCwdFromLines(lines),
      source_host: 'jsonl',
    },
    session_uuid: null,
    source_file: filePath,
    source_mtime: stat.mtime.toISOString(),
    tool_use_action_map: {},
    jsonl_lines: lines,
  };

  return {
    body,
    sizeBytes: stat.size,
    lineCount: lines.length,
  };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function postIngest(baseUrl, apiKey, body, { fetchImpl = fetch, maxRetries = 4 } = {}) {
  const url = baseUrl.replace(/\/+$/, '') + '/api/code-sessions/ingest-jsonl';
  // Decide transport once, outside the retry loop: brotli-compress the JSON
  // envelope when it's large. The custom `x-dashclaw-encoding: br` header tells
  // the server to inflate before parsing. Brotli (not gzip) keeps the wire body
  // under Vercel's 4.5 MB cap for the big sessions that gzip couldn't fit — a
  // 14 MB envelope is ~4.34 MB gzipped (over the cap) but ~3.5 MB brotli q9.
  const json = JSON.stringify(body);
  const jsonBytes = Buffer.byteLength(json, 'utf8');
  const useCompression = jsonBytes > WIRE_COMPRESS_THRESHOLD;
  const requestBody = useCompression
    ? zlib.brotliCompressSync(json, {
        params: {
          [zlib.constants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY,
          [zlib.constants.BROTLI_PARAM_SIZE_HINT]: jsonBytes,
        },
      })
    : json;
  const headers = { 'content-type': 'application/json', 'x-api-key': apiKey };
  if (useCompression) headers['x-dashclaw-encoding'] = 'br';
  let lastStatus = 0;
  let lastPayload = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers,
      body: requestBody,
    });
    let payload = null;
    try { payload = await res.json(); } catch { /* keep payload null */ }
    if (res.ok) return { status: res.status, ok: true, payload };
    lastStatus = res.status;
    lastPayload = payload;
    // Retry on 429 (rate limit) and 5xx with exponential backoff +
    // honour Retry-After when the server provides it. Anything else is
    // surfaced immediately.
    const retryable = res.status === 429 || (res.status >= 500 && res.status < 600);
    if (!retryable || attempt === maxRetries) break;
    const retryAfter = Number(res.headers?.get?.('retry-after')) || 0;
    const backoffMs = retryAfter > 0
      ? Math.min(retryAfter * 1000, 30000)
      : Math.min(1000 * 2 ** attempt, 16000);
    await sleep(backoffMs);
  }
  return { status: lastStatus, ok: false, payload: lastPayload };
}

/**
 * Run the ingest pipeline. Returns a per-file result array. Throws on
 * total config failure; per-file failures are recorded in the result.
 *
 * @param {Object} args
 * @param {string} args.baseUrl
 * @param {string} args.apiKey
 * @param {string} args.projectsDir
 * @param {boolean} [args.dryRun]   When true, builds payloads but skips POST.
 * @param {Function} [args.fetchImpl]
 * @param {Object}   [args.logger]  { info(line), warn(line) }
 */
export async function runIngest({
  baseUrl,
  apiKey,
  projectsDir,
  dryRun = false,
  fetchImpl = fetch,
  logger = console,
}) {
  if (!baseUrl) throw new Error('runIngest: baseUrl is required');
  if (!apiKey && !dryRun) throw new Error('runIngest: apiKey is required for live ingest');

  const files = listJsonlFiles(projectsDir);
  if (!files.length) {
    logger.info(`No .jsonl files found under ${projectsDir}.`);
    return [];
  }

  const results = [];
  for (const file of files) {
    let payload;
    try {
      payload = await buildIngestPayload(file);
    } catch (err) {
      results.push({ file, status: 'error', reason: 'read_failed:' + err.message });
      logger.warn(`  ${file} -> read_failed: ${err.message}`);
      continue;
    }
    if (payload.tooLarge) {
      results.push({ file, status: 'skipped', reason: 'too_large', size_bytes: payload.sizeBytes });
      logger.warn(`  ${file} -> skipped (${payload.sizeBytes} bytes > ${MAX_FILE_BYTES})`);
      continue;
    }
    if (dryRun) {
      results.push({
        file,
        status: 'dry_run',
        reason: 'no_post',
        posted_lines: payload.lineCount,
        size_bytes: payload.sizeBytes,
        slug: payload.body.project.slug,
      });
      logger.info(`  ${file} -> dry_run (${payload.lineCount} lines, slug=${payload.body.project.slug})`);
      continue;
    }
    // Light throttle between live POSTs so a fresh-disk backfill of
    // hundreds of files doesn't hammer Vercel's per-IP rate limit.
    if (results.length > 0) await sleep(150);
    try {
      const { status, ok, payload: respBody } = await postIngest(baseUrl, apiKey, payload.body, { fetchImpl });
      if (!ok) {
        results.push({ file, status: 'error', reason: 'http_' + status, posted_lines: payload.lineCount });
        logger.warn(`  ${file} -> HTTP ${status}`);
        continue;
      }
      const sess = respBody?.session || {};
      results.push({
        file,
        status: sess.skipped ? 'skipped_unchanged' : 'ingested',
        reason: sess.reason || 'ok',
        posted_lines: payload.lineCount,
        session_id: sess.id || null,
      });
      logger.info(`  ${file} -> ${sess.skipped ? 'skipped_unchanged' : 'ingested'} (${payload.lineCount} lines)`);
    } catch (err) {
      results.push({ file, status: 'error', reason: 'network:' + err.message });
      logger.warn(`  ${file} -> network: ${err.message}`);
    }
  }
  return results;
}
