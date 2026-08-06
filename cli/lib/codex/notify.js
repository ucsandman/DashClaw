// cli/lib/codex/notify.js
//
// `dashclaw codex notify` — Codex legacy `notify` config target.
//
// Codex CLI supports a `notify` config that runs an external command after
// each agent turn completes. Codex appends a JSON payload as the FINAL argv
// argument:
//
//   notify = ["node", "/path/to/dashclaw.js", "codex", "notify"]
//
// then on each turn-complete, Codex spawns:
//
//   node /path/to/dashclaw.js codex notify '{"type":"agent-turn-complete", ...}'
//
// This module:
//   1. Extracts the JSON payload from the last argv arg.
//   2. Validates it's an `agent-turn-complete` event.
//   3. POSTs a record to /api/actions/by-tool-use-id (the same endpoint the
//      PostToolUse Python hook uses for its terminal patch) with an action
//      shape that represents the turn as a single observable unit.
//
// Failure mode: Codex spawns notify fire-and-forget with stdio nulled. We
// MUST exit 0 on any failure so we don't surface error output to the user.
// All errors are logged to stderr and swallowed by the spawn.

import { request } from 'node:http';
import { request as requestHttps } from 'node:https';

const TURN_COMPLETE_TYPE = 'agent-turn-complete';

/**
 * Parse the Codex notify payload from argv. Codex appends the JSON as the
 * final argv slot. We accept either:
 *  - argv last arg is a JSON string → parse it
 *  - argv last arg is empty + stdin has JSON → read stdin
 *
 * Returns the parsed object, or null if no valid payload was found.
 */
export function parseNotifyPayload(argv) {
  if (!Array.isArray(argv) || argv.length === 0) return null;
  const last = argv[argv.length - 1];
  if (typeof last !== 'string' || last.length === 0) return null;
  if (last[0] !== '{') return null;
  try {
    return JSON.parse(last);
  } catch {
    return null;
  }
}

/**
 * Map a Codex turn-complete payload to a DashClaw action_record shape.
 * We declare the turn as a single coarse action so it shows up in the
 * decision ledger. Token/cost data is not in the notify payload — it will
 * be back-filled by the Phase 3 JSONL ingest path.
 */
// Codex's notify payload key style varies by version: current CLIs emit
// snake_case (`turn_id`), while the 0.13x line (still vendored inside
// OpenClaw's codex runtime) emits kebab-case (`turn-id`). Accept both.
function notifyField(payload, snakeKey) {
  const v = payload[snakeKey];
  return v !== undefined ? v : payload[snakeKey.replace(/_/g, '-')];
}

export function buildActionFromNotify(payload, { agentId = 'codex' } = {}) {
  const lastMessage = notifyField(payload, 'last_assistant_message') || '';
  const summary = lastMessage.length > 200
    ? lastMessage.slice(0, 197) + '...'
    : lastMessage;

  const threadId = notifyField(payload, 'thread_id');
  const turnId = notifyField(payload, 'turn_id');
  const inputMessages = notifyField(payload, 'input_messages');

  return {
    agent_id: agentId,
    action_type: 'agent_turn',
    declared_goal: `Codex turn ${turnId || '?'} (${threadId || 'thread'})`,
    outcome: 'success',
    metadata: {
      source: 'codex-notify',
      thread_id: threadId,
      turn_id: turnId,
      cwd: payload.cwd,
      client: payload.client || 'codex',
      input_message_count: Array.isArray(inputMessages)
        ? inputMessages.length
        : 0,
      last_assistant_summary: summary,
    },
  };
}

/**
 * Send an action record to DashClaw. Returns:
 *  - { status: 'sent', actionId }   on 2xx
 *  - { status: 'skipped', reason }  on local-validation skip
 *  - { status: 'error', reason }    on network/4xx/5xx
 *
 * Never throws. All errors are returned in the result object so the caller
 * can decide whether to swallow them.
 */
export async function postNotifyAction({ baseUrl, apiKey, action, timeoutMs = 5000 }) {
  if (!baseUrl || !apiKey) {
    return { status: 'skipped', reason: 'missing_config' };
  }

  let url;
  try {
    url = new URL('/api/actions', baseUrl);
  } catch (err) {
    return { status: 'error', reason: 'invalid_base_url', detail: err.message };
  }

  const body = JSON.stringify(action);
  const headers = {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body).toString(),
    'x-api-key': apiKey,
  };

  return new Promise((resolve) => {
    const lib = url.protocol === 'https:' ? requestHttps : request;
    const req = lib(
      {
        method: 'POST',
        host: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        headers,
      },
      (res) => {
        let chunks = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { chunks += c; });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            let parsed = null;
            try { parsed = JSON.parse(chunks); } catch { /* keep null */ }
            resolve({
              status: 'sent',
              actionId: parsed?.action_id || parsed?.id || null,
            });
          } else {
            resolve({
              status: 'error',
              reason: `http_${res.statusCode}`,
              detail: chunks.slice(0, 200),
            });
          }
        });
      },
    );

    req.on('error', (err) => {
      resolve({ status: 'error', reason: 'network', detail: err.message });
    });

    req.setTimeout(timeoutMs, () => {
      req.destroy();
      resolve({ status: 'error', reason: 'timeout' });
    });

    req.write(body);
    req.end();
  });
}

/**
 * Run the notify command. This is the CLI entrypoint.
 *
 * IMPORTANT: must always exit 0 (the caller calls process.exit(0)).
 * Codex spawns notify with stdio nulled and treats any failure as silent.
 * We log to stderr (which Codex discards by design) for diagnostics.
 *
 * Options:
 *   argv      — argv array (defaults to process.argv.slice(2))
 *   baseUrl   — DashClaw instance URL
 *   apiKey    — DashClaw API key
 *   agentId   — agent identity (default: codex)
 *   logger    — { warn, info } for diagnostic output
 *   skipPost  — if true, do everything except the HTTP call (testing)
 */
export async function runCodexNotify({
  argv = process.argv.slice(2),
  baseUrl,
  apiKey,
  agentId = 'codex',
  logger = console,
  skipPost = false,
} = {}) {
  const payload = parseNotifyPayload(argv);
  if (!payload) {
    logger.warn('codex-notify: no JSON payload in argv, exiting 0');
    return { status: 'skipped', reason: 'no_payload' };
  }
  if (payload.type !== TURN_COMPLETE_TYPE) {
    logger.warn(`codex-notify: unknown payload type "${payload.type}", exiting 0`);
    return { status: 'skipped', reason: 'unknown_type', type: payload.type };
  }

  const action = buildActionFromNotify(payload, { agentId });

  if (skipPost) {
    return { status: 'dry_run', action };
  }

  const result = await postNotifyAction({ baseUrl, apiKey, action });
  if (result.status === 'sent') {
    logger.info?.(`codex-notify: recorded action ${result.actionId || '(unknown id)'}`);
  } else if (result.status === 'error') {
    logger.warn(`codex-notify: ${result.reason}${result.detail ? ' — ' + result.detail : ''}`);
  }
  return result;
}
