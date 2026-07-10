// cli/test/up/setup-script.test.js
//
// Tests for runSetupScriptReal + scrubSetupLine in cli/lib/up/index.js.
// Uses the injectable `spawn`/`kill` parameters so no real script is executed.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import { runSetupScriptReal, scrubSetupLine } from '../../lib/up/index.js';

const silentLogger = { error() {}, log() {} };

// Builds an injectable async spawn whose fake child emits the given streams
// then closes with `status`. `hang: true` never closes (watchdog tests).
function fakeSpawn({ status = 0, stdout = '', stderr = '', hang = false } = {}) {
  const spawnFn = (_cmd, _args, opts) => {
    spawnFn.seenOpts = opts;
    const child = new EventEmitter();
    child.pid = 4242;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    queueMicrotask(() => {
      if (stdout) child.stdout.emit('data', stdout);
      if (stderr) child.stderr.emit('data', stderr);
      if (!hang) child.emit('close', status);
    });
    return child;
  };
  return spawnFn;
}

const runArgs = { appDir: '/app', databaseUrl: 'postgresql://x', logger: silentLogger };

describe('runSetupScriptReal — success', () => {
  test('resolves with parsed object from last JSON line, ignoring leading noise', async () => {
    const spawn = fakeSpawn({
      status: 0,
      stdout: 'noise\n{"ok":true,"apiKey":"oc_live_x","adminPassword":null}\n',
    });
    const result = await runSetupScriptReal({ ...runArgs, spawn });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.apiKey, 'oc_live_x');
    assert.strictEqual(result.adminPassword, null);
  });

  test("spawns the child with stdin 'ignore' (an open pipe hangs any stray prompt forever)", async () => {
    const spawn = fakeSpawn({ status: 0, stdout: '{"ok":true,"apiKey":"k","adminPassword":null}\n' });
    await runSetupScriptReal({ ...runArgs, spawn });
    assert.deepStrictEqual(spawn.seenOpts.stdio, ['ignore', 'pipe', 'pipe']);
  });
});

describe('runSetupScriptReal — streaming', () => {
  test('streams the child stderr lines to the logger as progress, scrubbed', async () => {
    const seen = [];
    const logger = { error: (l) => seen.push(l), log() {} };
    const spawn = fakeSpawn({
      status: 0,
      stdout: '{"ok":true,"apiKey":"k","adminPassword":null}\n',
      stderr: '  [1/6] Database connection\n    oc_live_deadbeef1234\n  Local admin password: hunter2hunter2 (printed ONCE)\n',
    });
    await runSetupScriptReal({ ...runArgs, logger, spawn });
    const joined = seen.join('\n');
    assert.match(joined, /\[1\/6\] Database connection/);
    assert.match(joined, /oc_live_\*\*\*/);
    assert.doesNotMatch(joined, /deadbeef/);
    assert.match(joined, /password: \*\*\*/);
    assert.doesNotMatch(joined, /hunter2/);
  });

  test('collapses \\r spinner frames to the visible part of the line', async () => {
    const seen = [];
    const logger = { error: (l) => seen.push(l), log() {} };
    const spawn = fakeSpawn({
      status: 0,
      stdout: '{"ok":true,"apiKey":"k","adminPassword":null}\n',
      stderr: '\r  - Running auto-migrate... (1s)\r  [ok] auto-migrate\n',
    });
    await runSetupScriptReal({ ...runArgs, logger, spawn });
    const joined = seen.join('\n');
    assert.match(joined, /\[ok\] auto-migrate/);
    assert.doesNotMatch(joined, /Running auto-migrate/);
  });
});

describe('runSetupScriptReal — watchdog', () => {
  test('kills a hung child and rejects naming the last activity', async () => {
    const killed = [];
    const spawn = fakeSpawn({ hang: true, stderr: '  [ok] step one\n\r  / Running auto-migrate... (599s)' });
    await assert.rejects(
      runSetupScriptReal({ ...runArgs, spawn, timeoutMs: 20, kill: (pid) => killed.push(pid) }),
      /did not finish within \d+ minutes.*Running auto-migrate/s,
    );
    assert.deepStrictEqual(killed, [4242]);
  });
});

describe('runSetupScriptReal — non-zero exit', () => {
  test('rejects with stderr detail when exit status is non-zero', async () => {
    const spawn = fakeSpawn({ status: 1, stdout: '', stderr: 'boom' });
    await assert.rejects(runSetupScriptReal({ ...runArgs, spawn }), /boom/);
  });
});

describe('runSetupScriptReal — ok:false', () => {
  test('rejects with the error field when ok is false', async () => {
    const spawn = fakeSpawn({
      status: 0,
      stdout: '{"ok":false,"error":"migrations exploded"}',
    });
    await assert.rejects(runSetupScriptReal({ ...runArgs, spawn }), /migrations exploded/);
  });
});

describe('runSetupScriptReal — unparseable JSON', () => {
  test('rejects with a clear message when stdout is not valid JSON', async () => {
    const spawn = fakeSpawn({ status: 0, stdout: 'not json' });
    await assert.rejects(runSetupScriptReal({ ...runArgs, spawn }), /not parseable JSON/);
  });
});

describe('scrubSetupLine', () => {
  test('masks API keys and password values but leaves other text alone', () => {
    assert.strictEqual(scrubSetupLine('key oc_live_abc123 done'), 'key oc_live_*** done');
    assert.strictEqual(scrubSetupLine('Local admin password: s3cretst3ak (printed ONCE)'), 'Local admin password: *** (printed ONCE)');
    assert.strictEqual(scrubSetupLine('[ok] Local admin password already set'), '[ok] Local admin password already set');
    assert.strictEqual(scrubSetupLine('  [1/6] Database connection'), '  [1/6] Database connection');
  });
});
