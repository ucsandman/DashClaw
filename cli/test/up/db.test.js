// cli/test/up/db.test.js
//
// Tests for cli/lib/up/db.js — database mode selection, port fallback, and
// docker command shape.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  chooseDbMode, dockerCommandFor, provisionDatabase, pickDbPort, DEFAULT_DB_PORT,
  missingVcRuntime, embeddedFailureMessage,
} from '../../lib/up/db.js';

describe('chooseDbMode', () => {
  test('honors explicit flagDb even when docker is available', async () => {
    const mode = await chooseDbMode({ flagDb: 'embedded', dockerAvailable: true });
    assert.strictEqual(mode, 'embedded');
  });

  test('defaults to docker when docker is available and yes is true', async () => {
    const mode = await chooseDbMode({ flagDb: null, dockerAvailable: true, yes: true });
    assert.strictEqual(mode, 'docker');
  });

  test('defaults to embedded when docker is unavailable and yes is true', async () => {
    const mode = await chooseDbMode({ flagDb: null, dockerAvailable: false, yes: true });
    assert.strictEqual(mode, 'embedded');
  });

  test('prompts interactively and maps answer "3" to url', async () => {
    let callCount = 0;
    const promptFn = async (_msg) => { callCount++; return '3'; };
    const mode = await chooseDbMode({ flagDb: null, dockerAvailable: true, yes: false, promptFn });
    assert.strictEqual(mode, 'url');
    assert.strictEqual(callCount, 1);
  });
});

describe('provisionDatabase — url mode', () => {
  test('rejects non-postgresql:// connection strings', async () => {
    await assert.rejects(
      () => provisionDatabase({ mode: 'url', promptFn: async () => 'mysql://x' }),
      /postgresql:\/\//,
    );
  });
});

describe('embedded mode — Windows VC++ runtime guard', () => {
  test('missingVcRuntime is false off Windows regardless of DLL state', () => {
    assert.strictEqual(missingVcRuntime({ platform: 'linux', exists: () => false }), false);
  });

  test('missingVcRuntime is true on Windows when the runtime DLLs are absent', () => {
    assert.strictEqual(missingVcRuntime({ platform: 'win32', exists: () => false }), true);
  });

  test('missingVcRuntime is false on Windows when the runtime DLLs are present', () => {
    assert.strictEqual(missingVcRuntime({ platform: 'win32', exists: () => true }), false);
  });

  test('provisionDatabase preflights the VC++ runtime with an actionable error', async () => {
    await assert.rejects(
      () => provisionDatabase({ mode: 'embedded', baseDir: '/tmp/x', checkVcRuntime: () => true }),
      /vc_redist\.x64\.exe/,
    );
  });

  test('embeddedFailureMessage maps STATUS_DLL_NOT_FOUND (0xC0000135) to the VC++ remediation', () => {
    const msg = embeddedFailureMessage(new Error(
      'Postgres init script failed (code: 3221225781, signal: null). ERROR OUTPUT: .',
    ));
    assert.ok(msg.includes('vc_redist.x64.exe'), `expected VC++ remediation in: ${msg}`);
    assert.ok(msg.includes('3221225781'), 'expected the original exit code to survive');
  });

  test('embeddedFailureMessage keeps the generic remediation for other failures', () => {
    const msg = embeddedFailureMessage(new Error('port already bound'));
    assert.ok(msg.includes('--db docker'), `expected generic remediation in: ${msg}`);
    assert.ok(!msg.includes('vc_redist'), 'must not blame the VC++ runtime for unrelated failures');
  });
});

describe('dockerCommandFor', () => {
  test('uses postgres:16-alpine image', () => {
    const { args } = dockerCommandFor();
    assert.ok(args.includes('postgres:16-alpine'), 'expected postgres:16-alpine in args');
  });

  test('maps host port 5433 to container port 5432', () => {
    const { args } = dockerCommandFor();
    const joined = args.join(' ');
    assert.ok(joined.includes('5433:5432'), 'expected 5433:5432 port mapping');
  });

  test('uses dashclaw_pgdata named volume', () => {
    const { args } = dockerCommandFor();
    const joined = args.join(' ');
    assert.ok(joined.includes('dashclaw_pgdata'), 'expected dashclaw_pgdata volume');
  });

  test('maps a custom host port when given one', () => {
    const { args } = dockerCommandFor(5437);
    assert.ok(args.join(' ').includes('5437:5432'), 'expected 5437:5432 port mapping');
  });
});

const quietLogger = { error: () => {}, log: () => {} };

describe('pickDbPort', () => {
  test('returns the preferred port when it is free', async () => {
    const port = await pickDbPort({ preferred: 5433, isFree: async () => true, logger: quietLogger });
    assert.strictEqual(port, 5433);
  });

  test('scans forward to the first free port when preferred is taken', async () => {
    const isFree = async (p) => p >= 5435; // 5433 + 5434 occupied
    const warnings = [];
    const port = await pickDbPort({ preferred: 5433, isFree, logger: { error: (m) => warnings.push(m) } });
    assert.strictEqual(port, 5435);
    assert.ok(warnings.some((w) => w.includes('5433') && w.includes('5435')), 'expected a logged deviation');
  });

  test('throws with --db url remediation when the whole window is occupied', async () => {
    await assert.rejects(
      () => pickDbPort({ preferred: 5433, isFree: async () => false, logger: quietLogger }),
      /--db url/,
    );
  });
});

describe('provisionDatabase — docker mode port handling', () => {
  const noWait = async () => {};

  test('falls back to a free port when 5433 is held by a foreign process (fresh install)', async () => {
    const ran = [];
    const ops = {
      containerId: () => '',
      runningId: () => '',
      mappedPort: () => null,
      start: () => { throw new Error('should not start — no container exists'); },
      remove: () => { throw new Error('should not remove — no container exists'); },
      run: (port) => ran.push(port),
    };
    const { databaseUrl } = await provisionDatabase({
      mode: 'docker', dockerOps: ops, isFree: async (p) => p !== DEFAULT_DB_PORT,
      waitForDbPort: noWait, logger: quietLogger,
    });
    assert.deepStrictEqual(ran, [DEFAULT_DB_PORT + 1]);
    assert.ok(databaseUrl.includes(`:${DEFAULT_DB_PORT + 1}/`), `expected fallback port in ${databaseUrl}`);
  });

  test('reuses a RUNNING container on whatever port it maps', async () => {
    const ops = {
      containerId: () => 'abc', runningId: () => 'abc', mappedPort: () => 5439,
      start: () => { throw new Error('should not start a running container'); },
      remove: () => { throw new Error('should not remove a running container'); },
      run: () => { throw new Error('should not create a second container'); },
    };
    const { databaseUrl } = await provisionDatabase({
      mode: 'docker', dockerOps: ops, isFree: async () => false,
      waitForDbPort: noWait, logger: quietLogger,
    });
    assert.ok(databaseUrl.includes(':5439/'), `expected the container's mapped port in ${databaseUrl}`);
  });

  test('restarts a stopped container on its recorded port when that port is free', async () => {
    let started = 0;
    const ops = {
      containerId: () => 'abc', runningId: () => '', mappedPort: () => 5433,
      start: () => { started++; },
      remove: () => { throw new Error('should not remove — recorded port is free'); },
      run: () => { throw new Error('should not create a second container'); },
    };
    const { databaseUrl } = await provisionDatabase({
      mode: 'docker', dockerOps: ops, isFree: async () => true,
      waitForDbPort: noWait, logger: quietLogger,
    });
    assert.strictEqual(started, 1);
    assert.ok(databaseUrl.includes(':5433/'), `expected the recorded port in ${databaseUrl}`);
  });

  test('recreates a stopped container whose recorded port was taken by another process', async () => {
    let removed = 0;
    const ran = [];
    const ops = {
      containerId: () => 'abc', runningId: () => '', mappedPort: () => 5433,
      start: () => { throw new Error('should not start onto an occupied port'); },
      remove: () => { removed++; },
      run: (port) => ran.push(port),
    };
    const { databaseUrl } = await provisionDatabase({
      mode: 'docker', dockerOps: ops, isFree: async (p) => p !== 5433,
      waitForDbPort: noWait, logger: quietLogger,
    });
    assert.strictEqual(removed, 1);
    assert.deepStrictEqual(ran, [5434]);
    assert.ok(databaseUrl.includes(':5434/'), `expected the new port in ${databaseUrl}`);
  });

  test('prefers the saved databaseUrl port on resume', async () => {
    const ran = [];
    const ops = {
      containerId: () => '', runningId: () => '', mappedPort: () => null,
      start: () => {}, remove: () => {},
      run: (port) => ran.push(port),
    };
    await provisionDatabase({
      mode: 'docker', savedDatabaseUrl: 'postgresql://dashclaw:dashclaw@localhost:5440/dashclaw',
      dockerOps: ops, isFree: async () => true, waitForDbPort: noWait, logger: quietLogger,
    });
    assert.deepStrictEqual(ran, [5440]);
  });
});
