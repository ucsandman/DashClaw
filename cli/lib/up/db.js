// cli/lib/up/db.js
//
// Database mode selection and provisioning for `dashclaw up`.
//
// Three modes:
//   docker   — starts/reuses a `dashclaw-pg` Docker container (host port 5433,
//              or the next free port when 5433 is taken by something else)
//   embedded — downloads and runs embedded Postgres via embedded-postgres (~40 MB, first run)
//   url      — prompts for a postgresql:// connection string from the user
//
// Port policy: prefer DEFAULT_DB_PORT (5433, mirroring the repo's
// docker-compose.yml). Dev machines often already have a Postgres on 5433 —
// hard-failing there with a raw `docker run` error was a real first-run
// killer, so provisioning scans forward to the first free port instead and
// says so. Continuity beats novelty: an existing container keeps whatever
// host port it was created with, and a saved databaseUrl's port is preferred
// on resume so a working install never silently moves.

import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';

// Keep this in sync with the "embedded-postgres" version in cli/package.json.
const EMBEDDED_PG_VERSION = 'embedded-postgres@18.4.0-beta.17';

// Force a UTF-8 cluster regardless of host locale. Without this, initdb on
// Windows inherits the OS locale (e.g. English_United States.1252) and
// creates a WIN1252-encoded database — DashClaw's migration SQL is UTF-8 and
// statements containing characters with no WIN1252 equivalent hard-fail with
// 22P05, leaving a partial schema (observed live in Windows Sandbox).
const INITDB_FLAGS = ['--encoding=UTF8', '--no-locale'];

// Windows exit status 0xC0000135 (STATUS_DLL_NOT_FOUND). The embedded
// Postgres binaries link against the Microsoft Visual C++ runtime, which a
// fresh Windows install (and Windows Sandbox) does not ship — initdb dies at
// exec with this code and EMPTY stderr, which reads as pure noise to a
// first-run user.
const STATUS_DLL_NOT_FOUND = '3221225781';
const VC_REDIST_URL = 'https://aka.ms/vs/17/release/vc_redist.x64.exe';
const VC_REDIST_HINT =
  'Embedded Postgres needs the Microsoft Visual C++ runtime, which this Windows machine does not have. '
  + `Install it once from ${VC_REDIST_URL} (or \`winget install Microsoft.VCRedist.2015+.x64\`), `
  + 'then re-run `npx dashclaw up`. Alternatively retry with --db docker or --db url.';

// Redistributable installer exit codes that mean the runtime is (or already
// was) in place: 0 = installed, 1638 = a newer version is already installed,
// 3010 = installed, reboot pending (the DLLs are on disk and loadable now).
const VC_REDIST_OK_EXIT_CODES = new Set([0, 1638, 3010]);

/**
 * Downloads and silently installs the Microsoft Visual C++ redistributable so
 * `npx dashclaw up` stays one command on a fresh Windows machine. Elevation
 * goes through `Start-Process -Verb RunAs`: an already-elevated shell runs it
 * directly, a standard shell surfaces the Windows UAC consent dialog — that
 * dialog IS the user's approval for the system-wide install. Throws (with the
 * manual remediation appended) when the download or install fails; the caller
 * re-checks the DLLs afterwards as the authoritative success signal.
 */
export async function installVcRedist({
  logger = console,
  fetchFn = fetch,
  spawn = spawnSync,
  downloadDir = tmpdir(),
} = {}) {
  logger.error(
    '[..] Embedded Postgres needs the Microsoft Visual C++ runtime — installing it now '
    + '(one-time, ~25 MB from microsoft.com; Windows may show an admin consent prompt) ...',
  );
  const exePath = join(downloadDir, 'dashclaw-vc_redist.x64.exe');
  let res;
  try {
    res = await fetchFn(VC_REDIST_URL);
  } catch (e) {
    throw new Error(`VC++ runtime download failed (${e.message}). ${VC_REDIST_HINT}`);
  }
  if (!res.ok) {
    throw new Error(`VC++ runtime download failed (HTTP ${res.status}). ${VC_REDIST_HINT}`);
  }
  writeFileSync(exePath, Buffer.from(await res.arrayBuffer()));
  const psPath = exePath.replace(/'/g, "''");
  const script =
    `$p = Start-Process -FilePath '${psPath}' -ArgumentList '/install','/quiet','/norestart' -Verb RunAs -Wait -PassThru; `
    + 'exit $p.ExitCode';
  const run = spawn('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], { stdio: 'ignore' });
  if (run.error) {
    throw new Error(`VC++ runtime install could not start (${run.error.message}). ${VC_REDIST_HINT}`);
  }
  if (!VC_REDIST_OK_EXIT_CODES.has(run.status)) {
    throw new Error(
      `VC++ runtime installer exited with code ${run.status} (declined admin prompt, or install failure). ${VC_REDIST_HINT}`,
    );
  }
  logger.error('[ok] Microsoft Visual C++ runtime installed.');
}

/**
 * True on Windows machines missing the VC++ runtime DLLs the embedded
 * Postgres binaries need. Checked BEFORE the embedded attempt so the failure
 * is actionable instead of a raw 0xC0000135 with empty stderr.
 */
export function missingVcRuntime({ platform = process.platform, exists = existsSync } = {}) {
  if (platform !== 'win32') return false;
  const sys32 = join(process.env.SystemRoot || 'C:\\Windows', 'System32');
  return !(exists(join(sys32, 'vcruntime140.dll')) && exists(join(sys32, 'msvcp140.dll')));
}

/**
 * Renders an embedded-postgres failure as an actionable message. Maps the
 * Windows DLL-not-found exit code to the VC++ runtime remediation even when
 * the preflight passed (a different DLL may be the missing one).
 */
export function embeddedFailureMessage(err) {
  // embedded-postgres rejects with NO value when the postgres process exits
  // before it is ready (its start() does `reject()` bare) — the real reason is
  // in the log lines it already printed. Guard, or this helper itself crashes
  // with "Cannot read properties of undefined" and eats the actual error
  // (observed live in Windows Sandbox).
  const detail = err?.message
    ?? 'the Postgres process exited before it was ready — the reason is in the log lines above';
  const base = `Embedded Postgres (${EMBEDDED_PG_VERSION}) failed: ${detail}`;
  if (String(detail).includes(STATUS_DLL_NOT_FOUND)) {
    return `${base} — this exit code means a required system DLL is missing. ${VC_REDIST_HINT}`;
  }
  return `${base}. Retry with --db docker or --db url.`;
}

/**
 * Extra embedded-postgres options when running as root on POSIX (the fresh
 * root-VPS case, caught live by the first `drill:fresh-linux --as-root` run):
 * postgres refuses to run as root, and embedded-postgres's escape hatch is
 * `createPostgresUser: true` (it provisions a `postgres` system user and runs
 * the cluster as that user). No-op everywhere else — including Windows, where
 * the elevated-token case is handled by the pg_ctl lifecycle instead.
 */
export function rootPostgresOptions({ platform = process.platform, getuid = process.getuid } = {}) {
  if (platform === 'win32' || typeof getuid !== 'function') return {};
  return getuid() === 0 ? { createPostgresUser: true } : {};
}

export const DEFAULT_DB_PORT = 5433;
// Scan window when the preferred port is taken: preferred+1 .. preferred+10.
const PORT_SCAN_SPAN = 10;

export function localDbUrlFor(port) {
  return `postgresql://dashclaw:dashclaw@localhost:${port}/dashclaw`;
}

// Back-compat export (the default-port URL).
export const LOCAL_DB_URL = localDbUrlFor(DEFAULT_DB_PORT);

const CONTAINER = 'dashclaw-pg';

/** Returns true when the `docker` binary is available and responsive. */
export function dockerAvailableSync() {
  return spawnSync('docker', ['--version'], { stdio: 'ignore' }).status === 0;
}

/**
 * Determines which database mode to use.
 *
 * Priority:
 *   1. Explicit --db flag
 *   2. Non-interactive (--yes): docker if available, otherwise embedded
 *   3. Interactive prompt
 *
 * @param {object} opts
 * @param {string|null} opts.flagDb   - explicit --db value or null
 * @param {boolean}     opts.dockerAvailable
 * @param {boolean}     [opts.yes]    - non-interactive mode
 * @param {Function}    [opts.promptFn] - async (message) => string
 * @returns {Promise<'docker'|'embedded'|'url'>}
 */
export async function chooseDbMode({ flagDb, dockerAvailable, yes = false, promptFn, logger = console }) {
  if (flagDb) return flagDb;
  if (yes) return dockerAvailable ? 'docker' : 'embedded';

  const lines = [
    'Database — pick one:',
    dockerAvailable
      ? '  1. Docker Postgres (Docker detected)   [default]'
      : '  1. Docker Postgres (Docker NOT detected)',
    `  2. Embedded Postgres (no Docker needed, ~40 MB download)${dockerAvailable ? '' : '   [default]'}`,
    '  3. I have a postgresql:// URL',
  ];
  const def = dockerAvailable ? '1' : '2';
  // The menu is printed OUTSIDE the readline prompt: on Windows, readline
  // re-renders multi-line prompts on input events, so the whole menu was
  // echoed twice (observed live in Windows Sandbox). Only the one-line
  // "Choice" question goes through promptFn.
  logger.error(lines.join('\n'));
  const answer = (await promptFn(`Choice [${def}]: `)).trim() || def;
  return { 1: 'docker', 2: 'embedded', 3: 'url' }[answer] ?? (dockerAvailable ? 'docker' : 'embedded');
}

/**
 * True when nothing on this machine is serving :port.
 *
 * Two probes, both required — a single one lies on Windows, where binding
 * 127.0.0.1:port SUCCEEDS while another process holds 0.0.0.0:port (observed
 * live: the probe said 5433 was free while a Docker proxy held it):
 *   1. connect() to 127.0.0.1:port — an accepted connection means a live
 *      listener regardless of which address it bound.
 *   2. listen() on the wildcard address — fails when the port is held at
 *      0.0.0.0/[::] even if nothing accepts on loopback.
 */
export async function isPortFree(port) {
  const net = await import('node:net');
  const accepts = await new Promise((resolve) => {
    const s = net.connect({ port, host: '127.0.0.1' });
    const done = (v) => { s.destroy(); resolve(v); };
    s.once('connect', () => done(true));
    s.once('error', () => done(false));
    s.setTimeout(1000, () => done(false));
  });
  if (accepts) return false;
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port); // wildcard bind on purpose — see above
  });
}

/**
 * Picks the host port for a locally provisioned Postgres: the preferred port
 * if free, otherwise the first free port in the scan window (logged, so the
 * deviation is never silent). Throws when the whole window is occupied.
 *
 * @param {object}   [opts]
 * @param {number}   [opts.preferred=DEFAULT_DB_PORT]
 * @param {Function} [opts.isFree=isPortFree]  injectable for tests
 * @param {object}   [opts.logger]
 * @returns {Promise<number>}
 */
export async function pickDbPort({ preferred = DEFAULT_DB_PORT, isFree = isPortFree, logger = console } = {}) {
  if (await isFree(preferred)) return preferred;
  for (let p = preferred + 1; p <= preferred + PORT_SCAN_SPAN; p++) {
    if (await isFree(p)) {
      logger.error(`[warn] Port ${preferred} is already in use — using free port ${p} for Postgres instead.`);
      return p;
    }
  }
  throw new Error(
    `No free port for Postgres: ${preferred}-${preferred + PORT_SCAN_SPAN} are all in use. `
    + 'Free one up, or re-run with --db url and your own postgresql:// connection string.',
  );
}

/**
 * Returns the docker run command that starts a local Postgres container.
 * Mirrors the repo's docker-compose.yml: postgres:16-alpine, dashclaw/dashclaw/
 * dashclaw credentials, named volume dashclaw_pgdata. Host port is a parameter
 * (default 5433) so provisioning can route around an occupied port.
 */
export function dockerCommandFor(port = DEFAULT_DB_PORT) {
  return {
    cmd: 'docker',
    args: [
      'run', '-d', '--name', CONTAINER,
      '-e', 'POSTGRES_USER=dashclaw',
      '-e', 'POSTGRES_PASSWORD=dashclaw',
      '-e', 'POSTGRES_DB=dashclaw',
      '-p', `${port}:5432`,
      '-v', 'dashclaw_pgdata:/var/lib/postgresql/data',
      'postgres:16-alpine',
    ],
  };
}

/** Runs a docker CLI call, capturing stderr so failures are explainable. */
function dockerExec(args) {
  try {
    return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    const stderr = (e.stderr || '').toString().trim();
    throw new Error(`docker ${args[0]} failed${stderr ? `: ${stderr}` : `: ${e.message}`}`);
  }
}

/** The real docker effects — injectable in provisionDatabase for tests. */
export const realDockerOps = {
  /** Container id (any state), or '' when it does not exist. */
  containerId: () => (spawnSync(
    'docker', ['ps', '-aq', '--filter', `name=^${CONTAINER}$`],
    { encoding: 'utf8' },
  ).stdout || '').trim(),
  /** Container id when RUNNING, or ''. */
  runningId: () => (spawnSync(
    'docker', ['ps', '-q', '--filter', `name=^${CONTAINER}$`],
    { encoding: 'utf8' },
  ).stdout || '').trim(),
  /**
   * Host port the existing container maps to 5432, or null. Reads the
   * configured binding via `docker inspect` because `docker port` reports
   * nothing for containers that are created/stopped rather than running.
   */
  mappedPort: () => {
    const out = spawnSync('docker', [
      'inspect', CONTAINER,
      '--format', '{{(index (index .HostConfig.PortBindings "5432/tcp") 0).HostPort}}',
    ], { encoding: 'utf8' }).stdout || '';
    const m = /^(\d+)$/.exec(out.trim());
    return m ? Number(m[1]) : null;
  },
  start: () => dockerExec(['start', CONTAINER]),
  remove: () => dockerExec(['rm', CONTAINER]),
  run: (port) => {
    try {
      dockerExec(dockerCommandFor(port).args);
    } catch (e) {
      // A failed `docker run` can leave a half-created container behind,
      // which would poison every retry with "name already in use" — clean
      // it up best-effort before surfacing the real error.
      try { execFileSync('docker', ['rm', '-f', CONTAINER], { stdio: 'ignore' }); } catch { /* nothing to clean */ }
      throw e;
    }
  },
};

/**
 * Starts (or creates) the dashclaw-pg container and returns the host port it
 * serves on. Continuity first: a running container is used as-is on whatever
 * port it maps; a stopped container is restarted on its recorded port. Only
 * when that recorded port has been taken by some OTHER process is the
 * container recreated on a fresh free port — safe by construction, because
 * all data lives in the named volume `dashclaw_pgdata`, not the container.
 */
async function dockerProvision({ preferredPort, ops, isFree, logger }) {
  if (ops.containerId()) {
    const mapped = ops.mappedPort();
    if (ops.runningId() && mapped) {
      logger.error(`[ok] Docker Postgres already running (container ${CONTAINER}, port ${mapped})`);
      return mapped;
    }
    if (mapped && await isFree(mapped)) {
      ops.start();
      logger.error(`[ok] Docker Postgres running (container ${CONTAINER}, port ${mapped})`);
      return mapped;
    }
    // The container's port is now held by something else (or the mapping is
    // unreadable) — recreate it on a free port. Data survives in the volume.
    logger.error(
      `[warn] Container ${CONTAINER} maps port ${mapped ?? '?'} which is now in use by another process — `
      + 'recreating the container on a free port (data volume dashclaw_pgdata is preserved).',
    );
    ops.remove();
  }
  const port = await pickDbPort({ preferred: preferredPort, isFree, logger });
  ops.run(port);
  logger.error(`[ok] Docker Postgres running (container ${CONTAINER}, port ${port})`);
  return port;
}

/**
 * Provisions the database according to `mode` and returns { databaseUrl, stop }.
 *
 * @param {object}   opts
 * @param {'docker'|'embedded'|'url'} opts.mode
 * @param {string}   opts.baseDir   - base dir for embedded data (e.g. ~/.dashclaw)
 * @param {Function} [opts.promptFn] - async (message) => string (required for mode=url)
 * @param {string}   [opts.savedDatabaseUrl] - databaseUrl from a prior run (port continuity)
 * @param {object}   [opts.dockerOps] - injectable docker effects (default realDockerOps)
 * @param {Function} [opts.isFree]    - injectable port probe (default isPortFree)
 * @param {Function} [opts.waitForDbPort] - injectable readiness wait (default waitForPort)
 * @param {object}   [opts.logger]  - object with .error(); defaults to console
 * @returns {Promise<{ databaseUrl: string, stop: () => Promise<void> }>}
 */
export async function provisionDatabase({
  mode, baseDir, promptFn, savedDatabaseUrl,
  dockerOps = realDockerOps, isFree = isPortFree, waitForDbPort = waitForPort, logger = console,
  checkVcRuntime = missingVcRuntime, installVc = installVcRedist,
}) {
  let preferredPort = DEFAULT_DB_PORT;
  if (savedDatabaseUrl) {
    try { preferredPort = Number(new URL(savedDatabaseUrl).port) || DEFAULT_DB_PORT; } catch { /* keep default */ }
  }

  if (mode === 'url') {
    const url = (await promptFn('postgresql:// connection string: ')).trim();
    if (!url.startsWith('postgresql://')) throw new Error('That is not a postgresql:// URL.');
    return { databaseUrl: url, stop: async () => {} };
  }

  if (mode === 'docker') {
    const port = await dockerProvision({ preferredPort, ops: dockerOps, isFree, logger });
    await waitForDbPort(port, 30_000);
    return { databaseUrl: localDbUrlFor(port), stop: async () => {} };
  }

  // mode === 'embedded'
  if (checkVcRuntime()) {
    // Fresh Windows machines (and Windows Sandbox) don't ship the VC++
    // runtime the Postgres binaries link against. Install it in-flow instead
    // of failing with homework — `dashclaw up` promises ONE command.
    await installVc({ logger });
    if (checkVcRuntime()) {
      throw new Error(`The VC++ runtime installer finished but the runtime DLLs are still missing. ${VC_REDIST_HINT}`);
    }
  }
  const pgDir = join(baseDir, 'pg');
  if (process.platform === 'win32') {
    // postgres.exe hard-refuses an elevated (admin) token — the norm in
    // Windows Sandbox and admin terminals. pg_ctl creates the restricted
    // token PostgreSQL requires, so on Windows the server lifecycle goes
    // through pg_ctl instead of embedded-postgres spawning postgres directly.
    return provisionEmbeddedWindows({ baseDir, pgDir, preferredPort, isFree, logger });
  }
  const port = await pickDbPort({ preferred: preferredPort, isFree, logger });
  const { default: EmbeddedPostgres } = await import('embedded-postgres');
  // Record whether the data dir existed BEFORE this run.
  // Only clean up on failure when WE created it (a pre-existing dir means
  // a working prior install whose data we must not delete).
  const dirPreExisted = existsSync(pgDir);
  // Derive credentials from LOCAL_DB_URL so the local dev creds live in
  // exactly one place rather than being duplicated as bare literals here.
  const localDb = new URL(LOCAL_DB_URL);
  const pg = new EmbeddedPostgres({
    databaseDir: pgDir,
    user: localDb.username,
    password: localDb.password,
    port,
    persistent: true,
    initdbFlags: INITDB_FLAGS,
    ...rootPostgresOptions(),
  });
  try {
    // initdb refuses a non-empty data dir, so only initialise a cluster that
    // does not exist yet (PG_VERSION marks an initialised cluster) — without
    // this, every resumed `up` with an embedded DB fails at re-init.
    if (!clusterInitialised(pgDir)) await pg.initialise();
    await pg.start();
  } catch (e) {
    if (!dirPreExisted) {
      rmSync(pgDir, { recursive: true, force: true });
    }
    throw new Error(embeddedFailureMessage(e));
  }
  try { await pg.createDatabase('dashclaw'); } catch { /* already exists on resume — fine */ }
  logger.error(`[ok] Embedded Postgres running (port ${port}, data in ${pgDir})`);
  return { databaseUrl: localDbUrlFor(port), stop: () => pg.stop() };
}

/** True when pgDir already holds an initialised cluster (initdb completed). */
export function clusterInitialised(pgDir, exists = existsSync) {
  return exists(join(pgDir, 'PG_VERSION'));
}

/** Last lines of the pg_ctl server log, for actionable start-failure errors. */
async function pgLogTail(logFile, lines = 12) {
  try {
    const { readFileSync } = await import('node:fs');
    const content = readFileSync(logFile, 'utf8').trim().split(/\r?\n/);
    return ` Server log (${logFile}):\n${content.slice(-lines).join('\n')}`;
  } catch {
    return '';
  }
}

/**
 * Windows lifecycle for the embedded cluster, via pg_ctl.
 *
 * Why not embedded-postgres's own start(): it spawns postgres.exe directly,
 * and postgres.exe refuses to run under a token with admin privileges
 * ("Execution of PostgreSQL by a user with administrative permissions is not
 * permitted"). initdb self-restricts its token, pg_ctl restricts the token it
 * starts postgres with — postgres itself does not. Routing start/stop through
 * pg_ctl works from BOTH elevated and normal shells. Consequence: the server
 * is detached from this process, so a previous `up` may have left it running —
 * `pg_ctl status` first, and reuse it on its saved port.
 *
 * All effects are injectable for unit tests.
 */
export async function provisionEmbeddedWindows({
  baseDir, pgDir, preferredPort, isFree = isPortFree, logger = console,
  bins,                    // { pg_ctl } — default: @embedded-postgres/windows-x64
  spawn = spawnSync,
  initCluster,             // default: embedded-postgres initialise()
  connectClient,           // default: pg Client — async (port) => { query, end }
}) {
  const localDb = new URL(LOCAL_DB_URL);
  const pgCtl = bins?.pg_ctl ?? (await import('@embedded-postgres/windows-x64')).pg_ctl;
  const logFile = join(baseDir, 'pg.log');

  const running = spawn(pgCtl, ['-D', pgDir, 'status'], { stdio: 'ignore' }).status === 0;
  let port = preferredPort;
  if (running) {
    // A detached server from a previous `up` is still serving — reuse it on
    // the port it was started with (the saved databaseUrl's port). Probing
    // for a free port here would wrongly route around our own server.
    logger.error(`[ok] Embedded Postgres already running (port ${port}, data in ${pgDir})`);
  } else {
    port = await pickDbPort({ preferred: preferredPort, isFree, logger });
    const dirPreExisted = existsSync(pgDir);
    try {
      if (!clusterInitialised(pgDir)) {
        if (initCluster) {
          await initCluster({ pgDir, user: localDb.username, password: localDb.password });
        } else {
          const { default: EmbeddedPostgres } = await import('embedded-postgres');
          await new EmbeddedPostgres({
            databaseDir: pgDir,
            user: localDb.username,
            password: localDb.password,
            port,
            persistent: true,
            initdbFlags: INITDB_FLAGS,
          }).initialise();
        }
      }
      const res = spawn(
        pgCtl,
        ['-D', pgDir, '-o', `-p ${port}`, '-l', logFile, '-w', '-t', '60', 'start'],
        { stdio: 'ignore' },
      );
      if (res.error || res.status !== 0) {
        const reason = res.error ? res.error.message : `pg_ctl start exited ${res.status}.`;
        throw new Error(`${reason}${await pgLogTail(logFile)}`);
      }
    } catch (e) {
      if (!dirPreExisted) {
        rmSync(pgDir, { recursive: true, force: true });
      }
      throw new Error(embeddedFailureMessage(e));
    }
    logger.error(`[ok] Embedded Postgres running (port ${port}, data in ${pgDir})`);
  }

  await createDashclawDatabase({ port, localDb, connectClient });
  return {
    databaseUrl: localDbUrlFor(port),
    stop: async () => {
      spawn(pgCtl, ['-D', pgDir, '-m', 'fast', 'stop'], { stdio: 'ignore' });
    },
  };
}

/** CREATE DATABASE dashclaw, tolerating "already exists" (resume). */
async function createDashclawDatabase({ port, localDb, connectClient }) {
  const connect = connectClient ?? (async (p) => {
    const { default: pg } = await import('pg');
    const client = new pg.Client({
      host: 'localhost', port: p,
      user: localDb.username, password: localDb.password,
      database: 'postgres',
    });
    await client.connect();
    return client;
  });
  const client = await connect(port);
  try {
    await client.query(`CREATE DATABASE ${localDb.pathname.slice(1)}`);
  } catch (e) {
    if (e.code !== '42P04') throw e; // 42P04 = duplicate_database (resume)
  } finally {
    await client.end();
  }
}

/** Polls :port until it accepts TCP connections, or throws on timeout. */
async function waitForPort(port, timeoutMs) {
  const net = await import('node:net');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await new Promise((resolve) => {
      const s = net.connect(port, '127.0.0.1');
      s.once('connect', () => { s.destroy(); resolve(true); });
      s.once('error', () => resolve(false));
    });
    if (ok) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Postgres did not accept connections on :${port} within ${timeoutMs / 1000}s.`);
}
