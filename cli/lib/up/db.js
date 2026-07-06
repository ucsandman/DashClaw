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
import { existsSync, rmSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';

// Keep this in sync with the "embedded-postgres" version in cli/package.json.
const EMBEDDED_PG_VERSION = 'embedded-postgres@18.4.0-beta.17';

// Windows exit status 0xC0000135 (STATUS_DLL_NOT_FOUND). The embedded
// Postgres binaries link against the Microsoft Visual C++ runtime, which a
// fresh Windows install (and Windows Sandbox) does not ship — initdb dies at
// exec with this code and EMPTY stderr, which reads as pure noise to a
// first-run user.
const STATUS_DLL_NOT_FOUND = '3221225781';
const VC_REDIST_HINT =
  'Embedded Postgres needs the Microsoft Visual C++ runtime, which this Windows machine does not have. '
  + 'Install it once from https://aka.ms/vs/17/release/vc_redist.x64.exe (or `winget install Microsoft.VCRedist.2015+.x64`), '
  + 'then re-run `npx dashclaw up`. Alternatively retry with --db docker or --db url.';

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
  const base = `Embedded Postgres (${EMBEDDED_PG_VERSION}) failed: ${err.message}`;
  if (String(err.message).includes(STATUS_DLL_NOT_FOUND)) {
    return `${base} — this exit code means a required system DLL is missing. ${VC_REDIST_HINT}`;
  }
  return `${base}. Retry with --db docker or --db url.`;
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
export async function chooseDbMode({ flagDb, dockerAvailable, yes = false, promptFn }) {
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
  const answer = (await promptFn(`${lines.join('\n')}\nChoice [${def}]: `)).trim() || def;
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
  checkVcRuntime = missingVcRuntime,
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
    throw new Error(VC_REDIST_HINT);
  }
  const port = await pickDbPort({ preferred: preferredPort, isFree, logger });
  const { default: EmbeddedPostgres } = await import('embedded-postgres');
  const pgDir = join(baseDir, 'pg');
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
  });
  try {
    await pg.initialise();
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
