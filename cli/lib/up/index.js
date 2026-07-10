// cli/lib/up/index.js
//
// Orchestrator for `npx dashclaw up` — composes the up/ primitives into the
// full pipeline (fetch → deps → db → setup → build → start → connect → open),
// checkpointed and resumable via instance.json.
//
// Three operating modes fall out of the same loop:
//   fresh   — no instance.json: run every step.
//   resume  — partial completed[]: skip done steps, continue from the first gap.
//   boot    — all six steps done: skip everything up to start, then start+open.
//
// Every effect is injectable via `deps` so the orchestrator is unit-testable
// without touching the network, Docker, or a real Next server.

import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { STEPS, loadInstance, saveInstance, checkpoint } from './instance.js';
import { resolveAppVersion, downloadAndExtract } from './fetch-app.js';
import { dockerAvailableSync, chooseDbMode, provisionDatabase } from './db.js';
import { installDeps, buildApp, startServer, waitForHealth, openBrowser, winSafeSpawnArgs } from './run.js';
import { installClaude } from '../claude/install.js';
import { parseUpArgs } from './args.js';
import { ask } from '../config.js';

/**
 * Kill a process and its entire child tree. On Windows, `process.kill` only
 * terminates the cmd.exe shell wrapper that `shell:true` spawns — taskkill /T
 * reaches the actual Next server underneath.
 */
export function killTree(pid) {
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    process.kill(pid);
  }
}

/**
 * Resolve the base state directory from parsed args.
 * Exported so upCommand + cmdDown can unit-test the wiring without spawning.
 */
export function resolveBaseDir(args) {
  return args.dir ?? join(homedir(), '.dashclaw');
}

// Watchdog for the setup child. The child only runs migrations + a status
// check here (install and build are the orchestrator's steps), so 10 minutes
// is far beyond any healthy run.
export const SETUP_TIMEOUT_MS = 10 * 60_000;

/**
 * Mask secrets the setup child prints for interactive users before its lines
 * reach any log — CI uploads up.log as an artifact on failure, and operators
 * paste `dashclaw up` scrollback into issues.
 */
export function scrubSetupLine(line) {
  return String(line)
    .replace(/oc_live_[A-Za-z0-9]+/g, 'oc_live_***')
    .replace(/(password[^:\n]*:\s*)\S+/gi, '$1***');
}

/** Shared success/failure interpretation of the finished setup child. */
function parseSetupResult({ status, stdout, stderrTail }) {
  const lines = String(stdout).split('\n').map((l) => l.trim()).filter(Boolean);
  let parsed = null;
  if (lines.length) {
    try { parsed = JSON.parse(lines[lines.length - 1]); } catch {
      throw new Error(`Setup output was not parseable JSON. Last line: ${lines[lines.length - 1]}`);
    }
  }
  if (status !== 0 || parsed?.ok === false) {
    const detail = parsed?.error
      || scrubSetupLine(String(stderrTail || '').slice(-2000).trim())
      || `setup exited ${status}`;
    throw new Error(`Setup failed: ${detail}`);
  }
  if (!parsed) throw new Error('Setup produced no parseable JSON output.');
  return parsed;
}

/**
 * Run the app's setup script as a streamed async child, contract:
 *   node --import tsx scripts/setup.mjs --yes --json --database-url <url>
 * prints EXACTLY ONE JSON line on stdout: {ok:true, apiKey, adminPassword} or
 * {ok:false, error} with a non-zero exit. We parse the LAST stdout line.
 *
 * The child's stderr (its progress output) streams through to the logger as
 * it happens. The spawnSync predecessor buffered it until exit, which turned
 * a hung migration into a silent 20-minute mystery (observed live on macOS
 * CI: up.log ended at "Running setup" with zero evidence of which step hung).
 * A watchdog kills the child after timeoutMs and reports the last activity —
 * a stuck spinner frame names the exact migration that wedged.
 *
 * @param {object} opts
 * @param {string} opts.appDir
 * @param {string} opts.databaseUrl
 * @param {object} [opts.logger]
 * @param {Function} [opts.spawn]     injectable async spawn for testing (default: spawn)
 * @param {number}   [opts.timeoutMs] watchdog (default SETUP_TIMEOUT_MS)
 * @param {Function} [opts.kill]      injectable process killer (default killTree)
 * @returns {Promise<object>} the parsed JSON result
 */
export function runSetupScriptReal({
  appDir, databaseUrl, logger = console,
  spawn: spawnFn = spawn, timeoutMs = SETUP_TIMEOUT_MS, kill = killTree,
}) {
  logger.error('-> Running setup (migrations + first admin) ...');
  // Windows shell handling (npm-style .cmd resolution + DEP0190 avoidance)
  // lives in winSafeSpawnArgs.
  const safe = winSafeSpawnArgs('node', [
    '--import', 'tsx', 'scripts/setup.mjs',
    '--yes', '--json', '--database-url', databaseUrl,
    // The orchestrator owns install (step 2) and build (step 5); skip them
    // inside setup.mjs to avoid doing both twice on a fresh install.
    '--skip-install', '--skip-build',
  ]);
  return new Promise((resolve, reject) => {
    let child;
    try {
      // stdin MUST be 'ignore': the default open pipe makes any stray readline
      // prompt in the child hang forever (observed: 12-minute silent hang).
      child = spawnFn(safe.cmd, safe.args, {
        cwd: appDir, stdio: ['ignore', 'pipe', 'pipe'], ...safe.opts,
      });
    } catch (e) {
      reject(e);
      return;
    }

    let stdout = '';
    let stderrTail = '';
    let pending = '';
    const logStderr = (data) => {
      stderrTail = (stderrTail + data).slice(-4000);
      pending += data;
      const lines = pending.split('\n');
      pending = lines.pop();
      for (const raw of lines) {
        // A carriage return without a newline is a spinner frame updating in
        // place; only the part after the last \r is what a terminal shows.
        const line = raw.slice(raw.lastIndexOf('\r') + 1).trimEnd();
        if (line) logger.error(`   ${scrubSetupLine(line)}`);
      }
    };
    child.stdout?.on('data', (d) => { stdout += d; });
    child.stderr?.on('data', (d) => logStderr(String(d)));

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      // The pending fragment is the evidence: a stuck spinner frame names the
      // migration that hung (e.g. "/ Running auto-migrate... (600s)").
      const lastFrame = pending.slice(pending.lastIndexOf('\r') + 1).trim();
      try { kill(child.pid); } catch { /* already gone */ }
      reject(new Error(
        `Setup did not finish within ${Math.round(timeoutMs / 60_000)} minutes — killed. `
        + (lastFrame
          ? `Last activity: ${scrubSetupLine(lastFrame)}`
          : 'It produced no output at the moment it was killed.'),
      ));
    }, timeoutMs);

    child.on('error', (e) => {
      clearTimeout(timer);
      if (!timedOut) reject(e);
    });
    child.on('close', (status) => {
      clearTimeout(timer);
      if (timedOut) return; // already rejected by the watchdog
      if (pending) logStderr('\n'); // flush the final unterminated line
      try {
        resolve(parseSetupResult({ status, stdout, stderrTail }));
      } catch (e) {
        reject(e);
      }
    });
  });
}

/**
 * Rewrites the DATABASE_URL line in the app's .env.local after the local DB
 * legitimately moved ports. Best-effort: a missing file or line is left alone
 * (setup will write it on its next run).
 */
export function rewriteEnvDatabaseUrl(appDir, databaseUrl, logger = console) {
  const envPath = join(appDir, '.env.local');
  try {
    if (!existsSync(envPath)) return;
    const src = readFileSync(envPath, 'utf8');
    if (!/^DATABASE_URL=.*$/m.test(src)) return;
    writeFileSync(envPath, src.replace(/^DATABASE_URL=.*$/m, `DATABASE_URL=${databaseUrl}`));
    logger.error(`[ok] Updated DATABASE_URL in ${envPath}`);
  } catch (e) {
    logger.error(`[warn] Could not update ${envPath}: ${e.message} — update DATABASE_URL manually.`);
  }
}

/**
 * Mint a one-time browser sign-in token into the app's .env.local, BEFORE the
 * server starts (Next reads .env.local at boot). The server consumes it on
 * first use (app/api/auth/local); the 15-minute expiry bounds replay. This is
 * what lets `dashclaw up` open a browser that lands already signed in instead
 * of a login form asking for a password the user never saw.
 * Best-effort: returns null (→ fall back to /setup) when .env.local is absent.
 */
export function mintLoginToken(appDir, logger = console) {
  try {
    const envPath = join(appDir, '.env.local');
    if (!existsSync(envPath)) return null;
    const token = randomBytes(24).toString('base64url');
    const line = `DASHCLAW_LOGIN_OTT=${token}.${Date.now() + 15 * 60_000}`;
    const src = readFileSync(envPath, 'utf8');
    const out = /^DASHCLAW_LOGIN_OTT=.*$/m.test(src)
      ? src.replace(/^DASHCLAW_LOGIN_OTT=.*$/m, line)
      : `${src}${src.endsWith('\n') || src === '' ? '' : '\n'}${line}\n`;
    writeFileSync(envPath, out);
    return token;
  } catch (e) {
    logger.error(`[warn] Could not mint a browser sign-in link: ${e.message} — sign in with the admin password instead.`);
    return null;
  }
}

/** Default process-liveness probe: signal 0 succeeds iff the pid exists. */
export function defaultProcessAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

/** The real effect wiring — swapped wholesale by tests. */
export function realDeps() {
  return {
    resolveAppVersion,
    downloadAndExtract,
    installDeps,
    chooseDbMode,
    provisionDatabase,
    runSetupScript: runSetupScriptReal,
    mintLoginToken,
    buildApp,
    startServer,
    waitForHealth,
    installClaude,
    openBrowser,
    promptFn: ask,
    logger: console,
    dockerAvailable: dockerAvailableSync(),
    processAlive: defaultProcessAlive,
  };
}

/**
 * Run (or resume, or boot) a local DashClaw instance.
 *
 * @param {object} opts
 * @param {object} opts.args      parsed up args (yes, noBrowser, db, port, sourceDir, update)
 * @param {string} [opts.baseDir] state + data dir (default ~/.dashclaw)
 * @param {object} [opts.deps]    injected effects (default realDeps())
 * @returns {Promise<{ child, stopDb, baseUrl, reusedServer }>}
 */
export async function runUp({ args, baseDir = join(homedir(), '.dashclaw'), deps = realDeps() }) {
  const { logger } = deps;

  let inst = loadInstance(baseDir) ?? { completed: [] };
  if (args.update) {
    inst = saveInstance(baseDir, { completed: [] });
  }
  const done = (step) => inst.completed.includes(step);

  const port = args.port ?? inst.port ?? 3000;
  const baseUrl = `http://localhost:${port}`;

  // 1. app_fetched ----------------------------------------------------------
  let appDir = inst.appDir;
  if (!done('app_fetched')) {
    const version = args.sourceDir ? 'source' : await deps.resolveAppVersion();
    appDir = args.sourceDir ?? await deps.downloadAndExtract({ version, baseDir, logger });
    inst = saveInstance(baseDir, { version, appDir, port });
    inst = checkpoint(baseDir, 'app_fetched');
  }

  // 2. deps_installed -------------------------------------------------------
  if (!done('deps_installed')) {
    deps.installDeps(appDir, logger);
    inst = checkpoint(baseDir, 'deps_installed');
  }

  // 3. db_ready -------------------------------------------------------------
  // provisionDatabase is idempotent and restarts a stopped DB, so we call it
  // every run (including boot) for docker/embedded — but url-mode has no DB
  // process to start, and re-prompting on every resume (or under --yes/non-TTY)
  // is both wrong and hangs. Reuse the saved URL when db_ready is already
  // checkpointed and inst.databaseUrl is set.
  const dbMode = inst.dbMode ?? await deps.chooseDbMode({
    flagDb: args.db, dockerAvailable: deps.dockerAvailable, yes: args.yes, promptFn: deps.promptFn, logger,
  });
  const db = (dbMode === 'url' && done('db_ready') && inst.databaseUrl)
    ? { databaseUrl: inst.databaseUrl, stop: async () => {} }
    : await deps.provisionDatabase({
        mode: dbMode, baseDir, promptFn: deps.promptFn, logger,
        savedDatabaseUrl: inst.databaseUrl,
      });
  if (!done('db_ready')) {
    inst = saveInstance(baseDir, { dbMode, databaseUrl: db.databaseUrl });
    inst = checkpoint(baseDir, 'db_ready');
  }
  // Provisioning is authoritative: if the DB legitimately moved ports (its old
  // port got taken and the container was recreated), chase the move — update
  // the saved URL and the app's .env.local so the server doesn't point at a
  // stranger's Postgres.
  if (db.databaseUrl && inst.databaseUrl && db.databaseUrl !== inst.databaseUrl) {
    logger.error(`[warn] Database URL changed (${inst.databaseUrl} -> ${db.databaseUrl}) — updating saved config.`);
    inst = saveInstance(baseDir, { databaseUrl: db.databaseUrl });
    if (done('setup_done') && appDir) rewriteEnvDatabaseUrl(appDir, db.databaseUrl, logger);
  }
  const databaseUrl = db.databaseUrl ?? inst.databaseUrl;

  // 4. setup_done -----------------------------------------------------------
  let apiKey = inst.apiKey;
  if (!done('setup_done')) {
    const out = await deps.runSetupScript({ appDir, databaseUrl, logger });
    if (out.ok === false) throw new Error(out.error || 'Setup failed.');
    apiKey = out.apiKey;
    inst = saveInstance(baseDir, { apiKey });
    // setup.mjs prints the password to ITS stderr, but runSetupScript pipes
    // (and on success discards) that stream — so this line is the one place
    // the operator ever sees it. It is also saved to <appDir>/.env.local.
    if (out.adminPassword) {
      logger.log(`[ok] Dashboard admin password: ${out.adminPassword}   (also saved to ${join(appDir, '.env.local')})`);
    }
    inst = checkpoint(baseDir, 'setup_done');
  }

  // 5. built ----------------------------------------------------------------
  if (!done('built')) {
    deps.buildApp(appDir, logger);
    inst = checkpoint(baseDir, 'built');
  }

  // 6. start (skipped when a previously-recorded server pid is still live)
  // Without this check, a second `dashclaw up` would spawn a duplicate
  // `next start` on the same port; the duplicate fails to bind, waitForHealth
  // passes against the ORIGINAL, and upCommand's child.on('exit') fires
  // immediately → stopDb → exits, orphaning the original server.
  let child;
  let reusedServer = false;
  if (inst.pid && deps.processAlive(inst.pid)) {
    try {
      await deps.waitForHealth({ baseUrl });
      // Original server is alive and healthy — reuse it.
      logger.log(`[ok] Reusing server already running on :${port} (pid ${inst.pid})`);
      child = { pid: inst.pid, on: () => {} };
      reusedServer = true;
    } catch {
      // Pid alive but health check failed — fall through to a fresh start.
    }
  }
  // One-time browser sign-in: only mintable for a server WE are about to start
  // (Next reads .env.local at boot; a reused server would never see the token).
  let loginToken = null;
  if (!reusedServer) {
    loginToken = deps.mintLoginToken?.(appDir, logger) ?? null;
    child = deps.startServer({ appDir, port, logger });
    inst = saveInstance(baseDir, { pid: child.pid });
    try {
      await deps.waitForHealth({ baseUrl });
    } catch (e) {
      // Health timeout: kill the orphaned server and clear the stale pid so the
      // next `dashclaw up` doesn't try to resume a dead process.
      try { killTree(child.pid); } catch { /* already gone */ }
      saveInstance(baseDir, { pid: null });
      throw e;
    }
  }
  logger.log(`[ok] Server running at ${baseUrl}   (Ctrl+C stops it; \`dashclaw up\` restarts it)`);

  // 7. connected ------------------------------------------------------------
  if (!done('connected')) {
    let connect = true;
    if (!args.yes) {
      const answer = (await deps.promptFn('Connect Claude Code now? [Y/n] ')).trim().toLowerCase();
      connect = answer !== 'n' && answer !== 'no';
    }
    if (connect) {
      // Hooks install is auxiliary to `up` (the dashboard is already running);
      // a missing Python must not kill steps 8+ — the browser sign-in moment.
      // No checkpoint on failure, so the next `dashclaw up` retries the install.
      try {
        await deps.installClaude({ endpoint: baseUrl, apiKey });
        inst = checkpoint(baseDir, 'connected');
      } catch (e) {
        logger.error(`[warn] Claude Code not connected: ${e.message}`);
        logger.error('       The dashboard still works; re-run `dashclaw up` after fixing this to retry.');
      }
    } else {
      inst = checkpoint(baseDir, 'connected'); // declining is still a completed decision
    }
  }

  // 8. open -----------------------------------------------------------------
  // With a fresh token the browser opens /login?ott=... and lands signed in
  // (redirecting on to /setup); otherwise it opens /setup directly and any
  // protected page will ask for the admin password.
  const signInUrl = loginToken
    ? `${baseUrl}/login?ott=${loginToken}&next=${encodeURIComponent('/setup')}`
    : `${baseUrl}/setup`;
  if (!args.noBrowser) {
    deps.openBrowser(signInUrl, logger);
  } else if (loginToken) {
    logger.log(`Sign in (link valid ~15 min, single use): ${signInUrl}`);
  }
  logger.log(`Done. First steps: ${baseUrl}/connect`);

  return { child, stopDb: db.stop, baseUrl, reusedServer };
}

/**
 * Stop the local instance: kill the server child (if recorded) and stop the
 * Docker container if we started one. Embedded Postgres dies with the up
 * process, so there is nothing to stop for that mode.
 *
 * @param {object} [opts]
 * @param {string} [opts.baseDir]     state dir (default ~/.dashclaw)
 * @param {object} [opts.logger]      logger (default console)
 * @param {Function} [opts.kill]      injectable kill fn for testing (default killTree)
 * @param {Function} [opts.dockerStop] injectable docker-stop fn for testing
 */
export async function runDown({
  baseDir = join(homedir(), '.dashclaw'),
  logger = console,
  kill = killTree,
  dockerStop = (container) => spawnSync('docker', ['stop', container], { stdio: 'ignore' }),
} = {}) {
  const inst = loadInstance(baseDir);
  if (!inst) {
    logger.log('No local DashClaw instance recorded — nothing to stop.');
    return;
  }
  if (inst.pid) {
    try {
      kill(inst.pid);
      logger.log(`[ok] Stopped server (pid ${inst.pid}).`);
    } catch {
      logger.log('Server was not running.');
    }
    saveInstance(baseDir, { pid: null });
  }
  if (inst.dbMode === 'docker') {
    // No shell — house decision (see db.js): docker args are passed directly.
    dockerStop('dashclaw-pg');
    logger.log('[ok] Stopped Docker Postgres (container dashclaw-pg).');
  }
  if (inst.dbMode === 'embedded' && process.platform === 'win32') {
    // On Windows the embedded server runs detached via pg_ctl (see db.js) and
    // survives the up process — stop it here, best-effort.
    try {
      const { pg_ctl } = await import('@embedded-postgres/windows-x64');
      const res = spawnSync(pg_ctl, ['-D', join(baseDir, 'pg'), '-m', 'fast', 'stop'], { stdio: 'ignore' });
      if (res.status === 0) logger.log('[ok] Stopped embedded Postgres.');
    } catch { /* binaries not installed — nothing to stop */ }
  }
}

/**
 * `dashclaw up` entry point: parse args, run the pipeline, and keep the process
 * alive until the server child exits or the user interrupts. SIGINT/SIGTERM
 * stop the DB cleanly before exiting.
 */
export async function upCommand(argv) {
  const args = parseUpArgs(argv);
  const baseDir = resolveBaseDir(args);
  const { child, stopDb, reusedServer } = await runUp({ args, baseDir });

  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    // Kill the server child first — on Windows the recorded pid is a cmd.exe
    // wrapper; killTree reaches the actual Next process via taskkill /T /F.
    // When reusing an existing server we deliberately do NOT kill it: the user
    // did not start it in this session and Ctrl+C should only stop THIS process.
    if (!reusedServer) {
      try { killTree(child.pid); } catch { /* already gone */ }
    }
    await stopDb();
    // Hard exit is intentional here: stopDb has resolved, and we need to
    // ensure the process doesn't linger on SIGINT (especially on Windows where
    // the event loop may keep running after the child exits).
    process.exit(0); // eslint-disable-line no-process-exit
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  if (reusedServer) {
    // The reused child stub has a no-op .on(); wait for a signal instead of an
    // exit event that will never fire.
    await new Promise(() => {}); // resolved only by SIGINT/SIGTERM above
  } else {
    await new Promise((resolve) => child.on('exit', resolve));
    await stopDb();
  }
}
