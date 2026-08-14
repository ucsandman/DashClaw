// cli/test/telegram/setup.test.js
//
// Pure-helper coverage for the Telegram setup wizard. The interactive flow
// itself (BotFather token, chat-id discovery) needs a human + live Telegram
// and is exercised by the wizard's own step 8 round-trip smoke test.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redactSecret, buildTelegramEnvBlock, upsertEnvLines } from '../../lib/telegram/setup.js';

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
