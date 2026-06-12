// cli/test/up/orchestrator.test.js
//
// Tests for cli/lib/up/index.js — the orchestrator that composes the up/
// primitives into the full `dashclaw up` pipeline, with resume + boot modes.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runUp, runDown } from '../../lib/up/index.js';
import { loadInstance, saveInstance, checkpoint, STEPS } from '../../lib/up/instance.js';

function tempBase() {
  return mkdtempSync(join(tmpdir(), 'dashclaw-orchestrator-test-'));
}

// Build a fully-injected deps object. Every effect is a stub; pass `overrides`
// to swap individual stubs per test. `calls` records invocation for assertions.
function makeDeps(overrides = {}) {
  const calls = {
    downloadAndExtract: 0,
    installDeps: 0,
    provisionDatabase: 0,
    runSetupScript: 0,
    buildApp: 0,
    startServer: 0,
    installClaude: 0,
    openBrowser: 0,
    stopDb: 0,
  };
  const deps = {
    resolveAppVersion: async () => '9.9.9',
    downloadAndExtract: async ({ baseDir }) => {
      calls.downloadAndExtract++;
      return join(baseDir, 'app', '9.9.9');
    },
    installDeps: () => { calls.installDeps++; },
    chooseDbMode: async () => 'embedded',
    provisionDatabase: async () => {
      calls.provisionDatabase++;
      return { databaseUrl: 'postgresql://x', stop: async () => { calls.stopDb++; } };
    },
    runSetupScript: async () => {
      calls.runSetupScript++;
      return { ok: true, apiKey: 'oc_live_test', adminPassword: 'pw' };
    },
    buildApp: () => { calls.buildApp++; },
    startServer: () => { calls.startServer++; return { pid: 4242, on: () => {} }; },
    waitForHealth: async () => {},
    installClaude: async () => { calls.installClaude++; },
    openBrowser: () => { calls.openBrowser++; },
    promptFn: async () => '',
    logger: { error() {}, log() {} },
    dockerAvailable: false,
    ...overrides,
  };
  return { deps, calls };
}

describe('runUp — full pipeline', () => {
  test('runs every step in order, checkpoints all six, connects, no browser', async () => {
    const baseDir = tempBase();
    const { deps, calls } = makeDeps();
    let installClaudeArg;
    deps.installClaude = async (arg) => { calls.installClaude++; installClaudeArg = arg; };

    await runUp({ args: { yes: true, db: 'embedded', noBrowser: true }, baseDir, deps });

    const inst = loadInstance(baseDir);
    assert.deepStrictEqual(inst.completed, STEPS);
    assert.strictEqual(installClaudeArg.endpoint, 'http://localhost:3000');
    assert.strictEqual(installClaudeArg.apiKey, 'oc_live_test');
    assert.strictEqual(calls.installClaude, 1);
    assert.strictEqual(calls.openBrowser, 0); // --no-browser
  });
});

describe('runUp — resume', () => {
  test('skips already-completed steps, runs the rest', async () => {
    const baseDir = tempBase();
    saveInstance(baseDir, {
      version: '9.9.9', port: 3000, dbMode: 'embedded',
      appDir: join(baseDir, 'app', '9.9.9'),
    });
    checkpoint(baseDir, 'app_fetched');
    checkpoint(baseDir, 'deps_installed');

    const { deps, calls } = makeDeps();
    await runUp({ args: { yes: true, db: 'embedded', noBrowser: true }, baseDir, deps });

    assert.strictEqual(calls.downloadAndExtract, 0);
    assert.strictEqual(calls.installDeps, 0);
    assert.strictEqual(calls.provisionDatabase, 1);
  });
});

describe('runUp — boot mode', () => {
  test('fully-completed instance only starts + opens', async () => {
    const baseDir = tempBase();
    saveInstance(baseDir, {
      version: '9.9.9', port: 3000, dbMode: 'embedded',
      appDir: join(baseDir, 'app', '9.9.9'), apiKey: 'oc_live_test',
      completed: [...STEPS],
    });

    const { deps, calls } = makeDeps();
    await runUp({ args: { yes: true, noBrowser: false }, baseDir, deps });

    assert.strictEqual(calls.downloadAndExtract, 0);
    assert.strictEqual(calls.runSetupScript, 0);
    assert.strictEqual(calls.startServer, 1);
    assert.strictEqual(calls.openBrowser, 1);
  });
});

describe('runUp — declining connect', () => {
  test('declining is a completed decision; installClaude not called', async () => {
    const baseDir = tempBase();
    const { deps, calls } = makeDeps({ promptFn: async () => 'n' });

    await runUp({ args: { yes: false, db: 'embedded', noBrowser: true }, baseDir, deps });

    assert.strictEqual(calls.installClaude, 0);
    const inst = loadInstance(baseDir);
    assert.ok(inst.completed.includes('connected'));
  });
});

describe('runUp — setup failure', () => {
  test('rejects on ok:false and does not checkpoint setup_done', async () => {
    const baseDir = tempBase();
    const { deps } = makeDeps({
      runSetupScript: async () => ({ ok: false, error: 'migrations exploded' }),
    });

    await assert.rejects(
      () => runUp({ args: { yes: true, db: 'embedded', noBrowser: true }, baseDir, deps }),
      /migrations exploded/,
    );
    const inst = loadInstance(baseDir);
    assert.ok(!inst.completed.includes('setup_done'));
  });
});

describe('runUp — --update flag', () => {
  test('re-runs the full pipeline even when all six steps are already completed', async () => {
    const baseDir = tempBase();
    saveInstance(baseDir, {
      version: '9.9.9', port: 3000, dbMode: 'embedded',
      appDir: join(baseDir, 'app', '9.9.9'), apiKey: 'oc_live_old',
      completed: [...STEPS],
    });

    const { deps, calls } = makeDeps();
    await runUp({ args: { update: true, yes: true, db: 'embedded', noBrowser: true }, baseDir, deps });

    assert.strictEqual(calls.downloadAndExtract, 1);
    assert.strictEqual(calls.runSetupScript, 1);
  });
});

describe('runDown', () => {
  test('no instance → logs and does nothing', async () => {
    const baseDir = tempBase();
    const killCalls = [];
    const logger = { log(m) {}, error() {} };
    const kill = (pid) => { killCalls.push(pid); };
    await runDown({ baseDir, logger, kill });
    assert.strictEqual(killCalls.length, 0);
  });

  test('instance with pid → kill called, pid cleared in instance', async () => {
    const baseDir = tempBase();
    saveInstance(baseDir, { pid: 9999, dbMode: 'embedded' });
    const killCalls = [];
    const logger = { log() {}, error() {} };
    const kill = (pid) => { killCalls.push(pid); };
    await runDown({ baseDir, logger, kill });
    assert.deepStrictEqual(killCalls, [9999]);
    const inst = loadInstance(baseDir);
    assert.strictEqual(inst.pid, null);
  });

  test('dbMode docker → dockerStop called', async () => {
    const baseDir = tempBase();
    saveInstance(baseDir, { pid: null, dbMode: 'docker' });
    const dockerCalls = [];
    const logger = { log() {}, error() {} };
    const dockerStop = (container) => { dockerCalls.push(container); };
    await runDown({ baseDir, logger, kill: () => {}, dockerStop });
    assert.deepStrictEqual(dockerCalls, ['dashclaw-pg']);
  });
});
