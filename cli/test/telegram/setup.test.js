// cli/test/telegram/setup.test.js
//
// Pure-helper coverage for the Telegram setup wizard, plus targeted
// regression coverage for step 8 (round-trip smoke test) and the local
// .env write, which live as closures inside runTelegramSetup and so are
// exercised by driving the wizard end to end with mocked fetch + prompts.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  redactSecret,
  buildTelegramEnvBlock,
  upsertEnvLines,
  runTelegramSetup,
} from '../../lib/telegram/setup.js';

const VALUES = {
  token: '71234:example_bot_token_value',
  chatId: '123456789',
  webhookSecret: 'a'.repeat(64),
  orgId: 'org_default',
};

test('redactSecret keeps head/tail and hides short values entirely', () => {
  assert.equal(redactSecret('abcdefghijkl', 4), 'abcd...ijkl');
  assert.equal(redactSecret('short', 4), '[hidden]');
  assert.equal(redactSecret('', 4), '[hidden]');
});

test('buildTelegramEnvBlock emits exactly the four env lines', () => {
  const block = buildTelegramEnvBlock(VALUES);
  assert.deepEqual(block.split('\n'), [
    `TELEGRAM_BOT_TOKEN=${VALUES.token}`,
    `TELEGRAM_ADMIN_CHAT_ID=${VALUES.chatId}`,
    `TELEGRAM_WEBHOOK_SECRET=${VALUES.webhookSecret}`,
    `TELEGRAM_APPROVER_ORG_ID=${VALUES.orgId}`,
  ]);
});

test('upsertEnvLines appends to an existing body without touching other keys', () => {
  const out = upsertEnvLines('DATABASE_URL=postgres://x\n', VALUES);
  assert.ok(out.startsWith('DATABASE_URL=postgres://x\n'));
  assert.ok(out.includes(`TELEGRAM_ADMIN_CHAT_ID=${VALUES.chatId}\n`));
});

test('upsertEnvLines replaces existing TELEGRAM_* lines in place', () => {
  const existing = 'TELEGRAM_BOT_TOKEN=oldvalue\nOTHER=1\n';
  const out = upsertEnvLines(existing, VALUES);
  assert.ok(!out.includes('oldvalue'));
  assert.equal(out.match(/^TELEGRAM_BOT_TOKEN=/gm).length, 1);
  assert.ok(out.includes('OTHER=1\n'));
});

// -- Wizard integration harness ---------------------------------------------
//
// Drives runTelegramSetup() through all 8 steps with a scripted prompt queue
// and a mocked global.fetch that answers by URL/method. Steps 1-7 always take
// the same "happy path" branch so every test only has to vary step 8's (or
// step 6's local-env) behavior.

function makeAnswerQueue(answers) {
  let i = 0;
  return async (q) => {
    if (i >= answers.length) throw new Error(`No scripted prompt answer left for: ${q}`);
    return answers[i++];
  };
}

function makeLogger() {
  const lines = [];
  const errLines = [];
  return { logger: { log: (s = '') => lines.push(String(s)), error: (s) => errLines.push(String(s)) }, lines, errLines };
}

// createAction: undefined = succeed, 'abort' = throw AbortError once (never retried by step 8)
// pollAction: undefined = succeed on first poll, 'abort-once' = throw AbortError on the first
//             poll, succeed on the second
function makeFetchMock({ createAction, pollAction } = {}) {
  const calls = [];
  let pollCalls = 0;
  const fetchMock = async (url, init = {}) => {
    calls.push({ url, init });
    if (url.includes('/getMe')) {
      return { ok: true, json: async () => ({ ok: true, result: { username: 'testbot', id: 1 } }) };
    }
    if (url.includes('/getWebhookInfo')) {
      return { ok: true, json: async () => ({ ok: true, result: {} }) };
    }
    if (url.includes('/getUpdates')) {
      return {
        ok: true,
        json: async () => ({
          ok: true,
          result: [{ message: { chat: { id: 111222333, type: 'private' }, from: { username: 'wes' } } }],
        }),
      };
    }
    if (url.includes('/setWebhook')) {
      return { ok: true, json: async () => ({ ok: true, result: true }) };
    }
    if (url.endsWith('/api/orgs')) {
      return { ok: true, json: async () => ({ organizations: [{ id: 'org_default', name: 'Test Org' }] }) };
    }
    if (url.endsWith('/api/actions') && init.method === 'POST') {
      if (createAction === 'abort') {
        throw new DOMException('The operation was aborted.', 'AbortError');
      }
      return { ok: true, json: async () => ({}) };
    }
    if (/\/api\/actions\/act_setup/.test(url) && (!init.method || init.method === 'GET')) {
      pollCalls += 1;
      if (pollAction === 'abort-once' && pollCalls === 1) {
        throw new DOMException('The operation was aborted.', 'AbortError');
      }
      return { ok: true, json: async () => ({ action: { status: 'approved' } }) };
    }
    if (init.method === 'DELETE') {
      return { ok: true };
    }
    throw new Error(`Unmocked fetch: ${init.method || 'GET'} ${url}`);
  };
  return { fetch: fetchMock, calls };
}

// Answers for steps 1-7 with localEnvPath left null (no "write to local .env?"
// prompt fires) plus step 8's "run the smoke test now?" prompt.
const HAPPY_PATH_ANSWERS = [
  'y', // Ready to start?
  'testtoken123456', // step1: paste bot token
  '', // step2: press Enter after messaging the bot
  'https://example-deploy.vercel.app', // step4: deploy URL
  'oc_live_testkey', // step5: paste API key
  '', // step6: press Enter after setting env vars
  'y', // step8: run the smoke test now?
];

test('step 8 treats an aborted action-creation fetch as a failed attempt, not a crash', async (t) => {
  const originalFetch = globalThis.fetch;
  const mock = makeFetchMock({ createAction: 'abort' });
  globalThis.fetch = mock.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const { logger, errLines } = makeLogger();
  const prompt = makeAnswerQueue(HAPPY_PATH_ANSWERS);

  const result = await runTelegramSetup({ prompt, promptSecret: prompt, logger });

  assert.equal(result.completed, true);
  assert.ok(
    errLines.some((l) => l.includes('Failed to create action')),
    'expected the abort to be reported as a failed create, not swallowed'
  );

  const createCall = mock.calls.find((c) => c.url.endsWith('/api/actions') && c.init.method === 'POST');
  assert.ok(createCall, 'expected the action-creation fetch to have been attempted');
  assert.ok(
    createCall.init.signal instanceof AbortSignal,
    'action-creation fetch must carry an AbortSignal timeout'
  );
});

test('step 8 treats an aborted poll fetch as a failed attempt and keeps polling until it succeeds', async (t) => {
  const originalFetch = globalThis.fetch;
  const mock = makeFetchMock({ pollAction: 'abort-once' });
  globalThis.fetch = mock.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const { logger, lines } = makeLogger();
  const prompt = makeAnswerQueue(HAPPY_PATH_ANSWERS);

  const result = await runTelegramSetup({ prompt, promptSecret: prompt, logger });

  assert.equal(result.completed, true);
  assert.ok(
    lines.some((l) => l.includes('Round-trip succeeded')),
    'expected the wizard to recover after the aborted poll and report success'
  );

  const pollCalls = mock.calls.filter((c) => /\/api\/actions\/act_setup/.test(c.url));
  assert.ok(pollCalls.length >= 2, 'expected a retry after the aborted poll attempt');
  assert.ok(
    pollCalls.every((c) => c.init.signal instanceof AbortSignal),
    'poll fetch must carry an AbortSignal timeout'
  );
});

test('local .env write creates a new file with 0600 permissions, not world-readable', async (t) => {
  if (process.platform === 'win32') {
    // POSIX permission bits aren't meaningful on Windows (NTFS has no
    // owner/group/other split) — Node's fs.mode is mostly ignored there,
    // as the fix's own scope note says. This assertion is verified on
    // Linux/macOS CI instead.
    t.skip('POSIX file mode is not meaningful on win32');
    return;
  }

  const originalFetch = globalThis.fetch;
  const mock = makeFetchMock({});
  globalThis.fetch = mock.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const dir = mkdtempSync(join(tmpdir(), 'dashclaw-telegram-'));
  const envPath = join(dir, '.env');

  const { logger } = makeLogger();
  const answers = [
    'y', // Ready to start?
    'testtoken123456', // step1
    '', // step2 pause
    'https://example-deploy.vercel.app', // step4
    'oc_live_testkey', // step5
    '', // step6 pause
    'y', // maybeWriteLocalEnv: write to local .env?
    'y', // step8: run the smoke test now?
  ];
  const prompt = makeAnswerQueue(answers);

  const result = await runTelegramSetup({ prompt, promptSecret: prompt, logger, localEnvPath: envPath });

  assert.equal(result.completed, true);
  const mode = statSync(envPath).mode & 0o777;
  assert.equal(mode, 0o600, `expected 0600, got ${mode.toString(8)}`);
});
