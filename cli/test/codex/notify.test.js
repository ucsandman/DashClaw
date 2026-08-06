// cli/test/codex/notify.test.js
//
// Tests for `dashclaw codex notify` — the Codex legacy notify CLI target.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import {
  parseNotifyPayload,
  buildActionFromNotify,
  postNotifyAction,
  runCodexNotify,
} from '../../lib/codex/notify.js';

const SAMPLE_PAYLOAD = {
  type: 'agent-turn-complete',
  thread_id: 'thr_abc',
  turn_id: 'turn_xyz',
  cwd: '/home/u/project',
  client: 'codex',
  input_messages: ['fix the build'],
  last_assistant_message: 'I fixed the build by updating tsconfig.',
};

const silentLogger = { info() {}, warn() {} };

function startStubServer(handler) {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let parsed = null;
      try { parsed = JSON.parse(body); } catch { /* keep null */ }
      const reply = handler({ method: req.method, url: req.url, headers: req.headers, body: parsed });
      res.writeHead(reply.status || 200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(reply.body || {}));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

describe('parseNotifyPayload', () => {
  it('returns null when argv is empty', () => {
    assert.equal(parseNotifyPayload([]), null);
  });
  it('returns null when last arg is not JSON-shaped', () => {
    assert.equal(parseNotifyPayload(['codex', 'notify', 'not-json']), null);
  });
  it('parses a valid trailing JSON arg', () => {
    const out = parseNotifyPayload(['codex', 'notify', JSON.stringify(SAMPLE_PAYLOAD)]);
    assert.equal(out.type, 'agent-turn-complete');
    assert.equal(out.thread_id, 'thr_abc');
  });
  it('returns null on malformed JSON', () => {
    assert.equal(parseNotifyPayload(['codex', 'notify', '{not valid']), null);
  });
});

describe('buildActionFromNotify', () => {
  it('builds an agent_turn action with codex agent id', () => {
    const a = buildActionFromNotify(SAMPLE_PAYLOAD);
    assert.equal(a.agent_id, 'codex');
    assert.equal(a.action_type, 'agent_turn');
    assert.match(a.declared_goal, /turn_xyz/);
    assert.match(a.declared_goal, /thr_abc/);
    assert.equal(a.outcome, 'success');
  });
  it('embeds turn metadata for later correlation', () => {
    const a = buildActionFromNotify(SAMPLE_PAYLOAD);
    assert.equal(a.metadata.thread_id, 'thr_abc');
    assert.equal(a.metadata.turn_id, 'turn_xyz');
    assert.equal(a.metadata.source, 'codex-notify');
    assert.equal(a.metadata.cwd, '/home/u/project');
    assert.equal(a.metadata.input_message_count, 1);
  });
  it('truncates long assistant messages in the summary', () => {
    const long = 'x'.repeat(500);
    const a = buildActionFromNotify({ ...SAMPLE_PAYLOAD, last_assistant_message: long });
    assert.equal(a.metadata.last_assistant_summary.length, 200);
    assert.ok(a.metadata.last_assistant_summary.endsWith('...'));
  });
  it('respects a custom agent id', () => {
    const a = buildActionFromNotify(SAMPLE_PAYLOAD, { agentId: 'codex-prod' });
    assert.equal(a.agent_id, 'codex-prod');
  });

  // The codex 0.13x line (still vendored inside OpenClaw's codex agent
  // runtime) emits kebab-case notify keys. Verified against a live
  // codex-cli 0.132.0 payload, 2026-08-06.
  it('accepts kebab-case payload keys from the codex 0.13x line', () => {
    const a = buildActionFromNotify({
      type: 'agent-turn-complete',
      'thread-id': 'thr_kebab',
      'turn-id': 'turn_kebab',
      cwd: 'C:\\ws',
      client: 'codex_app_server',
      'input-messages': ['run the thing'],
      'last-assistant-message': 'done.',
    });
    assert.match(a.declared_goal, /turn_kebab/);
    assert.match(a.declared_goal, /thr_kebab/);
    assert.equal(a.metadata.thread_id, 'thr_kebab');
    assert.equal(a.metadata.turn_id, 'turn_kebab');
    assert.equal(a.metadata.input_message_count, 1);
    assert.equal(a.metadata.last_assistant_summary, 'done.');
    assert.equal(a.metadata.client, 'codex_app_server');
  });

  it('prefers snake_case when both spellings are present', () => {
    const a = buildActionFromNotify({
      ...SAMPLE_PAYLOAD,
      'turn-id': 'turn_should_lose',
    });
    assert.equal(a.metadata.turn_id, 'turn_xyz');
  });
});

describe('postNotifyAction', () => {
  it('returns skipped when baseUrl or apiKey is missing', async () => {
    const r = await postNotifyAction({ baseUrl: '', apiKey: 'k', action: {} });
    assert.equal(r.status, 'skipped');
    assert.equal(r.reason, 'missing_config');
  });

  it('POSTs the action and returns the action id on 200', async () => {
    let received = null;
    const { server, baseUrl } = await startStubServer((req) => {
      received = req;
      return { status: 200, body: { action_id: 'act_test_001' } };
    });
    try {
      const result = await postNotifyAction({
        baseUrl,
        apiKey: 'secret',
        action: buildActionFromNotify(SAMPLE_PAYLOAD),
      });
      assert.equal(result.status, 'sent');
      assert.equal(result.actionId, 'act_test_001');
      assert.equal(received.method, 'POST');
      assert.equal(received.url, '/api/actions');
      assert.equal(received.headers['x-api-key'], 'secret');
      assert.equal(received.body.agent_id, 'codex');
      assert.equal(received.body.action_type, 'agent_turn');
    } finally {
      server.close();
    }
  });

  it('surfaces non-2xx as an error result without throwing', async () => {
    const { server, baseUrl } = await startStubServer(() => ({
      status: 401,
      body: { error: 'bad key' },
    }));
    try {
      const result = await postNotifyAction({
        baseUrl,
        apiKey: 'wrong',
        action: { agent_id: 'codex' },
      });
      assert.equal(result.status, 'error');
      assert.equal(result.reason, 'http_401');
    } finally {
      server.close();
    }
  });

  it('returns a network error when host is unreachable', async () => {
    const result = await postNotifyAction({
      baseUrl: 'http://127.0.0.1:1', // port 1 reserved → ECONNREFUSED
      apiKey: 'x',
      action: { agent_id: 'codex' },
      timeoutMs: 1000,
    });
    assert.equal(result.status, 'error');
    assert.ok(['network', 'timeout'].includes(result.reason), `unexpected reason: ${result.reason}`);
  });
});

describe('runCodexNotify (orchestration)', () => {
  it('exits-soft with no_payload when argv has no JSON', async () => {
    const r = await runCodexNotify({
      argv: ['codex', 'notify'],
      baseUrl: 'http://x',
      apiKey: 'k',
      logger: silentLogger,
    });
    assert.equal(r.status, 'skipped');
    assert.equal(r.reason, 'no_payload');
  });

  it('exits-soft with unknown_type for a non-turn-complete event', async () => {
    const r = await runCodexNotify({
      argv: ['codex', 'notify', JSON.stringify({ type: 'some-other-event' })],
      baseUrl: 'http://x',
      apiKey: 'k',
      logger: silentLogger,
    });
    assert.equal(r.status, 'skipped');
    assert.equal(r.reason, 'unknown_type');
  });

  it('returns dry_run with the built action when skipPost=true', async () => {
    const r = await runCodexNotify({
      argv: ['codex', 'notify', JSON.stringify(SAMPLE_PAYLOAD)],
      baseUrl: 'http://x',
      apiKey: 'k',
      skipPost: true,
      logger: silentLogger,
    });
    assert.equal(r.status, 'dry_run');
    assert.equal(r.action.action_type, 'agent_turn');
    assert.equal(r.action.metadata.thread_id, 'thr_abc');
  });

  it('end-to-end posts to a stub server', async () => {
    let received = null;
    const { server, baseUrl } = await startStubServer((req) => {
      received = req;
      return { status: 200, body: { action_id: 'act_42' } };
    });
    try {
      const r = await runCodexNotify({
        argv: ['codex', 'notify', JSON.stringify(SAMPLE_PAYLOAD)],
        baseUrl,
        apiKey: 'secret',
        logger: silentLogger,
      });
      assert.equal(r.status, 'sent');
      assert.equal(r.actionId, 'act_42');
      assert.equal(received.body.agent_id, 'codex');
      assert.equal(received.body.metadata.turn_id, 'turn_xyz');
    } finally {
      server.close();
    }
  });
});
