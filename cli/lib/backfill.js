// cli/lib/backfill.js
//
// Reads ~/.dashclaw/orphan-actions.jsonl (written by
// hooks/dashclaw_pretool.py's handle_guard_unavailable whenever the guard is
// unreachable or unauthorized) and posts each record into the ledger via
// POST /api/actions. The hook tells the operator four separate times that
// the action is "logged for backfill on guard recovery" — this is that
// backfill; before it existed, the file grew forever and nothing ever read
// it.
//
// Idempotent by construction: idempotency_key is derived deterministically
// from the record's own content, so re-posting the same line is a no-op
// server-side (unique index on (org_id, idempotency_key) — see
// app/api/actions/route.ts and app/lib/repositories/actions.repository.ts).
// Only records confirmed landed in the ledger are removed from the file; a
// malformed line or a failed POST stays for the next run.

import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';

export function defaultOrphanPath() {
  return join(homedir(), '.dashclaw', 'orphan-actions.jsonl');
}

// Required by POST /api/actions' validator (app/lib/validate.js
// ACTION_RECORD_SCHEMA): agent_id, action_type, declared_goal. The hook's
// context dict (hooks/dashclaw_pretool.py _build_guard_context) always
// carries all three, but a hand-edited or truncated line might not.
function missingRequiredField(context) {
  if (!context || typeof context !== 'object') return 'record.context is missing';
  if (!context.agent_id) return 'context.agent_id is missing';
  if (!context.action_type) return 'context.action_type is missing';
  if (!context.declared_goal) return 'context.declared_goal is missing';
  return null;
}

// Deterministic per-record key so re-posting the same line is always a no-op
// server-side instead of a duplicate ledger row.
export function buildIdempotencyKey(record) {
  const basis = JSON.stringify({
    ts: record.ts,
    reason: record.reason,
    base_url: record.base_url,
    agent_id: record.agent_id,
    context: record.context,
  });
  return 'backfill_' + createHash('sha256').update(basis).digest('hex');
}

/**
 * Build the POST /api/actions body for one orphan record.
 * @returns {{ payload: object } | { error: string }}
 */
export function buildActionPayload(record) {
  const context = record && record.context;
  const missing = missingRequiredField(context);
  if (missing) return { error: missing };

  const payload = {
    agent_id: context.agent_id,
    action_type: context.action_type,
    declared_goal: context.declared_goal,
    idempotency_key: buildIdempotencyKey(record),
    // No dedicated column for reason/policy/hook_mode — ride the free-text
    // field rather than ask for a schema change to backfill a handful of
    // words (repo rule: no new migrations this round).
    reasoning: `Backfilled from ~/.dashclaw/orphan-actions.jsonl — guard was ${record.reason || 'unavailable'} ` +
      `at ${record.base_url || 'unknown host'} (policy=${record.policy || 'unknown'}, hook_mode=${record.hook_mode || 'unknown'}).`,
  };
  if (record.ts) payload.timestamp_start = record.ts;
  if (typeof context.risk_score === 'number') payload.risk_score = context.risk_score;
  if (typeof context.reversible === 'boolean') payload.reversible = context.reversible;
  if (Array.isArray(context.systems_touched)) payload.systems_touched = context.systems_touched;
  if (context.act && typeof context.act === 'object') payload.act = context.act;

  return { payload };
}

/**
 * POST one action record. Unlike lib/api.js's apiRequest, this reads the
 * response body on EVERY status (not just ok ones) — a 403 guard block still
 * creates the ledger row (createBlockedActionRecord persists it,
 * app/api/actions/route.ts), so "landed in the ledger" and "the guard
 * allowed it" are different questions, and only the first one decides
 * whether this line gets removed from the orphan file.
 */
export async function postAction({ baseUrl, apiKey }, payload) {
  let res;
  try {
    res = await fetch(`${baseUrl}/api/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    return { landed: false, error: err.message };
  }
  let data = {};
  try { data = await res.json(); } catch { data = {}; }

  const actionId = data.action_id || (data.action && data.action.action_id);
  if (actionId) {
    return { landed: true, actionId, replay: !!data.idempotent_replay, status: res.status };
  }
  return { landed: false, error: data.error || `HTTP ${res.status}`, status: res.status };
}

/**
 * Read the orphan file, POST each record, rewrite the file to contain only
 * the lines that did not land this run. Safe to call with a missing file
 * (returns a zero summary, touches nothing).
 * @returns {Promise<{found:number, posted:number, replayed:number, skipped:number, failed:number, remaining:number}>}
 */
export async function runBackfill({ baseUrl, apiKey, filePath, logger = console }) {
  const path = filePath || defaultOrphanPath();
  const summary = { found: 0, posted: 0, replayed: 0, skipped: 0, failed: 0, remaining: 0 };

  if (!existsSync(path)) {
    logger.log('No orphan-actions.jsonl found — nothing to backfill.');
    return summary;
  }

  const raw = readFileSync(path, 'utf8');
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
  const keep = [];

  for (const line of lines) {
    summary.found += 1;
    let record;
    try {
      record = JSON.parse(line);
    } catch (err) {
      summary.skipped += 1;
      logger.error(`  skip: malformed JSON (${err.message})`);
      keep.push(line);
      continue;
    }

    const built = buildActionPayload(record);
    if (built.error) {
      summary.skipped += 1;
      logger.error(`  skip: ${built.error} (ts=${record.ts || 'unknown'})`);
      keep.push(line);
      continue;
    }

    const result = await postAction({ baseUrl, apiKey }, built.payload);
    if (result.landed) {
      summary.posted += 1;
      if (result.replay) summary.replayed += 1;
      logger.log(`  posted: ${result.actionId}${result.replay ? ' (already recorded)' : ''}`);
    } else {
      summary.failed += 1;
      logger.error(`  failed: ${result.error} (ts=${record.ts || 'unknown'})`);
      keep.push(line);
    }
  }

  summary.remaining = keep.length;
  if (keep.length === 0) {
    writeFileSync(path, '', 'utf8');
  } else {
    // Write-then-rename so a crash mid-write can't truncate the file and
    // silently lose records that never got posted.
    const tmpPath = `${path}.tmp`;
    writeFileSync(tmpPath, keep.join('\n') + '\n', 'utf8');
    renameSync(tmpPath, path);
  }

  return summary;
}
