// cli/test/up/orchestrator.test.js
//
// Tests for cli/lib/up/index.js — the orchestrator that composes the up/
// primitives into the full `dashclaw up` pipeline, with resume + boot modes.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runUp, runDown, mintLoginToken } from '../../lib/up/index.js';
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
    mintLoginToken: () => null,
    openBrowser: () => { calls.openBrowser++; },
    promptFn: async () => '',
    logger: { error() {}, log() {} },
    dockerAvailable: false,
    processAlive: () => false,
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

describe('runUp — bug#3: url-mode skips provisionDatabase on resume', () => {
  test('does not call provisionDatabase when db_ready is done + databaseUrl saved', async () => {
    const baseDir = tempBase();
    const savedUrl = 'postgresql://user:pass@host:5432/db';
    saveInstance(baseDir, {
      version: '9.9.9', port: 3000, dbMode: 'url',
      appDir: join(baseDir, 'app', '9.9.9'), apiKey: 'oc_live_test',
      databaseUrl: savedUrl,
      completed: [...STEPS],
    });

    const { deps, calls } = makeDeps({ chooseDbMode: async () => 'url' });
    await runUp({ args: { yes: true, noBrowser: true }, baseDir, deps });

    assert.strictEqual(calls.provisionDatabase, 0, 'provisionDatabase must not be called for url-mode resume');
  });

  test('still calls provisionDatabase for url-mode on first run (db_ready not checkpointed)', async () => {
    const baseDir = tempBase();
    saveInstance(baseDir, {
      version: '9.9.9', port: 3000, dbMode: 'url',
      appDir: join(baseDir, 'app', '9.9.9'),
    });
    checkpoint(baseDir, 'app_fetched');
    checkpoint(baseDir, 'deps_installed');

    const { deps, calls } = makeDeps({ chooseDbMode: async () => 'url' });
    await runUp({ args: { yes: true, noBrowser: true }, baseDir, deps });

    assert.strictEqual(calls.provisionDatabase, 1, 'provisionDatabase must be called on first url-mode run');
  });
});

describe('runUp — bug#9: live pid skips duplicate startServer', () => {
  test('does not call startServer when recorded pid is alive and health ok', async () => {
    const baseDir = tempBase();
    saveInstance(baseDir, {
      version: '9.9.9', port: 3000, dbMode: 'embedded',
      appDir: join(baseDir, 'app', '9.9.9'), apiKey: 'oc_live_test',
      pid: 4242,
      completed: [...STEPS],
    });

    const { deps, calls } = makeDeps({
      processAlive: (pid) => pid === 4242,
    });

    const result = await runUp({ args: { yes: true, noBrowser: true }, baseDir, deps });

    assert.strictEqual(calls.startServer, 0, 'startServer must not be called when pid is alive');
    assert.strictEqual(result.reusedServer, true, 'reusedServer must be true');
  });

  test('calls startServer when recorded pid is dead', async () => {
    const baseDir = tempBase();
    saveInstance(baseDir, {
      version: '9.9.9', port: 3000, dbMode: 'embedded',
      appDir: join(baseDir, 'app', '9.9.9'), apiKey: 'oc_live_test',
      pid: 9001,
      completed: [...STEPS],
    });

    const { deps, calls } = makeDeps({
      processAlive: () => false,
    });

    const result = await runUp({ args: { yes: true, noBrowser: true }, baseDir, deps });

    assert.strictEqual(calls.startServer, 1, 'startServer must be called when pid is dead');
    assert.strictEqual(result.reusedServer, false, 'reusedServer must be false');
  });

  test('calls startServer when no pid is recorded', async () => {
    const baseDir = tempBase();
    saveInstance(baseDir, {
      version: '9.9.9', port: 3000, dbMode: 'embedded',
      appDir: join(baseDir, 'app', '9.9.9'), apiKey: 'oc_live_test',
      completed: [...STEPS],
    });

    const { deps, calls } = makeDeps({ processAlive: () => true });

    const result = await runUp({ args: { yes: true, noBrowser: true }, baseDir, deps });

    assert.strictEqual(calls.startServer, 1, 'startServer must be called when no pid recorded');
    assert.strictEqual(result.reusedServer, false);
  });

  test('falls through to startServer when pid alive but health check fails', async () => {
    const baseDir = tempBase();
    saveInstance(baseDir, {
      version: '9.9.9', port: 3000, dbMode: 'embedded',
      appDir: join(baseDir, 'app', '9.9.9'), apiKey: 'oc_live_test',
      pid: 4242,
      completed: [...STEPS],
    });

    let healthCallCount = 0;
    const { deps, calls } = makeDeps({
      processAlive: (pid) => pid === 4242,
      // First call (pid alive probe) rejects; second call (after fresh start) resolves.
      waitForHealth: async () => {
        healthCallCount++;
        if (healthCallCount === 1) throw new Error('not yet up');
      },
    });

    const result = await runUp({ args: { yes: true, noBrowser: true }, baseDir, deps });

    assert.strictEqual(calls.startServer, 1, 'startServer must be called when health check fails');
    assert.strictEqual(result.reusedServer, false);
  });
});

describe('runUp — one-time browser sign-in', () => {
  test('fresh start opens /login?ott=<token> so the browser lands signed in', async () => {
    const baseDir = tempBase();
    const opened = [];
    const { deps } = makeDeps({
      mintLoginToken: () => 'tok123',
      openBrowser: (url) => { opened.push(url); },
    });

    await runUp({ args: { yes: true, db: 'embedded', noBrowser: false }, baseDir, deps });

    assert.deepStrictEqual(opened, ['http://localhost:3000/login?ott=tok123&next=%2Fsetup']);
  });

  test('no token minted → falls back to opening /setup', async () => {
    const baseDir = tempBase();
    const opened = [];
    const { deps } = makeDeps({
      openBrowser: (url) => { opened.push(url); },
    });

    await runUp({ args: { yes: true, db: 'embedded', noBrowser: false }, baseDir, deps });

    assert.deepStrictEqual(opened, ['http://localhost:3000/setup']);
  });

  test('reused server never mints a token (env is read at boot, not live)', async () => {
    const baseDir = tempBase();
    saveInstance(baseDir, {
      version: '9.9.9', port: 3000, dbMode: 'embedded',
      appDir: join(baseDir, 'app', '9.9.9'), apiKey: 'oc_live_test',
      pid: 4242,
      completed: [...STEPS],
    });
    const opened = [];
    let mintCalls = 0;
    const { deps } = makeDeps({
      processAlive: (pid) => pid === 4242,
      mintLoginToken: () => { mintCalls++; return 'tok123'; },
      openBrowser: (url) => { opened.push(url); },
    });

    await runUp({ args: { yes: true, noBrowser: false }, baseDir, deps });

    assert.strictEqual(mintCalls, 0, 'mintLoginToken must not be called for a reused server');
    assert.deepStrictEqual(opened, ['http://localhost:3000/setup']);
  });
});

describe('mintLoginToken', () => {
  test('appends DASHCLAW_LOGIN_OTT=<token>.<expiry> to an existing .env.local', () => {
    const appDir = tempBase();
    writeFileSync(join(appDir, '.env.local'), 'DATABASE_URL=postgresql://x\n');

    const token = mintLoginToken(appDir, { error() {} });

    assert.ok(token, 'must return the minted token');
    const env = readFileSync(join(appDir, '.env.local'), 'utf8');
    const m = env.match(/^DASHCLAW_LOGIN_OTT=([^.\n]+)\.(\d+)$/m);
    assert.ok(m, `.env.local must gain the OTT line, got:\n${env}`);
    assert.strictEqual(m[1], token);
    assert.ok(Number(m[2]) > Date.now(), 'expiry must be in the future');
    assert.match(env, /^DATABASE_URL=postgresql:\/\/x$/m, 'existing lines must survive');
  });

  test('replaces a stale OTT line instead of stacking a second one', () => {
    const appDir = tempBase();
    writeFileSync(join(appDir, '.env.local'), 'DASHCLAW_LOGIN_OTT=old.123\n');

    const token = mintLoginToken(appDir, { error() {} });

    const env = readFileSync(join(appDir, '.env.local'), 'utf8');
    const lines = env.split('\n').filter((l) => l.startsWith('DASHCLAW_LOGIN_OTT='));
    assert.strictEqual(lines.length, 1);
    assert.ok(lines[0].includes(token));
  });

  test('missing .env.local → returns null (fall back to the password flow)', () => {
    const appDir = join(tempBase(), 'does-not-exist');
    assert.strictEqual(mintLoginToken(appDir, { error() {} }), null);
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
