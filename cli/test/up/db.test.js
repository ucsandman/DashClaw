// cli/test/up/db.test.js
//
// Tests for cli/lib/up/db.js — database mode selection, port fallback, and
// docker command shape.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  chooseDbMode, dockerCommandFor, provisionDatabase, pickDbPort, DEFAULT_DB_PORT,
  missingVcRuntime, embeddedFailureMessage, installVcRedist,
  clusterInitialised, provisionEmbeddedWindows, rootPostgresOptions,
} from '../../lib/up/db.js';

const quietLogger = { error: () => {}, log: () => {} };

describe('rootPostgresOptions', () => {
  test('root on POSIX gets createPostgresUser (postgres refuses root; the fresh root-VPS class)', () => {
    assert.deepStrictEqual(
      rootPostgresOptions({ platform: 'linux', getuid: () => 0 }),
      { createPostgresUser: true },
    );
  });

  test('non-root POSIX, Windows, and platforms without getuid are all no-ops', () => {
    assert.deepStrictEqual(rootPostgresOptions({ platform: 'linux', getuid: () => 1000 }), {});
    assert.deepStrictEqual(rootPostgresOptions({ platform: 'win32', getuid: undefined }), {});
    assert.deepStrictEqual(rootPostgresOptions({ platform: 'darwin', getuid: undefined }), {});
  });
});

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
    const mode = await chooseDbMode({ flagDb: null, dockerAvailable: true, yes: false, promptFn, logger: quietLogger });
    assert.strictEqual(mode, 'url');
    assert.strictEqual(callCount, 1);
  });

  test('prints the menu via logger and keeps the readline prompt single-line', async () => {
    // Multi-line prompts get re-rendered (doubled) by readline on Windows —
    // the menu must NOT travel through promptFn.
    const printed = [];
    let prompt = '';
    const mode = await chooseDbMode({
      flagDb: null, dockerAvailable: false, yes: false,
      promptFn: async (msg) => { prompt = msg; return ''; },
      logger: { error: (m) => printed.push(m) },
    });
    assert.strictEqual(mode, 'embedded');
    assert.ok(printed.join('\n').includes('Database — pick one:'), 'menu goes to the logger');
    assert.ok(!prompt.includes('\n'), `prompt must be single-line, got: ${JSON.stringify(prompt)}`);
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

  test('provisionDatabase auto-installs the VC++ runtime when it is missing', async () => {
    let installs = 0;
    // Runtime stays missing even after the install "succeeds" — the recheck
    // must catch that and still surface the manual remediation.
    await assert.rejects(
      () => provisionDatabase({
        mode: 'embedded', baseDir: '/tmp/x', logger: quietLogger,
        checkVcRuntime: () => true,
        installVc: async () => { installs++; },
      }),
      /vc_redist\.x64\.exe/,
    );
    assert.strictEqual(installs, 1, 'expected exactly one install attempt');
  });

  test('provisionDatabase surfaces the install failure with the manual remediation', async () => {
    await assert.rejects(
      () => provisionDatabase({
        mode: 'embedded', baseDir: '/tmp/x', logger: quietLogger,
        checkVcRuntime: () => true,
        installVc: async () => { throw new Error('installer exited 1602. Install it once from vc_redist.x64.exe'); },
      }),
      /1602/,
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

describe('embeddedFailureMessage — bare rejection', () => {
  test('survives embedded-postgres rejecting with NO error value', () => {
    // Its start() does `reject()` bare when postgres exits early — err is
    // undefined and this helper must not crash reading .message.
    const msg = embeddedFailureMessage(undefined);
    assert.ok(msg.includes('exited before it was ready'), `expected a pointer to the log, got: ${msg}`);
  });
});

describe('provisionEmbeddedWindows — pg_ctl lifecycle', () => {
  const fakeClient = () => {
    const queries = [];
    return {
      queries,
      connect: async (_port) => ({
        query: async (q) => { queries.push(q); },
        end: async () => {},
      }),
    };
  };

  test('fresh machine: initialises the cluster, starts via pg_ctl, creates the database', async () => {
    const { mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const baseDir = mkdtempSync(join(tmpdir(), 'dashclaw-pgctl-test-'));
    const pgDir = join(baseDir, 'pg');
    const spawnCalls = [];
    let initialised = 0;
    const client = fakeClient();
    const result = await provisionEmbeddedWindows({
      baseDir, pgDir, preferredPort: 5433,
      isFree: async () => true,
      logger: quietLogger,
      bins: { pg_ctl: 'PG_CTL' },
      spawn: (cmd, args) => {
        spawnCalls.push({ cmd, args });
        // `status` probe says NOT running; `start` succeeds
        return { status: args.includes('status') ? 3 : 0 };
      },
      initCluster: async () => { initialised++; },
      connectClient: client.connect,
    });
    assert.strictEqual(initialised, 1, 'expected the cluster to be initialised once');
    const start = spawnCalls.find(({ args }) => args.includes('start'));
    assert.ok(start, 'expected a pg_ctl start call');
    assert.strictEqual(start.cmd, 'PG_CTL');
    assert.ok(start.args.includes('-w'), 'start must wait for readiness');
    assert.deepStrictEqual(client.queries, ['CREATE DATABASE dashclaw']);
    assert.strictEqual(result.databaseUrl, 'postgresql://dashclaw:dashclaw@localhost:5433/dashclaw');
    // stop() goes through pg_ctl stop
    await result.stop();
    const stop = spawnCalls.find(({ args }) => args.includes('stop'));
    assert.ok(stop, 'expected a pg_ctl stop call');
  });

  test('reuses an already-running detached server on the saved port without starting or probing', async () => {
    const spawnCalls = [];
    const client = fakeClient();
    const result = await provisionEmbeddedWindows({
      baseDir: '/base', pgDir: '/base/pg', preferredPort: 5434,
      isFree: async () => { throw new Error('must not probe ports when the server is already running'); },
      logger: quietLogger,
      bins: { pg_ctl: 'PG_CTL' },
      spawn: (cmd, args) => { spawnCalls.push({ cmd, args }); return { status: 0 }; }, // status: running
      initCluster: async () => { throw new Error('must not re-initialise a running cluster'); },
      connectClient: client.connect,
    });
    assert.ok(!spawnCalls.some(({ args }) => args.includes('start')), 'must not start twice');
    assert.strictEqual(result.databaseUrl, 'postgresql://dashclaw:dashclaw@localhost:5434/dashclaw');
  });

  test('tolerates CREATE DATABASE 42P04 (already exists) on resume', async () => {
    const result = await provisionEmbeddedWindows({
      baseDir: '/base', pgDir: '/base/pg', preferredPort: 5433,
      logger: quietLogger,
      bins: { pg_ctl: 'PG_CTL' },
      spawn: () => ({ status: 0 }),
      connectClient: async () => ({
        query: async () => { throw Object.assign(new Error('database "dashclaw" already exists'), { code: '42P04' }); },
        end: async () => {},
      }),
    });
    assert.ok(result.databaseUrl.includes('/dashclaw'));
  });

  test('a failed pg_ctl start surfaces an actionable embedded failure', async () => {
    const { mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const baseDir = mkdtempSync(join(tmpdir(), 'dashclaw-pgctl-fail-'));
    await assert.rejects(
      () => provisionEmbeddedWindows({
        baseDir, pgDir: join(baseDir, 'pg'), preferredPort: 5433,
        isFree: async () => true,
        logger: quietLogger,
        bins: { pg_ctl: 'PG_CTL' },
        spawn: (_cmd, args) => ({ status: args.includes('status') ? 3 : 1 }),
        initCluster: async () => {},
        connectClient: async () => { throw new Error('unreachable'); },
      }),
      /pg_ctl start exited 1/,
    );
  });
});

describe('clusterInitialised', () => {
  test('true only when PG_VERSION exists in the data dir', () => {
    assert.strictEqual(clusterInitialised('/x', (p) => p.endsWith('PG_VERSION')), true);
    assert.strictEqual(clusterInitialised('/x', () => false), false);
  });
});

describe('installVcRedist', () => {
  const okFetch = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) });
  const freshDir = async () => {
    const { mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    return mkdtempSync(join(tmpdir(), 'dashclaw-vc-test-'));
  };

  test('downloads the redistributable and runs it elevated + silent', async () => {
    const calls = [];
    await installVcRedist({
      logger: quietLogger,
      fetchFn: okFetch,
      spawn: (cmd, args) => { calls.push({ cmd, args }); return { status: 0 }; },
      downloadDir: await freshDir(),
    });
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].cmd, 'powershell');
    const script = calls[0].args.join(' ');
    assert.ok(script.includes('-Verb RunAs'), 'must request elevation via UAC');
    assert.ok(script.includes("'/quiet'"), 'must install silently');
    assert.ok(script.includes('dashclaw-vc_redist.x64.exe'), 'must run the downloaded exe');
  });

  test('treats 1638 (newer version installed) and 3010 (reboot pending) as success', async () => {
    const downloadDir = await freshDir();
    for (const status of [1638, 3010]) {
      await installVcRedist({
        logger: quietLogger,
        fetchFn: okFetch,
        spawn: () => ({ status }),
        downloadDir,
      });
    }
  });

  test('a failed download surfaces the manual remediation', async () => {
    await assert.rejects(
      () => installVcRedist({ logger: quietLogger, fetchFn: async () => ({ ok: false, status: 503 }) }),
      /503.*vc_redist\.x64\.exe/s,
    );
  });

  test('a declined UAC prompt / failed install surfaces the manual remediation', async () => {
    const downloadDir = await freshDir();
    await assert.rejects(
      () => installVcRedist({
        logger: quietLogger,
        fetchFn: okFetch,
        spawn: () => ({ status: 1602 }),
        downloadDir,
      }),
      /1602.*vc_redist\.x64\.exe/s,
    );
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
