// cli/lib/up/db.js
//
// Database mode selection and provisioning for `dashclaw up`.
//
// Three modes:
//   docker   — starts/reuses a `dashclaw-pg` Docker container (port 5433)
//   embedded — downloads and runs embedded Postgres via embedded-postgres (~40 MB, first run)
//   url      — prompts for a postgresql:// connection string from the user

import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

export const LOCAL_DB_URL = 'postgresql://dashclaw:dashclaw@localhost:5433/dashclaw';

const CONTAINER = 'dashclaw-pg';
const shell = process.platform === 'win32';

/** Returns true when the `docker` binary is available and responsive. */
export function dockerAvailableSync() {
  return spawnSync('docker', ['--version'], { stdio: 'ignore', shell }).status === 0;
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
 * Returns the docker run command that starts a local Postgres container.
 * Mirrors the repo's docker-compose.yml: postgres:16-alpine, host port 5433,
 * dashclaw/dashclaw/dashclaw credentials, named volume dashclaw_pgdata.
 */
export function dockerCommandFor() {
  return {
    cmd: 'docker',
    args: [
      'run', '-d', '--name', CONTAINER,
      '-e', 'POSTGRES_USER=dashclaw',
      '-e', 'POSTGRES_PASSWORD=dashclaw',
      '-e', 'POSTGRES_DB=dashclaw',
      '-p', '5433:5432',
      '-v', 'dashclaw_pgdata:/var/lib/postgresql/data',
      'postgres:16-alpine',
    ],
  };
}

/** Starts the dashclaw-pg container, reusing it if it already exists. */
function dockerStartOrRun(logger) {
  const ps = spawnSync(
    'docker', ['ps', '-aq', '--filter', `name=^${CONTAINER}$`],
    { encoding: 'utf8', shell },
  );
  if ((ps.stdout || '').trim()) {
    execFileSync('docker', ['start', CONTAINER], { stdio: 'ignore', shell });
  } else {
    const { cmd, args } = dockerCommandFor();
    execFileSync(cmd, args, { stdio: 'ignore', shell });
  }
  logger.error('[ok] Docker Postgres running (container dashclaw-pg, port 5433)');
}

/**
 * Provisions the database according to `mode` and returns { databaseUrl, stop }.
 *
 * @param {object}   opts
 * @param {'docker'|'embedded'|'url'} opts.mode
 * @param {string}   opts.baseDir   - base dir for embedded data (e.g. ~/.dashclaw)
 * @param {Function} [opts.promptFn] - async (message) => string (required for mode=url)
 * @param {object}   [opts.logger]  - object with .error(); defaults to console
 * @returns {Promise<{ databaseUrl: string, stop: () => Promise<void> }>}
 */
export async function provisionDatabase({ mode, baseDir, promptFn, logger = console }) {
  if (mode === 'url') {
    const url = (await promptFn('postgresql:// connection string: ')).trim();
    if (!url.startsWith('postgresql://')) throw new Error('That is not a postgresql:// URL.');
    return { databaseUrl: url, stop: async () => {} };
  }

  if (mode === 'docker') {
    dockerStartOrRun(logger);
    await waitForPort(5433, 30_000);
    return { databaseUrl: LOCAL_DB_URL, stop: async () => {} };
  }

  // mode === 'embedded'
  const { default: EmbeddedPostgres } = await import('embedded-postgres');
  const pg = new EmbeddedPostgres({
    databaseDir: join(baseDir, 'pg'),
    user: 'dashclaw',
    password: 'dashclaw',
    port: 5433,
    persistent: true,
  });
  await pg.initialise();
  await pg.start();
  try { await pg.createDatabase('dashclaw'); } catch { /* already exists on resume — fine */ }
  logger.error('[ok] Embedded Postgres running (port 5433, data in ~/.dashclaw/pg)');
  return { databaseUrl: LOCAL_DB_URL, stop: () => pg.stop() };
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
