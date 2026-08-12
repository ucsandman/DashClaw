// cli/test/backfill.test.js
//
// Tests for cli/lib/backfill.js — the reader for hooks/dashclaw_pretool.py's
// ~/.dashclaw/orphan-actions.jsonl. Before this file existed, the hook wrote
// that file on every guard-unavailable event and told the operator (four
// separate log lines) it was "logged for backfill on guard recovery", but
// nothing ever read it — this pins that the reader exists, posts through
// POST /api/actions, is idempotent on retry, and only drops lines it
// confirmed landed.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  buildIdempotencyKey,
  buildActionPayload,
  postAction,
  runBackfill,
} from '../lib/backfill.js';

const CONFIG = { baseUrl: 'https://api.example.com', apiKey: 'secret-key' };

function withFetchStub(stub, fn) {
  const original = global.fetch;
  global.fetch = stub;
  return Promise.resolve().then(fn).finally(() => { global.fetch = original; });
}

function jsonResponse(body, { status = 200 } = {}) {
  return { status, json: async () => body };
}

function orphanRecord(overrides = {}) {
  return {
    ts: '2026-08-11T12:00:00.000Z',
    reason: 'guard_unreachable',
    base_url: 'http://localhost:3000',
    agent_id: 'claude-code',
    hook_mode: 'enforce',
    policy: 'block',
    context: {
      action_type: 'file_io',
      agent_id: 'claude-code',
      declared_goal: 'write config.json',
      risk_score: 10,
      reversible: true,
      systems_touched: ['filesystem'],
    },
    ...overrides,
  };
}

function tempOrphanFile(lines) {
  const dir = mkdtempSync(join(tmpdir(), 'dashclaw-backfill-'));
  const path = join(dir, 'orphan-actions.jsonl');
  writeFileSync(path, lines.join('\n') + (lines.length ? '\n' : ''), 'utf8');
  return path;
}

describe('buildIdempotencyKey', () => {
  test('is deterministic for the same record and differs across records', () => {
    const a = orphanRecord();
    const b = orphanRecord();
    const c = orphanRecord({ ts: '2026-08-11T12:01:00.000Z' });
    assert.equal(buildIdempotencyKey(a), buildIdempotencyKey(b));
    assert.notEqual(buildIdempotencyKey(a), buildIdempotencyKey(c));
    // Server schema caps idempotency_key at 256 chars (app/lib/validate.js).
    assert.ok(buildIdempotencyKey(a).length <= 256);
  });
});

describe('buildActionPayload', () => {
  test('maps the hook context onto the POST /api/actions body', () => {
    const { payload, error } = buildActionPayload(orphanRecord());
    assert.equal(error, undefined);
    assert.equal(payload.agent_id, 'claude-code');
    assert.equal(payload.action_type, 'file_io');
    assert.equal(payload.declared_goal, 'write config.json');
    assert.equal(payload.risk_score, 10);
    assert.equal(payload.reversible, true);
    assert.deepEqual(payload.systems_touched, ['filesystem']);
    assert.equal(payload.timestamp_start, '2026-08-11T12:00:00.000Z');
    assert.match(payload.reasoning, /guard was guard_unreachable/);
    assert.ok(payload.idempotency_key.startsWith('backfill_'));
  });

  test('reports missing required fields instead of guessing a value', () => {
    const record = orphanRecord({ context: { agent_id: 'claude-code' } }); // no action_type/declared_goal
    const { payload, error } = buildActionPayload(record);
    assert.equal(payload, undefined);
    assert.match(error, /action_type/);
  });

  test('reports a missing context entirely', () => {
    const { error } = buildActionPayload({ ts: 'x' });
    assert.match(error, /context is missing/);
  });
});

describe('postAction', () => {
  test('landed:true on a normal create (top-level action_id)', async () => {
    const result = await withFetchStub(
      async () => jsonResponse({ action_id: 'act_123', action: { action_id: 'act_123' } }, { status: 201 }),
      () => postAction(CONFIG, { agent_id: 'a', action_type: 'x', declared_goal: 'g' }),
    );
    assert.equal(result.landed, true);
    assert.equal(result.actionId, 'act_123');
    assert.equal(result.replay, false);
  });

  test('landed:true on an idempotent replay', async () => {
    const result = await withFetchStub(
      async () => jsonResponse({ action_id: 'act_123', idempotent_replay: true }),
      () => postAction(CONFIG, {}),
    );
    assert.equal(result.landed, true);
    assert.equal(result.replay, true);
  });

  // SECURITY/audit fix under test: a guard block (403) still writes the
  // ledger row via createBlockedActionRecord — only the nested action.action_id
  // is present, no top-level action_id (app/api/actions/route.ts). This is the
  // case apiRequest (lib/api.js) would treat as a thrown failure and lose.
  test('landed:true on a 403 guard block, because the blocked row still exists', async () => {
    const result = await withFetchStub(
      async () => jsonResponse(
        { error: 'Action blocked by policy', action: { action_id: 'act_blocked_1' }, decision: { decision: 'block' } },
        { status: 403 },
      ),
      () => postAction(CONFIG, {}),
    );
    assert.equal(result.landed, true);
    assert.equal(result.actionId, 'act_blocked_1');
  });

  test('landed:false when no action was ever created (e.g. rate limited)', async () => {
    const result = await withFetchStub(
      async () => jsonResponse({ error: 'Organization rate limit exceeded' }, { status: 429 }),
      () => postAction(CONFIG, {}),
    );
    assert.equal(result.landed, false);
    assert.match(result.error, /rate limit/);
  });

  test('landed:false on a transport failure', async () => {
    const result = await withFetchStub(
      async () => { throw new Error('ECONNREFUSED'); },
      () => postAction(CONFIG, {}),
    );
    assert.equal(result.landed, false);
    assert.match(result.error, /ECONNREFUSED/);
  });
});

describe('runBackfill', () => {
  const quietLogger = { log: () => {}, error: () => {} };

  test('a missing file is a no-op, not an error', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'dashclaw-backfill-')), 'does-not-exist.jsonl');
    const summary = await runBackfill({ ...CONFIG, filePath: path, logger: quietLogger });
    assert.deepEqual(summary, { found: 0, posted: 0, replayed: 0, skipped: 0, failed: 0, remaining: 0 });
    assert.equal(existsSync(path), false);
  });

  test('posts landed records and clears the file when everything lands', async () => {
    const path = tempOrphanFile([JSON.stringify(orphanRecord())]);
    const summary = await withFetchStub(
      async () => jsonResponse({ action_id: 'act_1' }, { status: 201 }),
      () => runBackfill({ ...CONFIG, filePath: path, logger: quietLogger }),
    );
    assert.equal(summary.found, 1);
    assert.equal(summary.posted, 1);
    assert.equal(summary.remaining, 0);
    assert.equal(readFileSync(path, 'utf8'), '');
  });

  test('mixed batch: only unlanded lines survive the rewrite', async () => {
    const ok = orphanRecord({ ts: '2026-08-11T12:00:00.000Z' });
    const missingField = orphanRecord({ ts: '2026-08-11T12:01:00.000Z', context: { agent_id: 'a' } });
    const networkFail = orphanRecord({ ts: '2026-08-11T12:02:00.000Z' });
    const malformedLine = '{not json';

    const path = tempOrphanFile([
      JSON.stringify(ok),
      JSON.stringify(missingField),
      malformedLine,
      JSON.stringify(networkFail),
    ]);

    let call = 0;
    const summary = await withFetchStub(
      async () => {
        call += 1;
        // First fetch call is `ok`'s POST; second is `networkFail`'s POST
        // (missingField and the malformed line never reach fetch at all).
        if (call === 1) return jsonResponse({ action_id: 'act_ok' }, { status: 201 });
        throw new Error('ETIMEDOUT');
      },
      () => runBackfill({ ...CONFIG, filePath: path, logger: quietLogger }),
    );

    assert.equal(summary.found, 4);
    assert.equal(summary.posted, 1);
    assert.equal(summary.skipped, 2); // missingField + malformedLine
    assert.equal(summary.failed, 1); // networkFail
    assert.equal(summary.remaining, 3);
    assert.equal(call, 2); // only the two structurally-valid records hit the network

    const remainingLines = readFileSync(path, 'utf8').trim().split('\n');
    assert.equal(remainingLines.length, 3);
    assert.ok(!remainingLines.some((l) => l.includes('act_ok') || l === JSON.stringify(ok)));
    assert.ok(remainingLines.includes(malformedLine));
  });

  test('idempotent replay on re-run: a second pass over the same file never double-posts', async () => {
    const record = orphanRecord();
    const path = tempOrphanFile([JSON.stringify(record)]);

    let seenKeys = [];
    const fetchStub = async (_url, init) => {
      const body = JSON.parse(init.body);
      seenKeys.push(body.idempotency_key);
      // Simulate the server: first call creates, second call (same key)
      // returns the idempotent-replay short-circuit.
      const alreadySeen = seenKeys.filter((k) => k === body.idempotency_key).length > 1;
      return jsonResponse(
        alreadySeen ? { action_id: 'act_1', idempotent_replay: true } : { action_id: 'act_1' },
        { status: alreadySeen ? 200 : 201 },
      );
    };

    const first = await withFetchStub(fetchStub, () => runBackfill({ ...CONFIG, filePath: path, logger: quietLogger }));
    assert.equal(first.posted, 1);
    assert.equal(first.remaining, 0);

    // Re-seed the file (as if the operator re-ran the hook or restored a
    // backup) and run again — the key is identical, so this must resolve as
    // a replay, not a second row.
    writeFileSync(path, JSON.stringify(record) + '\n', 'utf8');
    const second = await withFetchStub(fetchStub, () => runBackfill({ ...CONFIG, filePath: path, logger: quietLogger }));
    assert.equal(second.posted, 1);
    assert.equal(second.replayed, 1);
    assert.equal(seenKeys[0], seenKeys[1]);
  });
});
