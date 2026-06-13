// cli/test/up/setup-script.test.js
//
// Tests for runSetupScriptReal in cli/lib/up/index.js.
// Uses the injectable `spawn` parameter so no real script is executed.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { runSetupScriptReal } from '../../lib/up/index.js';

const silentLogger = { error() {}, log() {} };

// Builds a fake spawnSync return value.
function fakeSpawn({ status = 0, stdout = '', stderr = '' } = {}) {
  return (_cmd, _args, _opts) => ({ status, stdout, stderr });
}

describe('runSetupScriptReal — success', () => {
  test('returns parsed object from last JSON line, ignoring leading noise', () => {
    const spawn = fakeSpawn({
      status: 0,
      stdout: 'noise\n{"ok":true,"apiKey":"oc_live_x","adminPassword":null}\n',
    });
    const result = runSetupScriptReal({ appDir: '/app', databaseUrl: 'postgresql://x', logger: silentLogger, spawn });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.apiKey, 'oc_live_x');
    assert.strictEqual(result.adminPassword, null);
  });

  test("spawns the child with stdin 'ignore' (an open pipe hangs any stray prompt forever)", () => {
    let seenOpts = null;
    const spawn = (_cmd, _args, opts) => {
      seenOpts = opts;
      return { status: 0, stdout: '{"ok":true,"apiKey":"k","adminPassword":null}\n', stderr: '' };
    };
    runSetupScriptReal({ appDir: '/app', databaseUrl: 'postgresql://x', logger: silentLogger, spawn });
    assert.deepStrictEqual(seenOpts.stdio, ['ignore', 'pipe', 'pipe']);
  });
});

describe('runSetupScriptReal — non-zero exit', () => {
  test('throws with stderr detail when exit status is non-zero', () => {
    const spawn = fakeSpawn({ status: 1, stdout: '', stderr: 'boom' });
    assert.throws(
      () => runSetupScriptReal({ appDir: '/app', databaseUrl: 'postgresql://x', logger: silentLogger, spawn }),
      /boom/,
    );
  });
});

describe('runSetupScriptReal — ok:false', () => {
  test('throws with the error field when ok is false', () => {
    const spawn = fakeSpawn({
      status: 0,
      stdout: '{"ok":false,"error":"migrations exploded"}',
    });
    assert.throws(
      () => runSetupScriptReal({ appDir: '/app', databaseUrl: 'postgresql://x', logger: silentLogger, spawn }),
      /migrations exploded/,
    );
  });
});

describe('runSetupScriptReal — unparseable JSON', () => {
  test('throws a clear message when stdout is not valid JSON', () => {
    const spawn = fakeSpawn({ status: 0, stdout: 'not json' });
    assert.throws(
      () => runSetupScriptReal({ appDir: '/app', databaseUrl: 'postgresql://x', logger: silentLogger, spawn }),
      /not parseable JSON/,
    );
  });
});
