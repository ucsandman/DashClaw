// cli/test/code/ingest-codex.test.js
//
// Tests for the Codex JSONL ingest CLI path. Uses the same sample-rollout
// fixture as the parser unit tests. Verifies local-write mode, dry-run,
// stub-server POST mode, and graceful handling of missing dirs.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  runCodexIngest,
  defaultCodexSessionsDir,
  defaultCodexOutDir,
} from '../../lib/code/ingest-codex.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_FILE = path.resolve(__dirname, '..', 'fixtures', 'codex-sessions', 'sample-rollout.jsonl');

const silentLogger = { info() {}, warn() {} };

function makeTempDir(prefix) { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }

function seedSessionsDir(includeFixture = true) {
  const dir = makeTempDir('codex-sess-');
  if (includeFixture) {
    fs.copyFileSync(FIXTURE_FILE, path.join(dir, 'rollout-2026-05-13T16-00-00-01997d4f.jsonl'));
  }
  return dir;
}

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

describe('defaultCodexSessionsDir', () => {
  it('honors CODEX_SESSIONS_DIR directly', () => {
    assert.equal(defaultCodexSessionsDir({ CODEX_SESSIONS_DIR: '/x/y' }), '/x/y');
  });
  it('falls back to CODEX_HOME/sessions', () => {
    const out = defaultCodexSessionsDir({ CODEX_HOME: '/custom/codex', HOME: '/home/u' });
    assert.match(out, /custom[\/\\]codex[\/\\]sessions$/);
  });
  it('falls back to ~/.codex/sessions when no env hints', () => {
    const out = defaultCodexSessionsDir({});
    assert.match(out, /\.codex[\/\\]sessions$/);
  });
});

describe('runCodexIngest: dry-run', () => {
  it('returns parsed metadata without writing or posting', async () => {
    const sessionsDir = seedSessionsDir();
    const outDir = makeTempDir('codex-out-');
    const results = await runCodexIngest({
      sessionsDir, outDir, dryRun: true, logger: silentLogger,
    });
    assert.equal(results.length, 1);
    assert.equal(results[0].status, 'dry_run');
    assert.equal(results[0].session_uuid, '01997d4f-7be5-7df4-bb78-eef99e7e0e9d');
    assert.equal(results[0].turns, 2);
    assert.equal(results[0].tokens.input_tokens, 2900);
    // out dir should remain empty in dry-run mode.
    assert.equal(fs.readdirSync(outDir).length, 0);
  });
});

describe('runCodexIngest: local write mode', () => {
  it('writes parsed sessions to outDir', async () => {
    const sessionsDir = seedSessionsDir();
    const outDir = makeTempDir('codex-out-');
    const results = await runCodexIngest({
      sessionsDir, outDir, logger: silentLogger,
    });
    assert.equal(results.length, 1);
    assert.equal(results[0].status, 'written_local');
    const written = JSON.parse(fs.readFileSync(results[0].out, 'utf8'));
    assert.equal(written.session_uuid, '01997d4f-7be5-7df4-bb78-eef99e7e0e9d');
    assert.equal(written.agent_kind, 'codex');
    assert.equal(written.turn_count, 2);
    assert.equal(written.totals.input_tokens, 2900);
    assert.equal(written.source.host, 'codex-jsonl');
  });

  it('skips empty .jsonl files', async () => {
    const sessionsDir = seedSessionsDir(false);
    fs.writeFileSync(path.join(sessionsDir, 'rollout-empty.jsonl'), '');
    const outDir = makeTempDir('codex-out-');
    const results = await runCodexIngest({
      sessionsDir, outDir, logger: silentLogger,
    });
    assert.equal(results.length, 1);
    assert.equal(results[0].status, 'skipped');
    assert.equal(results[0].reason, 'empty');
  });

  it('returns empty array when sessionsDir is missing', async () => {
    const results = await runCodexIngest({
      sessionsDir: '/nonexistent/path/xyz', logger: silentLogger,
    });
    assert.deepEqual(results, []);
  });

  it('recurses one level into subdirectories', async () => {
    const sessionsDir = seedSessionsDir(false);
    const archived = path.join(sessionsDir, 'archived');
    fs.mkdirSync(archived);
    fs.copyFileSync(FIXTURE_FILE, path.join(archived, 'rollout-old.jsonl'));
    const outDir = makeTempDir('codex-out-');
    const results = await runCodexIngest({
      sessionsDir, outDir, logger: silentLogger,
    });
    assert.equal(results.length, 1);
    assert.equal(results[0].status, 'written_local');
  });
});

describe('runCodexIngest: endpoint POST mode', () => {
  it('POSTs the parsed session to the configured endpoint', async () => {
    let received = null;
    const { server, baseUrl } = await startStubServer((req) => {
      received = req;
      return { status: 200, body: { ok: true } };
    });
    try {
      const sessionsDir = seedSessionsDir();
      const results = await runCodexIngest({
        sessionsDir,
        endpoint: `${baseUrl}/api/code-sessions/ingest-codex`,
        apiKey: 'secret',
        logger: silentLogger,
      });
      assert.equal(results.length, 1);
      assert.equal(results[0].status, 'ingested');
      assert.equal(received.headers['x-api-key'], 'secret');
      assert.equal(received.body.agent_kind, 'codex');
      assert.equal(received.body.source.host, 'codex-jsonl');
    } finally {
      server.close();
    }
  });

  it('records HTTP errors without throwing', async () => {
    const { server, baseUrl } = await startStubServer(() => ({
      status: 500, body: { error: 'oops' },
    }));
    try {
      const sessionsDir = seedSessionsDir();
      const results = await runCodexIngest({
        sessionsDir,
        endpoint: `${baseUrl}/api/code-sessions/ingest-codex`,
        apiKey: 'k',
        logger: silentLogger,
      });
      assert.equal(results[0].status, 'error');
      assert.equal(results[0].reason, 'http_500');
    } finally {
      server.close();
    }
  });
});
